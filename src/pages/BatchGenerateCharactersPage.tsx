import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, TextField, Typography, Chip, LinearProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, IconButton, InputLabel, MenuItem, Select } from '@mui/material';
import { useShallow } from 'zustand/react/shallow';
import type { AIModelProfile } from '../types/settings';
import type { AICharacter, CharacterBehaviorParams, PersonalityParams } from '../types/character';
import { enqueueAvatarGenerationForCharacters } from '../services/avatarGeneration';
import { initializeDefaultRelationshipsForCreatedCharacters } from '../services/defaultRelationshipInitializer';
import AppSnackbar from '../components/common/AppSnackbar';
import { BATCH_GENERATE_EXAMPLES } from '../constants/batchGenerateExamples';

const BATCH_GENERATE_GROUP_SIZE = 10;
const MOBILE_BOTTOM_NAV_FAB_OFFSET = 'calc(env(safe-area-inset-bottom, 0px) + 104px)';
const MOBILE_BOTTOM_NAV_CONTENT_PADDING = 'calc(env(safe-area-inset-bottom, 0px) + 176px)';

interface ProgressItem {
  name: string;
  status: 'success' | 'skipped' | 'failed';
  reason?: string;
}

interface ProgressState {
  current: number;
  total: number;
  currentName?: string;
  items: ProgressItem[];
}

type NameFormat = 'roleName' | 'roleDotName' | 'nameDotRole' | 'nameDashRole' | 'roleDashName' | 'nameParenRole' | 'nameOnly' | 'roleOnly';

interface CandidateCharacter {
  id: string;
  name: string;
  role: string;
  summary: string;
}

const NAME_FORMAT_OPTIONS: Array<{ value: NameFormat; label: string }> = [
  { value: 'roleName', label: '身份名字' },
  { value: 'roleDotName', label: '身份·名字' },
  { value: 'nameDotRole', label: '名字·身份' },
  { value: 'nameDashRole', label: '名字-身份' },
  { value: 'roleDashName', label: '身份-名字' },
  { value: 'nameParenRole', label: '名字（身份）' },
  { value: 'nameOnly', label: '名字' },
  { value: 'roleOnly', label: '身份' },
];

function formatCandidateName(candidate: CandidateCharacter, format: NameFormat) {
  const name = candidate.name.trim();
  const role = candidate.role.trim();
  if (!role) return name;
  switch (format) {
    case 'roleName':
      return `${role}${name}`;
    case 'roleDotName':
      return `${role}·${name}`;
    case 'nameDotRole':
      return `${name}·${role}`;
    case 'nameDashRole':
      return `${name}-${role}`;
    case 'roleDashName':
      return `${role}-${name}`;
    case 'nameOnly':
      return name;
    case 'roleOnly':
      return role;
    case 'nameParenRole':
    default:
      return `${name}（${role}）`;
  }
}

async function runInBatches<T>(items: T[], batchSize: number, worker: (batch: T[], batchStartIndex: number) => Promise<void>) {
  for (let start = 0; start < items.length; start += batchSize) {
    await worker(items.slice(start, start + batchSize), start);
  }
}

function appendProgressItem(
  setProgress: React.Dispatch<React.SetStateAction<ProgressState>>,
  item: ProgressItem
) {
  setProgress((prev) => ({
    ...prev,
    current: Math.min(prev.total, prev.current + 1),
    items: [...prev.items, item],
  }));
}

function markCurrentName(
  setProgress: React.Dispatch<React.SetStateAction<ProgressState>>,
  name: string
) {
  setProgress((prev) => ({ ...prev, currentName: name }));
}

function buildBatchProgressLabel(names: string[]) {
  return names.join('、');
}

function finishBatchProgress(
  setProgress: React.Dispatch<React.SetStateAction<ProgressState>>
) {
  setProgress((prev) => ({ ...prev, currentName: '' }));
}

function buildGeneratedCharacterPayload(params: {
  name: string;
  generated: {
    avatar: string;
    personality: Record<string, number>;
    behavior: CharacterBehaviorParams;
    expertise: string[];
    speakingStyle: string;
    background: string;
    speechProfile: NonNullable<AICharacter['speechProfile']>;
    bubbleStyle: NonNullable<AICharacter['bubbleStyle']>;
  };
  generatedGroup: string | null;
  allCharacters: Array<Pick<AICharacter, 'name' | 'group' | 'bubbleStyleId'>>;
  customStyleIds: string[];
  profile: AIModelProfile;
}): Omit<AICharacter, 'id' | 'createdAt' | 'updatedAt' | 'isPreset'> {
  return {
    name: params.name,
    ...params.generated,
    personality: params.generated.personality as unknown as PersonalityParams,
    group: params.generatedGroup,
    bubbleStyle: { ...params.generated.bubbleStyle, id: createCharacterBubbleStyleId() },
    bubbleStyleId: chooseRandomBubbleStyleId({
      allCharacters: params.allCharacters,
      generatedGroup: params.generatedGroup,
      customStyleIds: params.customStyleIds,
    }),
    behavior: params.generated.behavior,
    relationships: [],
    memory: DEFAULT_CHARACTER_MEMORY,
    intervention: DEFAULT_CHARACTER_INTERVENTION,
    modelProfileId: params.profile.id,
    modelProfileIds: { text: params.profile.id, image: null, audio: null, document: null },
  };
}

async function processCharacterBatch(params: {
  selectedCandidates: CandidateCharacter[];
  nameFormat: NameFormat;
  characters: Array<Pick<AICharacter, 'name' | 'group' | 'bubbleStyleId'>>;
  generatedGroup: string | null;
  customStyleIds: string[];
  profile: AIModelProfile;
  language: 'zh' | 'en';
  theme?: string | null;
  description?: string | null;
  cancelGenerationRef: React.MutableRefObject<boolean>;
  setProgress: React.Dispatch<React.SetStateAction<ProgressState>>;
  duplicateMessage: string;
  getErrorMessage: (error: unknown) => string;
  addCharacters: (chars: Array<Omit<AICharacter, 'id' | 'createdAt' | 'updatedAt' | 'isPreset'>>) => Promise<AICharacter[]>;
}) {
  const existingNames = new Set(params.characters.map((char) => char.name.trim().toLowerCase()));
  const reservedNames = new Set<string>();
  const allCreatedCharacters: AICharacter[] = [];

  await runInBatches(params.selectedCandidates, BATCH_GENERATE_GROUP_SIZE, async (batch) => {
    if (params.cancelGenerationRef.current) return;

    const displayItems = batch.map((candidate) => ({ candidate, displayName: formatCandidateName(candidate, params.nameFormat) }));
    markCurrentName(params.setProgress, buildBatchProgressLabel(displayItems.map((item) => item.displayName)));
    const creatableItems = displayItems.filter(({ displayName }) => {
      const normalizedName = displayName.trim().toLowerCase();
      const duplicated = existingNames.has(normalizedName) || reservedNames.has(normalizedName);
      if (duplicated) {
        appendProgressItem(params.setProgress, { name: displayName, status: 'skipped', reason: params.duplicateMessage });
        return false;
      }
      reservedNames.add(normalizedName);
      return true;
    });
    const creatableNames = creatableItems.map((item) => item.displayName);

    if (params.cancelGenerationRef.current || !creatableNames.length) return;

    try {
      const { success, failed } = await generateCharacterProfilesSafe(params.profile, creatableNames, params.language, {
        theme: params.theme,
        description: [
          params.description?.trim() || '',
          params.language === 'zh'
            ? `隐藏角色摘要：${creatableItems.map(({ candidate, displayName }) => `${displayName} => 本名：${candidate.name}；主要身份：${candidate.role}；摘要：${candidate.summary}`).join('；')}`
            : `Hidden character summaries: ${creatableItems.map(({ candidate, displayName }) => `${displayName} => name: ${candidate.name}; primary role: ${candidate.role}; summary: ${candidate.summary}`).join('; ')}`,
        ].filter(Boolean).join('\n'),
      });
      failed.forEach(({ name, reason }) => {
        appendProgressItem(params.setProgress, { name, status: 'failed', reason });
      });
      if (!success.length) return;
      const successfulPayloads = success.map(({ name, profile }) => ({
        name,
        payload: buildGeneratedCharacterPayload({
          name,
          generated: {
            avatar: profile.avatar,
            personality: profile.personality as unknown as Record<string, number>,
            behavior: profile.behavior,
            expertise: profile.expertise,
            speakingStyle: profile.speakingStyle,
            background: profile.background,
            speechProfile: profile.speechProfile,
            bubbleStyle: profile.bubbleStyle,
          },
          generatedGroup: params.generatedGroup,
          allCharacters: params.characters,
          customStyleIds: params.customStyleIds,
          profile: params.profile,
        }),
      }));
      const createdCharacters = await params.addCharacters(successfulPayloads.map((item) => item.payload));
      allCreatedCharacters.push(...createdCharacters);
      if (useSettingsStore.getState().avatarGeneration.autoGenerateCharacterAvatar) {
        try {
          enqueueAvatarGenerationForCharacters(
            createdCharacters.map((character) => ({
              id: character.id,
              name: character.name,
              group: character.group || '',
              background: character.background || '',
              speakingStyle: character.speakingStyle || '',
              expertise: character.expertise || [],
              personality: character.personality,
              speechProfile: character.speechProfile,
            })),
            useSettingsStore.getState().aiProfiles,
            params.language,
            useSettingsStore.getState().avatarGeneration,
          );
        } catch (error) {
          const reason = error instanceof Error ? error.message : params.getErrorMessage(error);
          createdCharacters.forEach((character) => {
            appendProgressItem(params.setProgress, { name: character.name, status: 'failed', reason: `${params.language === 'zh' ? '头像生成未启动：' : 'Avatar generation did not start: '}${reason}` });
          });
        }
      }
      successfulPayloads.forEach(({ name }) => {
        existingNames.add(name.trim().toLowerCase());
        appendProgressItem(params.setProgress, { name, status: 'success' });
      });
    } catch (error) {
      console.error('[batch-generate:batch-request:error]', { names: creatableNames, error });
      const reason = error instanceof Error && error.message === 'DUPLICATE_CHARACTER_NAME'
        ? params.duplicateMessage
        : params.getErrorMessage(error);
      creatableNames.forEach((name) => {
        appendProgressItem(params.setProgress, { name, status: 'failed', reason });
      });
    }
  });

  finishBatchProgress(params.setProgress);
  return allCreatedCharacters;
}

import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import SettingsIcon from '@mui/icons-material/Settings';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLayoutHeaderActions } from '../components/layout/AppLayoutContext';
import { useTranslation } from 'react-i18next';
import { generateResponse } from '../services/aiClient';
import { generateCharacterProfilesSafe } from '../services/characterGenerator';

import { useSettingsStore } from '../stores/useSettingsStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import { DEFAULT_CHARACTER_INTERVENTION, DEFAULT_CHARACTER_MEMORY } from '../types';
import { getTopicDerivedCharacterGroup } from '../types/character';
import { getPreferredAIProfile } from '../types/settings';
import { BUILT_IN_BUBBLE_STYLES } from '../constants/bubbleStyles';
import { chooseRandomBubbleStyleId, createCharacterBubbleStyleId } from '../utils/bubbleStyle';


function getCustomBubbleStyleIds(settings: { customBubbleStyles?: Array<{ id: string }> }) {
  return (settings.customBubbleStyles || []).map((style) => style.id);
}

function chooseBatchBubbleStyle(settings: { customBubbleStyles?: Array<{ id: string }> }, allCharacters: Array<{ group?: string | null; bubbleStyleId?: string | null }>, generatedGroup: string | null) {
  return chooseRandomBubbleStyleId({
    allCharacters,
    generatedGroup,
    customStyleIds: getCustomBubbleStyleIds(settings),
  });
}

function filterMeaningfulRelationshipPairs(members: Array<{ name: string; relationships: Array<{ characterId: string; valence: number; respect: number; trust: number; tension: number; note?: string }>; }>, allMembers: Array<{ id: string; name: string }>) {
  return members.flatMap((member) =>
    member.relationships
      .filter((relation) => Boolean(relation.note?.trim()) || Math.abs(relation.valence + relation.respect + relation.trust - relation.tension) >= 15 || relation.valence >= 12 || relation.respect >= 12 || relation.trust >= 12 || relation.tension >= 12 || relation.valence <= -12 || relation.respect <= -12 || relation.trust <= -12)
      .map((relation) => ({
        source: member.name,
        target: allMembers.find((item) => item.id === relation.characterId)?.name || relation.characterId,
        relation,
        score: relation.valence + relation.respect + relation.trust - relation.tension,
      }))
  );
}

function getRuntimeRelationshipItems(members: Array<{ name: string; relationships: Array<{ characterId: string; valence: number; respect: number; trust: number; tension: number; note?: string }>; }>, allMembers: Array<{ id: string; name: string }>) {
  return filterMeaningfulRelationshipPairs(members, allMembers).slice(0, 8);
}

function getMeaningfulRelationshipPairs(members: Array<{ name: string; relationships: Array<{ characterId: string; valence: number; respect: number; trust: number; tension: number; note?: string }>; }>, allMembers: Array<{ id: string; name: string }>) {
  return getRuntimeRelationshipItems(members, allMembers);
}

function getFilteredRelationshipPairs(members: Array<{ name: string; relationships: Array<{ characterId: string; valence: number; respect: number; trust: number; tension: number; note?: string }>; }>, allMembers: Array<{ id: string; name: string }>) {
  return getMeaningfulRelationshipPairs(members, allMembers);
}

function getLongerMemoryPreview(text: string, limit = 120) {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function getLongerTimelinePreview(text: string, limit = 140) {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function getLongerRelationshipPreview(text: string, limit = 90) {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function getLongerGeneratedNamePreview(text: string, limit = 60) {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function getBubbleStyleForBatchCharacter(settings: { customBubbleStyles?: Array<{ id: string }> }, characters: Array<{ group?: string | null; bubbleStyleId?: string | null }>, generatedGroup: string | null) {
  return chooseBatchBubbleStyle(settings, characters, generatedGroup);
}

function getExpandedMemoryPreview(text: string) {
  return getLongerMemoryPreview(text, 120);
}

function getExpandedTimelinePreview(text: string) {
  return getLongerTimelinePreview(text, 140);
}

function getExpandedRelationshipPreview(text: string) {
  return getLongerRelationshipPreview(text, 90);
}

function getExpandedGeneratedNamePreview(text: string) {
  return getLongerGeneratedNamePreview(text, 60);
}

function buildBatchBubbleStyleId(settings: { customBubbleStyles?: Array<{ id: string }> }, characters: Array<{ group?: string | null; bubbleStyleId?: string | null }>, generatedGroup: string | null) {
  return getBubbleStyleForBatchCharacter(settings, characters, generatedGroup);
}

function getReadableMemoryPreview(text: string) {
  return getExpandedMemoryPreview(text);
}

function getReadableTimelinePreview(text: string) {
  return getExpandedTimelinePreview(text);
}

function getReadableRelationshipPreview(text: string) {
  return getExpandedRelationshipPreview(text);
}

function getReadableGeneratedNamePreview(text: string) {
  return getExpandedGeneratedNamePreview(text);
}

function chooseGeneratedBubbleStyle(settings: { customBubbleStyles?: Array<{ id: string }> }, characters: Array<{ group?: string | null; bubbleStyleId?: string | null }>, generatedGroup: string | null) {
  return buildBatchBubbleStyleId(settings, characters, generatedGroup);
}

function getVisibleMemoryText(text: string) {
  return getReadableMemoryPreview(text);
}

function getVisibleTimelineText(text: string) {
  return getReadableTimelinePreview(text);
}

function getVisibleRelationshipText(text: string) {
  return getReadableRelationshipPreview(text);
}

function getVisibleGeneratedNameText(text: string) {
  return getReadableGeneratedNamePreview(text);
}

const NAMES_SYSTEM_PROMPT = `You help generate candidate characters for a theme.
Return strict JSON only in this shape: {"characters":[{"name":"Name","role":"primary role","summary":"hidden identity summary"}],"defaultSelectedNames":["Name"]}
Rules:
- Build a usable cast, not just a protagonist list.
- Each character must include name, role, and summary.
- name must be an actual person/character name, not only an identity, job title, archetype, or role.
- role should be the most useful primary identity for group chat context; characters may have multiple identities, but include only the main one.
- summary is hidden from users and later used to generate the full character; include enough context to disambiguate identity, status, relationship, era/genre fit, and why this character belongs in the requested cast.
- Use the user's language for names, roles, and summaries.
- Include a mix of: core characters, major supporting characters, recurring side characters, rivals, mentors, family members, allies, comic relief, or strongly associated peripheral figures.
- Aim for breadth around the theme: roughly 30-40% core names, 40-50% important supporting names, and 20-30% peripheral-but-recognizable related names.
- Do not stop at only the most famous names if the world clearly has a broader cast.
- For broad themes, return more names. For narrow themes, return fewer names.
- Put the most central or iconic names first, but keep expanding outward to a richer cast.
- defaultSelectedNames should contain only the character names that should be selected by default for an initial chat cast. Usually this means the core cast, not everyone.
- defaultSelectedNames must be a subset of characters[].name and must use the exact same name strings.
- Prefer well-known, distinctive characters or figures strongly associated with the theme.
- Do not include placeholders, headings, field names, or questions like "names?".
- Every item in characters must be an actual character/person/figure with a primary role and hidden summary.
- No explanations, no markdown.`;

const INVALID_NAME_PATTERNS = [
  /^names?\??$/i,
  /^name\s*list$/i,
  /^角色名[称字]?\??$/,
  /^名字\??$/,
  /^名称\??$/,
  /^列表$/,
  /^示例$/,
];

function isValidCandidateName(value: string) {
  const normalized = value.trim().replace(/^[:：\-•*\d.\s]+/, '').trim();
  if (!normalized) return false;
  if (normalized.length > 40) return false;
  if (/[{}\[\]]/.test(normalized)) return false;
  if (INVALID_NAME_PATTERNS.some((pattern) => pattern.test(normalized))) return false;
  return true;
}

function sanitizeNames(names: string[]) {
  return [...new Set(names.map((item) => item.trim()).filter(isValidCandidateName))];
}

function buildCandidate(name: string, role = '', summary = ''): CandidateCharacter | null {
  const normalizedName = name.trim();
  if (!isValidCandidateName(normalizedName)) return null;
  const normalizedRole = role.trim();
  return {
    id: `${normalizedName}::${normalizedRole}`,
    name: normalizedName,
    role: normalizedRole,
    summary: summary.trim() || [normalizedName, normalizedRole].filter(Boolean).join('：'),
  };
}

function sanitizeCandidates(candidates: CandidateCharacter[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate.id.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractJsonObject(content: string) {
  const cleaned = content.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

function extractJsonArray(content: string) {
  const cleaned = content.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    return cleaned.slice(firstBracket, lastBracket + 1);
  }
  return cleaned;
}

function tryParseNamesJson(content: string) {
  try {
    const parsed = JSON.parse(extractJsonObject(content)) as { characters?: unknown; names?: unknown; defaultSelectedNames?: unknown };
    if (Array.isArray(parsed.characters)) {
      const candidates = sanitizeCandidates(parsed.characters.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const record = item as { name?: unknown; role?: unknown; summary?: unknown };
        const candidate = typeof record.name === 'string'
          ? buildCandidate(
              record.name,
              typeof record.role === 'string' ? record.role : '',
              typeof record.summary === 'string' ? record.summary : ''
            )
          : null;
        return candidate ? [candidate] : [];
      }));
      const defaultSelectedIds = Array.isArray(parsed.defaultSelectedNames)
        ? parsed.defaultSelectedNames
            .filter((item): item is string => typeof item === 'string')
            .map((name) => candidates.find((candidate) => candidate.name === name)?.id)
            .filter((id): id is string => Boolean(id))
        : [];
      return { candidates, defaultSelectedIds };
    }
    if (Array.isArray(parsed.names)) {
      const candidates = sanitizeCandidates(parsed.names.flatMap((item) => {
        const candidate = typeof item === 'string' ? buildCandidate(item) : null;
        return candidate ? [candidate] : [];
      }));
      const defaultSelectedIds = Array.isArray(parsed.defaultSelectedNames)
        ? parsed.defaultSelectedNames
            .filter((item): item is string => typeof item === 'string')
            .map((name) => candidates.find((candidate) => candidate.name === name || formatCandidateName(candidate, 'nameParenRole') === name)?.id)
            .filter((id): id is string => Boolean(id))
        : [];
      return { candidates, defaultSelectedIds };
    }
  } catch {
    // ignore
  }

  try {
    const parsed = JSON.parse(extractJsonArray(content)) as unknown;
    if (Array.isArray(parsed)) {
      const candidates = sanitizeCandidates(parsed.flatMap((item) => {
        const candidate = typeof item === 'string' ? buildCandidate(item) : null;
        return candidate ? [candidate] : [];
      }));
      return { candidates, defaultSelectedIds: [] };
    }
  } catch {
    // ignore
  }

  return null;
}

function stripLinePrefix(line: string) {
  return line.replace(/^\s*(?:[-*•]|\d+[.)]|[A-Za-z]\)|[（(]?[一二三四五六七八九十]+[)）.、])\s*/, '').trim();
}

function parseNames(content: string) {
  const parsedJson = tryParseNamesJson(content);
  if (parsedJson && parsedJson.candidates.length > 0) {
    return parsedJson;
  }

  const cleaned = content
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .replace(/\r/g, '')
    .trim();

  const quoted = sanitizeNames(
    Array.from(cleaned.matchAll(/["“”'『「]([^"“”'』」\n]{1,40})["“”'』」]/g)).map((match) => match[1].trim())
  );
  const lines = sanitizeNames(
    cleaned
      .split('\n')
      .map(stripLinePrefix)
      .filter((line) => line.length > 0 && line.length <= 40 && !line.includes('{') && !line.includes('}'))
      .filter((line) => !/^[A-Za-z_]+\s*:/.test(line) && !/^[\u4e00-\u9fa5]+\s*[：:]/.test(line))
  );

  const candidates = sanitizeCandidates([...quoted, ...lines].flatMap((name) => {
    const candidate = buildCandidate(name);
    return candidate ? [candidate] : [];
  }));
  if (candidates.length === 0) {
    throw new Error('AI 返回的名字列表格式无法解析');
  }
  return { candidates, defaultSelectedIds: [] };
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

export default function BatchGenerateCharactersPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { setHeaderTitle, setHeaderActions, setHeaderBackAction } = useLayoutHeaderActions();
  const settings = useSettingsStore(useShallow((state) => ({
    aiProfiles: state.aiProfiles,
    customBubbleStyles: state.customBubbleStyles,
  })));
  const { characters, markCharactersWarm, prefetchCharacters, addCharacters, updateCharacters } = useCharacterStore(useShallow((state) => ({
    characters: state.characters,
    markCharactersWarm: state.markCharactersWarm,
    prefetchCharacters: state.prefetchCharacters,
    addCharacters: state.addCharacters,
    updateCharacters: state.updateCharacters,
  })));
  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');
  const [candidateCharacters, setCandidateCharacters] = useState<CandidateCharacter[]>([]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [nameFormat, setNameFormat] = useState<NameFormat>('nameParenRole');
  const [pendingNameFormat, setPendingNameFormat] = useState<NameFormat>('nameParenRole');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loadingNames, setLoadingNames] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; currentName?: string; items: ProgressItem[] }>({ current: 0, total: 0, currentName: '', items: [] });
  const cancelGenerationRef = useRef(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });
  const returnTo = new URLSearchParams(location.search).get('returnTo');

  useEffect(() => {
    setHeaderTitle(i18n.language.startsWith('zh') ? '批量生成角色' : 'Batch Generate');
    setHeaderBackAction(() => () => navigate(-1));
    setHeaderActions(
      <IconButton color="primary" onClick={() => { setPendingNameFormat(nameFormat); setSettingsOpen(true); }} aria-label={i18n.language.startsWith('zh') ? '设置' : 'Settings'}>
        <SettingsIcon />
      </IconButton>
    );
    return () => {
      setHeaderTitle(null);
      setHeaderBackAction(null);
      setHeaderActions(null);
    };
  }, [i18n.language, nameFormat, navigate, setHeaderActions, setHeaderBackAction, setHeaderTitle]);

  const selectedSet = useMemo(() => new Set(selectedCandidateIds), [selectedCandidateIds]);
  const selectedCandidates = useMemo(() => candidateCharacters.filter((candidate) => selectedSet.has(candidate.id)), [candidateCharacters, selectedSet]);
  const example = useMemo(() => BATCH_GENERATE_EXAMPLES[Math.floor(Math.random() * BATCH_GENERATE_EXAMPLES.length)], []);
  const localizedExample = i18n.language.startsWith('zh') ? example.zh : example.en;
  const canGenerateNames = Boolean(topic.trim() || description.trim()) && !loadingNames;
  const canGenerateCharacters = selectedCandidateIds.length > 0 && !generating;

  const toggleCandidate = (candidateId: string) => {
    setSelectedCandidateIds((prev) =>
      prev.includes(candidateId)
        ? prev.filter((item) => item !== candidateId)
        : [...prev, candidateId]
    );
  };

  const handleFetchNames = async () => {
    const profile = getPreferredAIProfile(settings.aiProfiles, 'text');
    if (!profile?.apiKey || !profile?.model) {
      setSnackbar({ open: true, message: i18n.language.startsWith('zh') ? '请先配置AI模型' : 'Configure AI model first', severity: 'error' });
      return;
    }

    setLoadingNames(true);
    try {
      const promptInput = [
        topic.trim() ? (i18n.language.startsWith('zh') ? `主题/分组：${topic.trim()}` : `Theme/group: ${topic.trim()}`) : '',
        description.trim() ? (i18n.language.startsWith('zh') ? `描述：${description.trim()}` : `Description: ${description.trim()}`) : '',
      ].filter(Boolean).join('\n');
      const response = await generateResponse(
        profile,
        `${NAMES_SYSTEM_PROMPT}\nOutput exactly one valid JSON object. Do not include trailing commas. Do not truncate. Do not add explanations before or after the JSON.`,
        [{ role: 'user', content: i18n.language.startsWith('zh') ? `${promptInput}\n请根据主题/分组和描述列出一个适合放进同一群聊的角色阵容；如果描述里指定数量或身份结构（例如“皇帝和10个妃子”），必须按描述生成对应数量与构成。每个角色必须有真实名字、主要身份和隐藏摘要。主要身份只写最有助于群聊理解的一个身份；隐藏摘要要说明角色在该主题/描述中的具体身份、地位、关系和设定约束，后续生成具体角色会依赖它避免跑偏。不要只给主角，需要同时包含核心角色、重要配角、反派/对手、老师/家人/同伴，以及少量但强相关的边缘角色。并请额外判断哪些角色应该默认选中作为初始群聊阵容。只返回合法JSON，格式必须是 {"characters":[{"name":"名字","role":"主要身份","summary":"隐藏摘要"}],"defaultSelectedNames":["名字"]}` : `${promptInput}\nReturn a cast suitable for the same group chat based on the theme/group and description. If the description specifies a count or role composition, follow it exactly. Each character must have a real name, primary role, and hidden summary. The role should be the single most useful identity for group chat context; the hidden summary must explain the character's concrete identity, status, relationships, and setting constraints within this exact theme/description, because full profile generation will rely on it to avoid drifting. Do not return only protagonists. Include core characters, important supporting characters, rivals/antagonists, mentors/family/allies, and a few strongly related peripheral figures. Also decide which characters should be selected by default as the initial cast. Return only valid JSON in the format {"characters":[{"name":"Name","role":"primary role","summary":"hidden summary"}],"defaultSelectedNames":["Name"]}.` }],
        undefined,
        { aiUsage: { type: 'group_creation', label: '生成群聊角色阵容', scope: 'batch_character_generation' } },
      );
      const parsed = parseNames(response);
      setCandidateCharacters(parsed.candidates);
      setSelectedCandidateIds(parsed.defaultSelectedIds.length ? parsed.defaultSelectedIds : parsed.candidates.slice(0, Math.min(4, parsed.candidates.length)).map((candidate) => candidate.id));
    } catch (error) {
      setSnackbar({ open: true, message: error instanceof Error ? error.message : t('common.error'), severity: 'error' });
    } finally {
      setLoadingNames(false);
    }
  };

  const handleGenerateCharacters = async () => {
    const profile = getPreferredAIProfile(settings.aiProfiles, 'text');
    if (!profile?.apiKey || !profile?.model) {
      setSnackbar({ open: true, message: i18n.language.startsWith('zh') ? '请先配置AI模型' : 'Configure AI model first', severity: 'error' });
      return;
    }

    cancelGenerationRef.current = false;
    setGenerating(true);
    setProgress({ current: 0, total: selectedCandidateIds.length, currentName: '', items: [] });

    try {
      const generatedGroup = getTopicDerivedCharacterGroup(topic);
      const createdCharacters = await processCharacterBatch({
        selectedCandidates,
        nameFormat,
        characters,
        generatedGroup,
        customStyleIds: (settings.customBubbleStyles || []).map((style) => style.id),
        profile,
        language: i18n.language.startsWith('zh') ? 'zh' : 'en',
        theme: topic.trim(),
        description: description.trim(),
        cancelGenerationRef,
        setProgress,
        duplicateMessage: i18n.language.startsWith('zh') ? '同名已存在' : 'Duplicate name exists',
        getErrorMessage,
        addCharacters,
      });

      const relationshipProfile = getPreferredAIProfile(useSettingsStore.getState().aiProfiles, 'text');
      if (relationshipProfile?.apiKey && relationshipProfile.model && createdCharacters.length) {
        void initializeDefaultRelationshipsForCreatedCharacters({
          config: relationshipProfile,
          createdCharacters,
          allCharacters: useCharacterStore.getState().characters,
          language: i18n.language.startsWith('zh') ? 'zh' : 'en',
          updateCharacters,
        }).catch((error) => {
          console.error('[batch-generate:default-relationships:error]', error);
        });
      }

      markCharactersWarm();
      void prefetchCharacters();
      setSnackbar({
        open: true,
        message: cancelGenerationRef.current
          ? (i18n.language.startsWith('zh') ? '已取消批量生成' : 'Batch generation cancelled')
          : (i18n.language.startsWith('zh') ? '批量生成完成' : 'Batch generation completed'),
        severity: cancelGenerationRef.current ? 'error' : 'success',
      });
      if (!cancelGenerationRef.current && returnTo) {
        navigate(`${returnTo}${returnTo.includes('?') ? '&' : '?'}restoreDraft=1`, { replace: true });
      }
    } catch (error) {
      setSnackbar({ open: true, message: error instanceof Error ? error.message : t('common.error'), severity: 'error' });
    } finally {
      setGenerating(false);
      setProgress({ current: 0, total: 0, currentName: '', items: [] });
    }
  };

  return (
    <Box sx={{
      p: 3,
      pt: { xs: 1, sm: 1, md: 3 },
      pb: { xs: MOBILE_BOTTOM_NAV_CONTENT_PADDING, sm: 3 },
      maxWidth: 960,
      mx: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
    }}>
      <Box sx={{ p: 2.5, border: 1, borderColor: 'divider', borderRadius: 4, bgcolor: 'background.paper', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <TextField
          label={i18n.language.startsWith('zh') ? '主题/分组' : 'Theme/group'}
          placeholder={i18n.language.startsWith('zh') ? `例如：${localizedExample.topic}` : `e.g. ${localizedExample.topic}`}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          fullWidth
        />
        <TextField
          label={i18n.language.startsWith('zh') ? '描述' : 'Description'}
          placeholder={i18n.language.startsWith('zh') ? `例如：${localizedExample.description}` : `e.g. ${localizedExample.description}`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canGenerateNames) {
              e.preventDefault();
              void handleFetchNames();
            }
          }}
          fullWidth
          multiline
          minRows={4}
        />
        <Button
          variant="contained"
          startIcon={<AutoAwesomeIcon />}
          onClick={handleFetchNames}
          disabled={!canGenerateNames}
          sx={{ alignSelf: 'flex-end', borderRadius: 999, minHeight: 44, px: 2.5 }}
        >
          {i18n.language.startsWith('zh') ? '生成名单' : 'Generate names'}
        </Button>
      </Box>

      {candidateCharacters.length > 0 ? (
        <>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button size="small" variant="outlined" onClick={() => setSelectedCandidateIds(candidateCharacters.map((candidate) => candidate.id))}>
              {i18n.language.startsWith('zh') ? '全选' : 'Select all'}
            </Button>
            <Button size="small" variant="outlined" onClick={() => setSelectedCandidateIds(candidateCharacters.filter((candidate) => !selectedSet.has(candidate.id)).map((candidate) => candidate.id))}>
              {i18n.language.startsWith('zh') ? '反选' : 'Invert'}
            </Button>
            <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
              {selectedCandidateIds.length} · {candidateCharacters.length}
            </Typography>
          </Box>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: 'repeat(2, minmax(0, 1fr))',
                sm: 'repeat(3, minmax(0, 1fr))',
                lg: 'repeat(4, minmax(0, 1fr))',
              },
              gap: 1,
            }}
          >
            {candidateCharacters.map((candidate) => {
              const selected = selectedSet.has(candidate.id);
              return (
                <Chip
                  key={candidate.id}
                  label={formatCandidateName(candidate, nameFormat)}
                  clickable
                  color={selected ? 'primary' : 'default'}
                  variant={selected ? 'filled' : 'outlined'}
                  onClick={() => toggleCandidate(candidate.id)}
                  sx={{ justifyContent: 'flex-start' }}
                />
              );
            })}
          </Box>

          <Button
            variant="contained"
            startIcon={<AutoAwesomeIcon />}
            onClick={handleGenerateCharacters}
            disabled={!canGenerateCharacters}
            sx={{
              position: 'fixed',
              right: { xs: 24, sm: 32, md: 36 },
              bottom: { xs: MOBILE_BOTTOM_NAV_FAB_OFFSET, sm: 32, md: 36 },
              zIndex: (theme) => theme.zIndex.drawer + 1,
              minHeight: 56,
              px: 2.25,
              borderRadius: 18,
              boxShadow: '0 10px 24px rgba(0,0,0,0.22), 0 3px 8px rgba(0,0,0,0.16)',
            }}
          >
            {i18n.language.startsWith('zh') ? '批量生成' : 'Generate selected'}
          </Button>
        </>
      ) : null}

      <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>{i18n.language.startsWith('zh') ? '设置' : 'Settings'}</DialogTitle>
        <DialogContent>
          <FormControl fullWidth sx={{ mt: 1 }}>
            <InputLabel>{i18n.language.startsWith('zh') ? '名字格式' : 'Name format'}</InputLabel>
            <Select
              label={i18n.language.startsWith('zh') ? '名字格式' : 'Name format'}
              value={pendingNameFormat}
              onChange={(event) => setPendingNameFormat(event.target.value as NameFormat)}
            >
              {NAME_FORMAT_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={() => { setNameFormat(pendingNameFormat); setSettingsOpen(false); }}>
            {i18n.language.startsWith('zh') ? '确定' : 'OK'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={generating || loadingNames} fullWidth maxWidth="sm">
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, py: 1.5, px: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {loadingNames
                ? (i18n.language.startsWith('zh') ? '正在列出名字…' : 'Listing names…')
                : progress.currentName
                  ? (i18n.language.startsWith('zh') ? `正在生成：${progress.currentName}` : `Generating: ${progress.currentName}`)
                  : (i18n.language.startsWith('zh') ? '正在批量生成角色' : 'Generating characters')}
            </Typography>
            {generating ? (
              <>
                <Typography variant="body2" color="text.secondary">
                  {progress.current}/{progress.total}
                </Typography>
                <LinearProgress variant="determinate" value={progress.total > 0 ? (progress.current / progress.total) * 100 : 0} />
                <Box sx={{ maxHeight: 280, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 2, px: 2, py: 1.5 }}>
                  {progress.items.map((item, index) => (
                    <Box key={`${item.name}-${item.status}-${index}`} sx={{ py: 0.5 }}>
                      <Typography variant="body2" sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</Box>
                        <Box component="span" sx={{ color: item.status === 'success' ? 'success.main' : item.status === 'skipped' ? 'warning.main' : 'error.main', flexShrink: 0 }}>
                          {item.status === 'success' ? (i18n.language.startsWith('zh') ? '成功' : 'Success') : item.status === 'skipped' ? (i18n.language.startsWith('zh') ? '跳过' : 'Skipped') : (i18n.language.startsWith('zh') ? '失败' : 'Failed')}
                        </Box>
                      </Typography>
                      {item.reason ? (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {item.reason}
                        </Typography>
                      ) : null}
                    </Box>
                  ))}
                </Box>
              </>
            ) : (
              <LinearProgress />
            )}
            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="outlined" color="error" onClick={() => { cancelGenerationRef.current = true; }}>
                {t('common.cancel')}
              </Button>
            </Box>
          </Box>
        </DialogContent>
      </Dialog>

      <AppSnackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        severity={snackbar.severity}
        message={snackbar.message}
        offset="none"
      />
    </Box>
  );
}
