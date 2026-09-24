import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, IconButton, InputLabel, LinearProgress, MenuItem, Select, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography } from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import SettingsIcon from '@mui/icons-material/Settings';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useLocation, useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import type { AIModelProfile } from '../types/settings';
import type { AICharacter, CharacterBehaviorParams, PersonalityParams } from '../types/character';
import { enqueueAvatarGenerationForCharacters } from '../services/avatarGeneration';
import { buildDefaultRelationshipSuggestions, initializeDefaultRelationshipsForCreatedCharacters, planDefaultRelationshipPatchesFromSuggestions, type DefaultRelationshipSuggestion, type DefaultRelationshipSuggestionSkipReason } from '../services/defaultRelationshipInitializer';
import { generateResponse } from '../services/aiClient';
import { generateCharacterProfilesSafe } from '../services/characterGenerator';
import AppSnackbar from '../components/common/AppSnackbar';
import FloatingSegmentedTabs from '../components/common/FloatingSegmentedTabs';
import VipLimitDialog from '../components/common/VipLimitDialog';
import CharacterRelationshipView, { type CharacterRelationshipViewCircle, type CharacterRelationshipViewEdge, type CharacterRelationshipViewNode } from '../components/relationship/CharacterRelationshipView';
import { useLayoutHeaderActions } from '../components/layout/AppLayoutContext';
import { BATCH_GENERATE_EXAMPLES } from '../constants/batchGenerateExamples';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useAuthStore } from '../stores/useAuthStore';
import { DEFAULT_CHARACTER_INTERVENTION, DEFAULT_CHARACTER_MEMORY } from '../types';
import { getTopicDerivedCharacterGroup } from '../types/character';
import { getPreferredAIProfile, isAIProfileUsable } from '../types/settings';
import { chooseRandomBubbleStyleId, createCharacterBubbleStyleId } from '../utils/bubbleStyle';
import { api, type BillingMembershipResponse, type VipEntitlementInfo } from '../services/api';
import { storageKey } from '../constants/brand';

const BATCH_GENERATE_GROUP_SIZE = 10;
const MOBILE_BOTTOM_NAV_FAB_OFFSET = 'calc(env(safe-area-inset-bottom, 0px) + 104px)';
const MOBILE_BOTTOM_NAV_CONTENT_PADDING = 'calc(env(safe-area-inset-bottom, 0px) + 176px)';
const HIGH_RELATIONSHIP_CONFIDENCE = 0.75;
const BATCH_GENERATED_MEMBER_IDS_KEY = storageKey('create-chat-batch-generated-member-ids');

function usesPlatformAi(profile: AIModelProfile | null | undefined) {
  if (!profile) return false;
  return profile.provider === 'official'
    || String(profile.provider).startsWith('official-')
    || profile.baseUrl.replace(/\/+$/, '') === '/api/ai';
}

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
type BatchGenerateTab = 'list' | 'relationships' | 'completion';

interface CandidateCharacter {
  id: string;
  name: string;
  role: string;
  summary: string;
}

interface CandidateRelationship {
  id: string;
  fromName: string;
  toName: string;
  note: string;
  tone: 'warm' | 'tense' | 'mixed' | 'neutral';
  strength: number;
  inferredFrom?: string;
}

interface CandidateRelationshipCircle {
  id: string;
  name: string;
  summary: string;
  characterNames: string[];
  keyRelationshipIds: string[];
  bridgeRelationshipIds: string[];
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
    voiceConfig: NonNullable<AICharacter['voiceConfig']>;
    coreProfile: NonNullable<AICharacter['coreProfile']>;
    bubbleStyle: NonNullable<AICharacter['bubbleStyle']>;
    visualIdentity: NonNullable<AICharacter['visualIdentity']>;
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
  characters: Array<Pick<AICharacter, 'name' | 'group' | 'bubbleStyleId' | 'voiceConfig'>>;
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
      const usedVoiceIds = [...params.characters, ...allCreatedCharacters]
        .map((character) => character.voiceConfig?.voiceName)
        .filter((voice): voice is string => Boolean(voice));
      const { success, failed } = await generateCharacterProfilesSafe(params.profile, creatableNames, params.language, {
        theme: params.theme,
        description: [
          params.description?.trim() || '',
          params.language === 'zh'
            ? `候选角色设定摘要：${creatableItems.map(({ candidate, displayName }) => `${displayName} => 本名：${candidate.name}；主要身份：${candidate.role}；设定摘要：${candidate.summary}`).join('；')}`
            : `Candidate role setup summaries: ${creatableItems.map(({ candidate, displayName }) => `${displayName} => name: ${candidate.name}; primary role: ${candidate.role}; setup summary: ${candidate.summary}`).join('; ')}`,
        ].filter(Boolean).join('\n'),
      }, usedVoiceIds);
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
            voiceConfig: { ...(profile.voiceConfig || {}), enabled: Boolean(profile.voiceConfig && 'enabled' in profile.voiceConfig ? profile.voiceConfig.enabled : false), voiceProfile: profile.voiceProfile },
            coreProfile: profile.coreProfile,
            bubbleStyle: profile.bubbleStyle,
            visualIdentity: profile.visualIdentity,
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
          await enqueueAvatarGenerationForCharacters(
            createdCharacters.map((character) => ({
              id: character.id,
              name: character.name,
              group: character.group || '',
              background: character.background || '',
              speakingStyle: character.speakingStyle || '',
              expertise: character.expertise || [],
              personality: character.personality,
              speechProfile: character.speechProfile,
              coreProfile: character.coreProfile,
              visualIdentity: character.visualIdentity,
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

const NAMES_SYSTEM_PROMPT = `You help generate candidate characters from a theme, story, character roster, or dialogue transcript.
Return strict JSON only in this shape: {"characters":[{"name":"Name","role":"primary role","summary":"character setup summary"}],"relationships":[{"fromName":"Name","toName":"Name","note":"relationship clue","tone":"warm|tense|mixed|neutral","strength":0-100,"inferredFrom":"short source clue"}],"circles":[{"name":"relationship circle name","summary":"circle summary","characterNames":["Name"],"keyRelationshipIndexes":[0],"bridgeRelationshipIndexes":[1]}],"defaultSelectedNames":["Name"]}
Rules:
- Build a usable cast, not just a protagonist list.
- Each character must include name, role, and summary.
- relationships should include the important directional relationships between returned characters. Do not generate every pair mechanically.
- circles should group characters into coherent relationship communities: family, faction, workplace, romance/revenge line, conspiracy, old friendship, enemy camp, etc.
- bridgeRelationshipIndexes should point to relationships that connect this circle to another circle.
- name must be an actual person/character name, not only an identity, job title, archetype, or role.
- role should be the most useful primary identity for group chat context; characters may have multiple identities, but include only the main one.
- summary is used later to generate the full character profile and initial relationship axes; include enough context to disambiguate identity, status, relationship, era/genre fit, and why this character belongs in the requested cast.
- summary must name important relationships to other returned characters when available. Preserve layered or contradictory ties, such as spouse plus sibling, former lover plus enemy, sworn family plus political rival, mentor plus betrayer, debt plus protection, or public alliance plus private hatred.
- When relationships are implied, include directional interaction cues that can initialize relationship axes: affection/warmth, trust/distrust, respect/competence, fear/threat, jealousy, guilt, dependency, obligation, rivalry, protection, taboo, secret, betrayal, or unresolved debt.
- If the user provides a story, synopsis, script, chat log, or dialogue, extract concrete named speakers and recurring mentioned characters first. Do not invent extra cast members unless the text clearly implies them or the user asks for expansion.
- For dialogue transcripts, infer each speaker's role, relationship, conflict position, and speaking constraints from the transcript.
- For story text, preserve plot roles, factions, relationships, secrets, and period/world constraints in summary so the later full profile stays grounded in the source.
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
- Every item in characters must be an actual character/person/figure with a primary role and setup summary.
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
  if (/[[\]{}]/.test(normalized)) return false;
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

function clampStrength(value: unknown) {
  return Math.max(0, Math.min(100, typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 50));
}

function normalizeRelationshipTone(value: unknown): CandidateRelationship['tone'] {
  return value === 'warm' || value === 'tense' || value === 'mixed' || value === 'neutral' ? value : 'neutral';
}

function inferRelationshipTone(text: string): CharacterRelationshipViewEdge['tone'] {
  if (/(又爱又恨|爱恨|矛盾|纠缠|复杂|jealous|guilt|guilty|complicated|mixed|love-hate)/i.test(text)) return 'mixed';
  if (/(仇|恨|敌|威胁|背叛|利用|禁忌|冲突|不信任|hostile|enemy|betray|threat|rival|distrust|conflict)/i.test(text)) return 'tense';
  if (/(爱|恋|夫妻|情侣|保护|亲近|信任|同盟|家人|师徒|warm|lover|spouse|protect|trust|ally|family|mentor)/i.test(text)) return 'warm';
  return 'neutral';
}

function resolveCandidateByName(candidates: CandidateCharacter[], value: string) {
  const normalized = value.trim().toLowerCase();
  return candidates.find((candidate) => {
    return candidate.name.trim().toLowerCase() === normalized
      || candidate.id.trim().toLowerCase() === normalized
      || candidate.role.trim().toLowerCase() === normalized;
  }) || null;
}

function sanitizeCandidateRelationships(candidates: CandidateCharacter[], rawItems: unknown): CandidateRelationship[] {
  if (!Array.isArray(rawItems)) return [];
  const relationships: CandidateRelationship[] = [];
  rawItems.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const record = item as { fromName?: unknown; toName?: unknown; note?: unknown; tone?: unknown; strength?: unknown; inferredFrom?: unknown };
    if (typeof record.fromName !== 'string' || typeof record.toName !== 'string') return;
    const from = resolveCandidateByName(candidates, record.fromName);
    const to = resolveCandidateByName(candidates, record.toName);
    if (!from || !to || from.id === to.id) return;
    const note = typeof record.note === 'string' && record.note.trim() ? record.note.trim() : `${from.name} -> ${to.name}`;
    relationships.push({
      id: `${from.id}->${to.id}::${index}`,
      fromName: from.name,
      toName: to.name,
      note,
      tone: normalizeRelationshipTone(record.tone) || inferRelationshipTone(note),
      strength: clampStrength(record.strength),
      inferredFrom: typeof record.inferredFrom === 'string' ? record.inferredFrom.trim().slice(0, 120) : '',
    });
  });
  return relationships;
}

function buildFallbackRelationships(candidates: CandidateCharacter[], nameFormat: NameFormat): CandidateRelationship[] {
  const relationships: CandidateRelationship[] = [];
  candidates.forEach((candidate) => {
    const summary = candidate.summary.toLowerCase();
    candidates.forEach((target) => {
      if (candidate.id === target.id) return;
      const targetNames = [target.name, formatCandidateName(target, nameFormat)]
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
      if (!targetNames.some((name) => summary.includes(name))) return;
      relationships.push({
        id: `${candidate.id}->${target.id}`,
        fromName: candidate.name,
        toName: target.name,
        note: candidate.summary,
        tone: inferRelationshipTone(candidate.summary) || 'neutral',
        strength: inferRelationshipTone(candidate.summary) === 'mixed' ? 74 : inferRelationshipTone(candidate.summary) === 'neutral' ? 46 : 64,
        inferredFrom: candidate.summary.slice(0, 120),
      });
    });
  });
  return relationships;
}

function sanitizeCandidateCircles(candidates: CandidateCharacter[], relationships: CandidateRelationship[], rawItems: unknown): CandidateRelationshipCircle[] {
  if (!Array.isArray(rawItems)) return [];
  const relationshipIds = relationships.map((relationship) => relationship.id);
  return rawItems.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as {
      name?: unknown;
      summary?: unknown;
      characterNames?: unknown;
      keyRelationshipIds?: unknown;
      bridgeRelationshipIds?: unknown;
      keyRelationshipIndexes?: unknown;
      bridgeRelationshipIndexes?: unknown;
    };
    const names = Array.isArray(record.characterNames)
      ? record.characterNames.filter((name): name is string => typeof name === 'string')
      : [];
    const characterNames = names
      .map((name) => resolveCandidateByName(candidates, name)?.name)
      .filter((name): name is string => Boolean(name));
    if (characterNames.length < 2) return [];
    const fromIndexes = (value: unknown) => Array.isArray(value)
      ? value.filter((item): item is number => typeof item === 'number' && Number.isInteger(item)).map((item) => relationshipIds[item]).filter(Boolean)
      : [];
    return [{
      id: `circle-${index}-${characterNames.join('-')}`,
      name: typeof record.name === 'string' && record.name.trim() ? record.name.trim().slice(0, 40) : `关系圈 ${index + 1}`,
      summary: typeof record.summary === 'string' ? record.summary.trim().slice(0, 180) : '',
      characterNames,
      keyRelationshipIds: [
        ...(Array.isArray(record.keyRelationshipIds) ? record.keyRelationshipIds.filter((id): id is string => typeof id === 'string' && relationshipIds.includes(id)) : []),
        ...fromIndexes(record.keyRelationshipIndexes),
      ].slice(0, 8),
      bridgeRelationshipIds: [
        ...(Array.isArray(record.bridgeRelationshipIds) ? record.bridgeRelationshipIds.filter((id): id is string => typeof id === 'string' && relationshipIds.includes(id)) : []),
        ...fromIndexes(record.bridgeRelationshipIndexes),
      ].slice(0, 8),
    }];
  });
}

function buildFallbackCircles(candidates: CandidateCharacter[], relationships: CandidateRelationship[]): CandidateRelationshipCircle[] {
  const parent = new Map(candidates.map((candidate) => [candidate.name, candidate.name]));
  const find = (name: string): string => {
    const current = parent.get(name) || name;
    if (current === name) return current;
    const root = find(current);
    parent.set(name, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };
  relationships.filter((relationship) => relationship.strength >= 45).forEach((relationship) => union(relationship.fromName, relationship.toName));
  const groups = new Map<string, string[]>();
  candidates.forEach((candidate) => {
    const root = find(candidate.name);
    groups.set(root, [...(groups.get(root) || []), candidate.name]);
  });
  return Array.from(groups.values())
    .filter((names) => names.length >= 2)
    .map((names, index) => {
      const memberSet = new Set(names);
      const internalRelationships = relationships.filter((relationship) => memberSet.has(relationship.fromName) && memberSet.has(relationship.toName));
      const bridgeRelationships = relationships.filter((relationship) => memberSet.has(relationship.fromName) !== memberSet.has(relationship.toName));
      return {
        id: `fallback-circle-${index}`,
        name: names.length <= 3 ? names.join(' / ') : `${names[0]} 等人的关系圈`,
        summary: internalRelationships[0]?.note.slice(0, 140) || '',
        characterNames: names,
        keyRelationshipIds: internalRelationships.slice(0, 6).map((relationship) => relationship.id),
        bridgeRelationshipIds: bridgeRelationships.slice(0, 6).map((relationship) => relationship.id),
      };
    });
}

function buildCandidateRelationshipView(candidates: CandidateCharacter[], nameFormat: NameFormat, relationships: CandidateRelationship[], circles: CandidateRelationshipCircle[]) {
  const nodes: CharacterRelationshipViewNode[] = candidates.map((candidate) => ({
    id: candidate.id,
    name: formatCandidateName(candidate, nameFormat),
    graphName: candidate.name,
    role: candidate.role,
    summary: candidate.summary,
  }));
  const candidateByName = new Map(candidates.map((candidate) => [candidate.name, candidate]));
  const edges: CharacterRelationshipViewEdge[] = relationships.flatMap((relationship) => {
    const from = candidateByName.get(relationship.fromName);
    const to = candidateByName.get(relationship.toName);
    if (!from || !to) return [];
    return [{
      id: relationship.id,
      fromId: from.id,
      toId: to.id,
      note: relationship.note,
      tone: relationship.tone,
      strength: relationship.strength,
      inferredFrom: relationship.inferredFrom,
    }];
  });

  const seen = new Set<string>();
  const viewEdges = edges.filter((edge) => {
    const key = `${edge.fromId}->${edge.toId}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 36);
  return {
    nodes,
    edges: viewEdges,
    circles: circles.map((circle): CharacterRelationshipViewCircle => ({
      id: circle.id,
      name: circle.name,
      summary: circle.summary,
      nodeIds: circle.characterNames.map((name) => candidateByName.get(name)?.id).filter((id): id is string => Boolean(id)),
      keyEdgeIds: circle.keyRelationshipIds,
      bridgeEdgeIds: circle.bridgeRelationshipIds,
    })).filter((circle) => circle.nodeIds.length >= 2),
  };
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
    const parsed = JSON.parse(extractJsonObject(content)) as { characters?: unknown; names?: unknown; relationships?: unknown; circles?: unknown; defaultSelectedNames?: unknown };
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
      const relationships = sanitizeCandidateRelationships(candidates, parsed.relationships);
      const circles = sanitizeCandidateCircles(candidates, relationships, parsed.circles);
      return { candidates, relationships, circles, defaultSelectedIds };
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
      return { candidates, relationships: [], circles: [], defaultSelectedIds };
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
      return { candidates, relationships: [], circles: [], defaultSelectedIds: [] };
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
  return { candidates, relationships: [], circles: [], defaultSelectedIds: [] };
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function describeRelationshipSuggestion(suggestion: DefaultRelationshipSuggestion, language: string) {
  const preset = suggestion.preset;
  const cues: string[] = [];
  if (preset.warmth >= 35) cues.push(language.startsWith('zh') ? '亲近' : 'warm');
  if (preset.warmth <= -25) cues.push(language.startsWith('zh') ? '疏离' : 'distant');
  if (preset.trust >= 30) cues.push(language.startsWith('zh') ? '信任' : 'trusting');
  if (preset.trust <= -25) cues.push(language.startsWith('zh') ? '戒备' : 'guarded');
  if (preset.competence >= 30) cues.push(language.startsWith('zh') ? '认可能力' : 'respects ability');
  if (preset.competence <= -25) cues.push(language.startsWith('zh') ? '轻视能力' : 'doubts ability');
  if (preset.threat >= 35) cues.push(language.startsWith('zh') ? '高威胁感' : 'high threat');
  if (preset.threat >= 15 && preset.threat < 35) cues.push(language.startsWith('zh') ? '有威胁感' : 'some threat');
  const fallback = language.startsWith('zh') ? '中性初始印象' : 'neutral initial impression';
  return cues.length ? cues.join(language.startsWith('zh') ? '、' : ', ') : fallback;
}

function formatRelationshipDebug(suggestion: DefaultRelationshipSuggestion, language: string) {
  const preset = suggestion.preset;
  const metrics = `warmth ${preset.warmth}, competence ${preset.competence}, trust ${preset.trust}, threat ${preset.threat}, confidence ${suggestion.confidence.toFixed(2)}`;
  if (!suggestion.reason) return metrics;
  return language.startsWith('zh') ? `${metrics}；依据：${suggestion.reason}` : `${metrics}; reason: ${suggestion.reason}`;
}

function formatRelationshipConfidence(suggestion: DefaultRelationshipSuggestion, language: string) {
  const percentage = `${Math.round(suggestion.confidence * 100)}%`;
  if (suggestion.confidence >= HIGH_RELATIONSHIP_CONFIDENCE) {
    return language.startsWith('zh') ? `高 ${percentage}` : `High ${percentage}`;
  }
  if (suggestion.confidence >= 0.6) {
    return language.startsWith('zh') ? `中 ${percentage}` : `Medium ${percentage}`;
  }
  return language.startsWith('zh') ? `待确认 ${percentage}` : `Review ${percentage}`;
}

function formatRelationshipSkipReason(reason: DefaultRelationshipSuggestionSkipReason, language: string) {
  if (reason === 'protected_existing_relationship') {
    return language.startsWith('zh') ? '已有关系，已跳过' : 'Existing relationship skipped';
  }
  if (reason === 'missing_character') {
    return language.startsWith('zh') ? '角色不存在，已跳过' : 'Missing character skipped';
  }
  return language.startsWith('zh') ? '无效关系，已跳过' : 'Invalid relationship skipped';
}

export default function BatchGenerateCharactersPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { setHeaderTitle, setHeaderActions, setHeaderBackAction } = useLayoutHeaderActions();
  const settings = useSettingsStore(useShallow((state) => ({
    aiProfiles: state.aiProfiles,
    customBubbleStyles: state.customBubbleStyles,
    developerMode: state.developerMode,
  })));
  const { characters, markCharactersWarm, prefetchCharacters, addCharacters, updateCharacters } = useCharacterStore(useShallow((state) => ({
    characters: state.characters,
    markCharactersWarm: state.markCharactersWarm,
    prefetchCharacters: state.prefetchCharacters,
    addCharacters: state.addCharacters,
    updateCharacters: state.updateCharacters,
  })));
  const initialParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const [topic, setTopic] = useState(() => initialParams.get('topic') || '');
  const [description, setDescription] = useState(() => initialParams.get('description') || '');
  const [candidateCharacters, setCandidateCharacters] = useState<CandidateCharacter[]>([]);
  const [candidateRelationships, setCandidateRelationships] = useState<CandidateRelationship[]>([]);
  const [candidateCircles, setCandidateCircles] = useState<CandidateRelationshipCircle[]>([]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [previewCandidate, setPreviewCandidate] = useState<CandidateCharacter | null>(null);
  const [activeTab, setActiveTab] = useState<BatchGenerateTab>('list');
  const [lastCreatedCharacters, setLastCreatedCharacters] = useState<AICharacter[]>([]);
  const [showGenerateCharactersFab, setShowGenerateCharactersFab] = useState(true);
  const [relationshipCompletionPreviewOpen, setRelationshipCompletionPreviewOpen] = useState(false);
  const [relationshipCompletionSuggestions, setRelationshipCompletionSuggestions] = useState<DefaultRelationshipSuggestion[]>([]);
  const [selectedRelationshipSuggestionIds, setSelectedRelationshipSuggestionIds] = useState<string[]>([]);
  const [relationshipSuggestionSkipReasons, setRelationshipSuggestionSkipReasons] = useState<Record<string, DefaultRelationshipSuggestionSkipReason>>({});
  const [appliedRelationshipSuggestionIds, setAppliedRelationshipSuggestionIds] = useState<string[]>([]);
  const [relationshipCompleting, setRelationshipCompleting] = useState(false);
  const [relationshipCompletionApplying, setRelationshipCompletionApplying] = useState(false);
  const [relationshipCompletionResult, setRelationshipCompletionResult] = useState<{ applied: number; skipped: number } | null>(null);
  const [nameFormat, setNameFormat] = useState<NameFormat>('nameParenRole');
  const [pendingNameFormat, setPendingNameFormat] = useState<NameFormat>('nameParenRole');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loadingNames, setLoadingNames] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; currentName?: string; items: ProgressItem[] }>({ current: 0, total: 0, currentName: '', items: [] });
  const [freeEntitlement, setFreeEntitlement] = useState<VipEntitlementInfo | null>(null);
  const [freeEntitlementLoading, setFreeEntitlementLoading] = useState(false);
  const [membership, setMembership] = useState<BillingMembershipResponse | null>(null);
  const [membershipLoading, setMembershipLoading] = useState(false);
  const [membershipLoaded, setMembershipLoaded] = useState(false);
  const [membershipLoadFailed, setMembershipLoadFailed] = useState(false);
  const [vipLimitDialog, setVipLimitDialog] = useState<{ title: string; description: string; current?: number | null; limit?: number | null; helperText?: string } | null>(null);
  const cancelGenerationRef = useRef(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });
  const returnTo = initialParams.get('returnTo');
  const authMode = useAuthStore((state) => state.authMode);
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn);

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

  useEffect(() => {
    let active = true;
    if (authMode !== 'cloud' || !isLoggedIn) {
      setMembership(null);
      setMembershipLoading(false);
      setMembershipLoaded(true);
      setMembershipLoadFailed(false);
      return () => {
        active = false;
      };
    }
    setMembershipLoading(true);
    setMembershipLoaded(false);
    setMembershipLoadFailed(false);
    api.getBillingMembership()
      .then((result) => {
        if (active) {
          setMembership(result);
          setMembershipLoaded(true);
          setMembershipLoadFailed(false);
        }
      })
      .catch(() => {
        if (active) {
          setMembership(null);
          setMembershipLoaded(true);
          setMembershipLoadFailed(true);
        }
      })
      .finally(() => {
        if (active) setMembershipLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authMode, isLoggedIn]);

  useEffect(() => {
    let active = true;
    setFreeEntitlementLoading(true);
    api.getBillingMembershipConfig()
      .then((result) => {
        if (active) setFreeEntitlement(result.entitlements?.free || null);
      })
      .catch(() => {
        if (active) setFreeEntitlement(null);
      })
      .finally(() => {
        if (active) setFreeEntitlementLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedSet = useMemo(() => new Set(selectedCandidateIds), [selectedCandidateIds]);
  const selectedCandidates = useMemo(() => candidateCharacters.filter((candidate) => selectedSet.has(candidate.id)), [candidateCharacters, selectedSet]);
  const selectedRelationshipSuggestionSet = useMemo(() => new Set(selectedRelationshipSuggestionIds), [selectedRelationshipSuggestionIds]);
  const appliedRelationshipSuggestionSet = useMemo(() => new Set(appliedRelationshipSuggestionIds), [appliedRelationshipSuggestionIds]);
  const selectableRelationshipSuggestions = useMemo(() => relationshipCompletionSuggestions.filter((suggestion) => !relationshipSuggestionSkipReasons[suggestion.id] && !appliedRelationshipSuggestionSet.has(suggestion.id)), [appliedRelationshipSuggestionSet, relationshipCompletionSuggestions, relationshipSuggestionSkipReasons]);
  const allRelationshipSuggestionsSelected = selectableRelationshipSuggestions.length > 0 && selectedRelationshipSuggestionIds.length === selectableRelationshipSuggestions.length;
  const someRelationshipSuggestionsSelected = selectedRelationshipSuggestionIds.length > 0 && !allRelationshipSuggestionsSelected;
  const relationshipView = useMemo(() => {
    const relationships = candidateRelationships.length ? candidateRelationships : buildFallbackRelationships(candidateCharacters, nameFormat);
    const circles = candidateCircles.length ? candidateCircles : buildFallbackCircles(candidateCharacters, relationships);
    return buildCandidateRelationshipView(candidateCharacters, nameFormat, relationships, circles);
  }, [candidateCharacters, candidateCircles, candidateRelationships, nameFormat]);
  const example = useMemo(() => BATCH_GENERATE_EXAMPLES[Math.floor(Math.random() * BATCH_GENERATE_EXAMPLES.length)], []);
  const localizedExample = i18n.language.startsWith('zh') ? example.zh : example.en;
  const textProfile = useMemo(() => getPreferredAIProfile(settings.aiProfiles, 'text'), [settings.aiProfiles]);
  const platformAi = usesPlatformAi(textProfile);
  const useFreeEntitlement = authMode !== 'cloud' || !isLoggedIn;
  const entitlement = platformAi
    ? useFreeEntitlement
      ? freeEntitlement
      : membership?.vipEntitlement?.entitlement || null
    : null;
  const entitlementLoading = platformAi && (useFreeEntitlement ? freeEntitlementLoading : membershipLoading);
  const entitlementUnavailable = platformAi && !useFreeEntitlement && membershipLoaded && membershipLoadFailed;
  const dailyGenerationLimit = platformAi ? entitlement?.dailyAiGenerationLimit ?? null : null;
  const dailyGenerationUsed = Number(membership?.dailyAiGenerationUsage?.used || 0);
  const dailyGenerationRemaining = dailyGenerationLimit == null || dailyGenerationLimit < 0 ? null : Math.max(0, dailyGenerationLimit - dailyGenerationUsed);
  const batchCharacterLimit = platformAi ? entitlement?.batchGenerationLimit ?? null : null;
  const dailyGenerationExhausted = dailyGenerationRemaining != null && dailyGenerationRemaining <= 0;
  const batchSelectionExceeded = batchCharacterLimit != null && batchCharacterLimit >= 0 && selectedCandidateIds.length > batchCharacterLimit;
  const canGenerateNames = Boolean(topic.trim() || description.trim()) && !loadingNames && !dailyGenerationExhausted;
  const canGenerateCharacters = selectedCandidateIds.length > 0 && !generating && !batchSelectionExceeded;
  const entitlementLimitLabel = entitlementUnavailable
    ? (i18n.language.startsWith('zh')
      ? '暂时无法确认当前账号权益，生成时会由服务器再次校验'
      : 'Unable to confirm account quota. The server will validate it when generating')
    : platformAi
      ? [
      dailyGenerationLimit == null || dailyGenerationLimit < 0
        ? (i18n.language.startsWith('zh') ? '今日生成：-' : 'Daily generation: -')
        : (i18n.language.startsWith('zh') ? `今日生成：${dailyGenerationUsed}/${dailyGenerationLimit}` : `Daily generation: ${dailyGenerationUsed}/${dailyGenerationLimit}`),
      batchCharacterLimit == null || batchCharacterLimit < 0
        ? (i18n.language.startsWith('zh') ? '单次批量：-' : 'Batch size: -')
        : (i18n.language.startsWith('zh') ? `单次批量：最多 ${batchCharacterLimit}` : `Batch size: max ${batchCharacterLimit}`),
      ].join(' · ')
      : (i18n.language.startsWith('zh')
        ? '自定义 AI：不占用平台生成次数 · 单次批量：-'
        : 'Custom AI: does not use platform generation quota · Batch size: -');

  const toggleCandidate = (candidateId: string) => {
    if (!selectedCandidateIds.includes(candidateId) && batchCharacterLimit != null && batchCharacterLimit >= 0 && selectedCandidateIds.length >= batchCharacterLimit) {
      setVipLimitDialog({
        title: '单次批量生成已达上限',
        description: `当前会员单次最多新增 ${batchCharacterLimit} 个角色。默认选中的名单会保留，继续增加选择需要升级 VIP。`,
        current: selectedCandidateIds.length,
        limit: batchCharacterLimit,
        helperText: '你可以先取消不需要的角色，再选择新的角色。',
      });
      return;
    }
    setSelectedCandidateIds((prev) =>
      prev.includes(candidateId)
        ? prev.filter((item) => item !== candidateId)
        : [...prev, candidateId]
    );
  };

  const toggleRelationshipSuggestion = (suggestionId: string) => {
    if (relationshipSuggestionSkipReasons[suggestionId] || appliedRelationshipSuggestionSet.has(suggestionId)) return;
    setSelectedRelationshipSuggestionIds((prev) =>
      prev.includes(suggestionId)
        ? prev.filter((item) => item !== suggestionId)
        : [...prev, suggestionId]
    );
  };

  const handleFetchNames = async () => {
    if (dailyGenerationExhausted) {
      setVipLimitDialog({
        title: '今日生成次数已用完',
        description: '生成名单会消耗每日 AI 生成次数。当前会员今天的次数已经用完，升级 VIP 后可以获得更高的每日生成额度。',
        current: dailyGenerationUsed,
        limit: dailyGenerationLimit,
        helperText: '明天会自动恢复当天额度。',
      });
      return;
    }
    const profile = getPreferredAIProfile(settings.aiProfiles, 'text');
    if (!isAIProfileUsable(profile)) {
      setSnackbar({ open: true, message: i18n.language.startsWith('zh') ? '请先配置AI模型' : 'Configure AI model first', severity: 'error' });
      return;
    }

    setLoadingNames(true);
    try {
      const promptInput = [
        topic.trim() ? (i18n.language.startsWith('zh') ? `主题/分组：${topic.trim()}` : `Theme/group: ${topic.trim()}`) : '',
        description.trim() ? (i18n.language.startsWith('zh') ? `故事/对话/描述：${description.trim()}` : `Story/dialogue/description: ${description.trim()}`) : '',
      ].filter(Boolean).join('\n');
      const response = await generateResponse(
        profile,
        `${NAMES_SYSTEM_PROMPT}\nOutput exactly one valid JSON object. Do not include trailing commas. Do not truncate. Do not add explanations before or after the JSON.`,
        [{ role: 'user', content: i18n.language.startsWith('zh') ? `${promptInput}\n请根据主题/分组、故事、对话或描述列出一个适合放进同一群聊的角色阵容。如果输入是故事、剧本或聊天记录，优先提取文本中真实出现的说话者、核心人物和反复被提到的重要人物；不要为了凑数捏造无依据的新角色。如果描述里指定数量或身份结构（例如“皇帝和10个妃子”），必须按描述生成对应数量与构成。每个角色必须有真实名字、主要身份和设定摘要。主要身份只写最有助于群聊理解的一个身份；设定摘要要说明角色在该主题/故事/对话中的具体身份、地位、关系、冲突立场、说话约束和设定边界，后续生成具体角色和初始化角色关系会依赖它避免跑偏。如果角色之间有情侣、夫妻、前任、亲属、师徒、主仆、同盟、背叛、生死仇敌、债务、秘密、禁忌、互相保护或互相利用等关系，必须在相关角色的摘要里点名对方；如果同一对角色存在多重或矛盾关系，也要同时保留。关系摘要要能推断亲近、信任、尊重、威胁、嫉妒、愧疚、依赖、敌意等方向性差异。请额外输出 relationships 作为重要方向性关系边，不要机械生成所有组合；再输出 circles，把角色按家庭、阵营、旧情复仇线、阴谋线、敌对阵营等关系圈分组，并用 keyRelationshipIndexes/bridgeRelationshipIndexes 指向 relationships 数组下标。不要只给主角，需要同时包含核心角色、重要配角、反派/对手、老师/家人/同伴，以及少量但强相关的边缘角色。并请额外判断哪些角色应该默认选中作为初始群聊阵容。只返回合法JSON，格式必须是 {"characters":[{"name":"名字","role":"主要身份","summary":"设定摘要"}],"relationships":[{"fromName":"名字","toName":"名字","note":"关系线索","tone":"warm|tense|mixed|neutral","strength":80,"inferredFrom":"依据"}],"circles":[{"name":"关系圈名称","summary":"圈子摘要","characterNames":["名字"],"keyRelationshipIndexes":[0],"bridgeRelationshipIndexes":[1]}],"defaultSelectedNames":["名字"]}` : `${promptInput}\nReturn a cast suitable for the same group chat based on the theme/group, story, dialogue, or description. If the input is a story, script, or chat log, first extract concrete speakers, core characters, and important recurring mentioned characters from the source text; do not invent unsupported extra characters just to increase the count. If the description specifies a count or role composition, follow it exactly. Each character must have a real name, primary role, and setup summary. The role should be the single most useful identity for group chat context; the setup summary must explain the character's concrete identity, status, relationships, conflict position, speaking constraints, and setting boundaries within this exact theme/story/dialogue, because full profile generation and initial relationship inference will rely on it to avoid drifting. If characters are lovers, spouses, exes, relatives, mentor/student, master/servant, allies, betrayers, mortal enemies, debt-bound, secret-bound, taboo-bound, protectors, or manipulators, name the counterpart in the relevant summaries. Preserve layered or contradictory ties between the same pair. Relationship summaries should support directional warmth, trust, respect, threat, jealousy, guilt, dependency, hostility, and obligation inference. Also output relationships as important directional edges without mechanically generating every pair; then output circles that group characters by family, faction, romance/revenge line, conspiracy, enemy camp, workplace, or old friendship. Use keyRelationshipIndexes/bridgeRelationshipIndexes to reference indexes in the relationships array. Do not return only protagonists. Include core characters, important supporting characters, rivals/antagonists, mentors/family/allies, and a few strongly related peripheral figures. Also decide which characters should be selected by default as the initial cast. Return only valid JSON in the format {"characters":[{"name":"Name","role":"primary role","summary":"setup summary"}],"relationships":[{"fromName":"Name","toName":"Name","note":"relationship clue","tone":"warm|tense|mixed|neutral","strength":80,"inferredFrom":"basis"}],"circles":[{"name":"circle name","summary":"circle summary","characterNames":["Name"],"keyRelationshipIndexes":[0],"bridgeRelationshipIndexes":[1]}],"defaultSelectedNames":["Name"]}.` }],
        undefined,
        { aiUsage: { type: 'group_creation', label: '生成群聊角色阵容', scope: 'batch_character_generation' } },
      );
      const parsed = parseNames(response);
      const fallbackRelationships = parsed.relationships.length ? parsed.relationships : buildFallbackRelationships(parsed.candidates, nameFormat);
      setCandidateCharacters(parsed.candidates);
      setCandidateRelationships(fallbackRelationships);
      setCandidateCircles(parsed.circles.length ? parsed.circles : buildFallbackCircles(parsed.candidates, fallbackRelationships));
      setSelectedCandidateIds(parsed.defaultSelectedIds.length ? parsed.defaultSelectedIds : parsed.candidates.slice(0, Math.min(4, parsed.candidates.length)).map((candidate) => candidate.id));
      setLastCreatedCharacters([]);
      setShowGenerateCharactersFab(true);
      setRelationshipCompletionPreviewOpen(false);
      setRelationshipCompletionSuggestions([]);
      setSelectedRelationshipSuggestionIds([]);
      setRelationshipSuggestionSkipReasons({});
      setAppliedRelationshipSuggestionIds([]);
      setRelationshipCompletionResult(null);
      setActiveTab('list');
    } catch (error) {
      setSnackbar({ open: true, message: error instanceof Error ? error.message : t('common.error'), severity: 'error' });
    } finally {
      setLoadingNames(false);
    }
  };

  const handleGenerateCharacters = async () => {
    if (batchSelectionExceeded) {
      setVipLimitDialog({
        title: '本次选择超过单次上限',
        description: `当前会员单次最多批量生成 ${batchCharacterLimit} 个角色。你可以减少选择数量，或升级 VIP 后继续批量生成更大的阵容。`,
        current: selectedCandidateIds.length,
        limit: batchCharacterLimit,
      });
      return;
    }
    const profile = getPreferredAIProfile(settings.aiProfiles, 'text');
    if (!isAIProfileUsable(profile)) {
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
      if (isAIProfileUsable(relationshipProfile) && createdCharacters.length) {
        void initializeDefaultRelationshipsForCreatedCharacters({
          config: relationshipProfile,
          createdCharacters,
          allCharacters: useCharacterStore.getState().characters,
          language: i18n.language.startsWith('zh') ? 'zh' : 'en',
          updateCharacters,
          // Use the same selected-member analysis mode as group creation so
          // the batch can be reused as a relationship-analysis context.
          scope: 'selected_members',
        }).catch((error) => {
          console.error('[batch-generate:default-relationships:error]', error);
        });
      }

      setLastCreatedCharacters(createdCharacters);
      if (!cancelGenerationRef.current && createdCharacters.length) {
        setShowGenerateCharactersFab(false);
      }
      setRelationshipCompletionPreviewOpen(false);
      setRelationshipCompletionSuggestions([]);
      setSelectedRelationshipSuggestionIds([]);
      setRelationshipSuggestionSkipReasons({});
      setAppliedRelationshipSuggestionIds([]);
      setRelationshipCompletionResult(null);
      if (!cancelGenerationRef.current && createdCharacters.length) {
        setActiveTab('completion');
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
        if (createdCharacters.length) {
          sessionStorage.setItem(BATCH_GENERATED_MEMBER_IDS_KEY, JSON.stringify({
            returnTo,
            characterIds: createdCharacters.map((character) => character.id),
          }));
        }
        navigate(`${returnTo}${returnTo.includes('?') ? '&' : '?'}restoreDraft=1`, { replace: true });
      }
    } catch (error) {
      setSnackbar({ open: true, message: error instanceof Error ? error.message : t('common.error'), severity: 'error' });
    } finally {
      setGenerating(false);
      setProgress({ current: 0, total: 0, currentName: '', items: [] });
    }
  };

  const handlePrepareRelationshipCompletion = async () => {
    const profile = getPreferredAIProfile(useSettingsStore.getState().aiProfiles, 'text');
    if (!isAIProfileUsable(profile)) {
      setSnackbar({ open: true, message: i18n.language.startsWith('zh') ? '请先配置AI模型' : 'Configure AI model first', severity: 'error' });
      return;
    }
    if (!lastCreatedCharacters.length) {
      setSnackbar({ open: true, message: i18n.language.startsWith('zh') ? '还没有可补全关系的新角色' : 'No newly created characters to complete', severity: 'error' });
      return;
    }

    setRelationshipCompleting(true);
    setRelationshipCompletionResult(null);
    setRelationshipSuggestionSkipReasons({});
    setAppliedRelationshipSuggestionIds([]);
    try {
      const createdIds = new Set(lastCreatedCharacters.map((character) => character.id));
      const suggestions = (await buildDefaultRelationshipSuggestions({
        config: profile,
        createdCharacters: lastCreatedCharacters,
        allCharacters: useCharacterStore.getState().characters,
        language: i18n.language.startsWith('zh') ? 'zh' : 'en',
        scope: 'created_and_existing',
      })).filter((suggestion) => {
        const fromCreated = createdIds.has(suggestion.fromId);
        const toCreated = createdIds.has(suggestion.toId);
        return fromCreated !== toCreated;
      });
      setRelationshipCompletionSuggestions(suggestions);
      setSelectedRelationshipSuggestionIds(suggestions.filter((suggestion) => suggestion.confidence >= HIGH_RELATIONSHIP_CONFIDENCE).map((suggestion) => suggestion.id));
      setRelationshipCompletionPreviewOpen(true);
      if (!suggestions.length) {
        setSnackbar({
          open: true,
          message: i18n.language.startsWith('zh') ? '没有识别到需要补全的默认关系' : 'No default relationships need completion',
          severity: 'success',
        });
      }
    } catch (error) {
      setSnackbar({ open: true, message: error instanceof Error ? error.message : t('common.error'), severity: 'error' });
    } finally {
      setRelationshipCompleting(false);
    }
  };

  const handleApplyRelationshipCompletion = async () => {
    const selectedSet = new Set(selectedRelationshipSuggestionIds);
    const selectedSuggestions = relationshipCompletionSuggestions.filter((suggestion) => selectedSet.has(suggestion.id));
    if (!selectedSuggestions.length) {
      setSnackbar({ open: true, message: i18n.language.startsWith('zh') ? '请选择至少一条关系' : 'Select at least one relationship', severity: 'error' });
      return;
    }

    setRelationshipCompletionApplying(true);
    setRelationshipCompletionResult(null);
    try {
      const plan = planDefaultRelationshipPatchesFromSuggestions({
        suggestions: selectedSuggestions,
        allCharacters: useCharacterStore.getState().characters,
        language: i18n.language.startsWith('zh') ? 'zh' : 'en',
      });
      if (plan.patches.length) await updateCharacters(plan.patches);
      const appliedIds = plan.results.filter((result) => result.status === 'applied').map((result) => result.suggestionId);
      const skippedReasons = plan.results.reduce<Record<string, DefaultRelationshipSuggestionSkipReason>>((acc, result) => {
        if (result.status === 'skipped' && result.reason) acc[result.suggestionId] = result.reason;
        return acc;
      }, {});
      setAppliedRelationshipSuggestionIds((prev) => Array.from(new Set([...prev, ...appliedIds])));
      setRelationshipSuggestionSkipReasons((prev) => ({ ...prev, ...skippedReasons }));
      setSelectedRelationshipSuggestionIds((prev) => prev.filter((id) => !appliedIds.includes(id) && !skippedReasons[id]));
      setRelationshipCompletionResult({ applied: appliedIds.length, skipped: plan.results.length - appliedIds.length });
      markCharactersWarm();
      void prefetchCharacters();
      setSnackbar({
        open: true,
        message: i18n.language.startsWith('zh') ? `已写入 ${appliedIds.length} 条默认关系，跳过 ${plan.results.length - appliedIds.length} 条` : `Applied ${appliedIds.length} default relationship(s), skipped ${plan.results.length - appliedIds.length}`,
        severity: 'success',
      });
    } catch (error) {
      setSnackbar({ open: true, message: error instanceof Error ? error.message : t('common.error'), severity: 'error' });
    } finally {
      setRelationshipCompletionApplying(false);
    }
  };

  return (
    <Box sx={{
      p: 3,
      pt: { xs: 1, sm: 1, md: 3 },
      pb: { xs: MOBILE_BOTTOM_NAV_CONTENT_PADDING, sm: 3 },
      maxWidth: 1180,
      mx: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
    }}>
      <Box sx={{ p: 2.5, border: 1, borderColor: 'divider', borderRadius: 4, bgcolor: 'background.paper', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Alert severity={!entitlementLoading && (entitlementUnavailable || dailyGenerationExhausted || batchSelectionExceeded) ? 'warning' : 'info'} sx={{ alignItems: 'center' }}>
          {entitlementLoading
            ? (i18n.language.startsWith('zh') ? '正在读取会员权益限制…' : 'Loading membership limits...')
            : entitlementLimitLabel}
          {batchSelectionExceeded
            ? (i18n.language.startsWith('zh') ? `，当前已选择 ${selectedCandidateIds.length} 个。` : `, selected ${selectedCandidateIds.length}.`)
            : ''}
        </Alert>
        <TextField
          label={i18n.language.startsWith('zh') ? '主题/分组' : 'Theme/group'}
          placeholder={i18n.language.startsWith('zh') ? `例如：${localizedExample.topic}` : `e.g. ${localizedExample.topic}`}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          fullWidth
        />
        <TextField
          label={i18n.language.startsWith('zh') ? '故事、对话或描述' : 'Story, dialogue, or description'}
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
          maxRows={10}
          sx={{
            '& .MuiInputBase-inputMultiline': {
              maxHeight: 280,
              overflow: 'auto',
            },
          }}
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
          <Box sx={{ alignSelf: 'flex-start' }}>
            <FloatingSegmentedTabs
              value={activeTab}
              scrollContentToTopOnChange
              items={[
                { value: 'list', label: i18n.language.startsWith('zh') ? '名单' : 'List' },
                { value: 'relationships', label: i18n.language.startsWith('zh') ? '关系' : 'Relationships' },
                ...(lastCreatedCharacters.length ? [{ value: 'completion' as const, label: i18n.language.startsWith('zh') ? '关系补全' : 'Complete' }] : []),
              ]}
              onChange={setActiveTab}
              equalWidth={false}
            />
          </Box>

          {activeTab === 'list' ? (
            <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper', p: { xs: 1.25, sm: 1.5 }, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' }}>
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                  {selectedCandidateIds.length}/{candidateCharacters.length}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' }}>
                  <Button size="small" variant="outlined" onClick={() => {
                    if (batchCharacterLimit != null && candidateCharacters.length > batchCharacterLimit) {
                      setVipLimitDialog({
                        title: '全选会超过单次上限',
                        description: `当前名单共有 ${candidateCharacters.length} 个角色，当前会员单次最多批量生成 ${batchCharacterLimit} 个。默认推荐名单不受影响，但手动全选需要更高的 VIP 权益。`,
                        current: candidateCharacters.length,
                        limit: batchCharacterLimit,
                      });
                      return;
                    }
                    setSelectedCandidateIds(candidateCharacters.map((candidate) => candidate.id));
                  }}>
                    {i18n.language.startsWith('zh') ? '全选' : 'Select all'}
                  </Button>
                  <Button size="small" variant="outlined" onClick={() => {
                    const nextIds = candidateCharacters.filter((candidate) => !selectedSet.has(candidate.id)).map((candidate) => candidate.id);
                    if (batchCharacterLimit != null && nextIds.length > batchCharacterLimit) {
                      setVipLimitDialog({
                        title: '反选会超过单次上限',
                        description: `反选后会选择 ${nextIds.length} 个角色，当前会员单次最多批量生成 ${batchCharacterLimit} 个。`,
                        current: nextIds.length,
                        limit: batchCharacterLimit,
                      });
                      return;
                    }
                    setSelectedCandidateIds(nextIds);
                  }}>
                    {i18n.language.startsWith('zh') ? '反选' : 'Invert'}
                  </Button>
                </Box>
              </Box>
              <Box
                sx={{
                  columnCount: { xs: 2, sm: 3, md: 2, lg: 3 },
                  columnGap: 1,
                }}
              >
                {candidateCharacters.map((candidate) => {
                  const selected = selectedSet.has(candidate.id);
                  const displayName = formatCandidateName(candidate, nameFormat);
                  return (
                    <Box
                      key={candidate.id}
                      sx={{
                        display: 'inline-grid',
                        width: '100%',
                        breakInside: 'avoid',
                        mb: 1,
                        gridTemplateColumns: { xs: 'minmax(0, 1fr) 34px', md: 'minmax(0, 1fr) 38px' },
                        alignItems: 'stretch',
                        minHeight: { xs: 44, md: 0 },
                        border: 1,
                        borderColor: selected ? 'primary.main' : 'divider',
                        borderRadius: 2,
                        bgcolor: selected ? { xs: 'primary.main', md: 'primary.main' } : 'background.default',
                        color: selected ? 'primary.contrastText' : 'text.primary',
                        overflow: 'hidden',
                        transition: (theme) => theme.transitions.create(['border-color', 'background-color', 'box-shadow'], { duration: theme.transitions.duration.shortest }),
                        boxShadow: selected ? '0 1px 5px rgba(0,0,0,0.14)' : 'none',
                      }}
                    >
                      <Box
                        component="button"
                        type="button"
                        onClick={() => toggleCandidate(candidate.id)}
                        aria-pressed={selected}
                        sx={{
                          height: '100%',
                          minWidth: 0,
                          border: 0,
                          bgcolor: 'transparent',
                          color: 'inherit',
                          cursor: 'pointer',
                          textAlign: 'left',
                          px: { xs: 1.25, md: 1.35 },
                          py: { xs: 0.75, md: 1.1 },
                          font: 'inherit',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'stretch',
                          gap: { xs: 0, md: 0.75 },
                        }}
                      >
                        <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: selected ? 600 : 500 }}>
                          {displayName}
                        </Typography>
                        <Typography variant="caption" sx={{ display: { xs: 'none', md: '-webkit-box' }, color: selected ? 'inherit' : 'text.secondary', opacity: selected ? 0.9 : 1, WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                          {candidate.summary}
                        </Typography>
                      </Box>
                      <Tooltip title={i18n.language.startsWith('zh') ? '预览角色信息' : 'Preview role info'} arrow>
                        <IconButton
                          size="small"
                          onClick={() => setPreviewCandidate(candidate)}
                          aria-label={i18n.language.startsWith('zh') ? `预览${displayName}` : `Preview ${displayName}`}
                          sx={{
                            display: 'inline-flex',
                            width: 32,
                            height: 32,
                            mr: 0.25,
                            mt: { xs: 0, md: 0.5 },
                            alignSelf: { xs: 'center', md: 'flex-start' },
                            color: selected ? 'primary.contrastText' : 'text.secondary',
                            '&:hover': { bgcolor: selected ? 'rgba(255,255,255,0.16)' : 'action.hover' },
                          }}
                        >
                          <InfoOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          ) : null}

          {activeTab === 'relationships' ? (
            <CharacterRelationshipView
              nodes={relationshipView.nodes}
              edges={relationshipView.edges}
              circles={relationshipView.circles}
              emptyTitle={i18n.language.startsWith('zh') ? '暂未识别到明确关系线索' : 'No clear relationship clues yet'}
              emptyDescription={i18n.language.startsWith('zh') ? '可以在故事或对话里点名角色之间的关系，重新生成名单后这里会显示。' : 'Mention relationships between characters in the story or dialogue, then regenerate the list.'}
            />
          ) : null}

          {activeTab === 'completion' && lastCreatedCharacters.length ? (
            <Box sx={{ minHeight: 240, border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper', p: { xs: 1.5, sm: 2 }, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {!relationshipCompletionPreviewOpen ? (
                <Box sx={{ minHeight: 208, display: 'grid', placeItems: 'center' }}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, maxWidth: 520, textAlign: 'center' }}>
                    {relationshipCompletionResult ? (
                      <Alert severity="success" sx={{ width: '100%' }}>
                        {i18n.language.startsWith('zh')
                          ? `已写入 ${relationshipCompletionResult.applied} 条默认关系，跳过 ${relationshipCompletionResult.skipped} 条`
                          : `Applied ${relationshipCompletionResult.applied} default relationship(s), skipped ${relationshipCompletionResult.skipped}`}
                      </Alert>
                    ) : null}
                    <Button
                      variant="contained"
                      startIcon={relationshipCompleting ? <CircularProgress size={18} color="inherit" /> : <AutoAwesomeIcon />}
                      onClick={handlePrepareRelationshipCompletion}
                      disabled={relationshipCompleting}
                      sx={{ minHeight: 46, borderRadius: 999, px: 2.5 }}
                    >
                      {i18n.language.startsWith('zh') ? '补全与已有角色的关系' : 'Complete relationships with existing characters'}
                    </Button>
                  </Box>
                </Box>
              ) : (
                <>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box>
                      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                        {i18n.language.startsWith('zh') ? '待补全关系' : 'Relationships to complete'}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {i18n.language.startsWith('zh')
                          ? `默认只选中高置信度关系：${selectedRelationshipSuggestionIds.length}/${relationshipCompletionSuggestions.length}`
                          : `High-confidence relationships selected by default: ${selectedRelationshipSuggestionIds.length}/${relationshipCompletionSuggestions.length}`}
                      </Typography>
                    </Box>
                    <Button
                      variant="contained"
                      startIcon={relationshipCompletionApplying ? <CircularProgress size={18} color="inherit" /> : <AutoAwesomeIcon />}
                      onClick={handleApplyRelationshipCompletion}
                      disabled={relationshipCompletionApplying || selectedRelationshipSuggestionIds.length === 0 || selectableRelationshipSuggestions.length === 0}
                      sx={{ borderRadius: 999, px: 2.5 }}
                    >
                      {i18n.language.startsWith('zh') ? '补全' : 'Complete'}
                    </Button>
                  </Box>
                  {relationshipCompletionResult ? (
                    <Alert severity="success">
                      {i18n.language.startsWith('zh')
                        ? `已写入 ${relationshipCompletionResult.applied} 条默认关系，跳过 ${relationshipCompletionResult.skipped} 条`
                        : `Applied ${relationshipCompletionResult.applied} default relationship(s), skipped ${relationshipCompletionResult.skipped}`}
                    </Alert>
                  ) : null}
                  {relationshipCompletionSuggestions.length ? (
                    <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, maxHeight: 460 }}>
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow>
                            <TableCell padding="checkbox">
                              <Checkbox
                                size="small"
                                checked={allRelationshipSuggestionsSelected}
                                indeterminate={someRelationshipSuggestionsSelected}
                                disabled={!selectableRelationshipSuggestions.length}
                                onChange={(event) => setSelectedRelationshipSuggestionIds(event.target.checked ? selectableRelationshipSuggestions.map((suggestion) => suggestion.id) : [])}
                              />
                            </TableCell>
                            <TableCell>{i18n.language.startsWith('zh') ? '方向' : 'Direction'}</TableCell>
                            <TableCell>{i18n.language.startsWith('zh') ? '状态' : 'Status'}</TableCell>
                            <TableCell>{i18n.language.startsWith('zh') ? '置信度' : 'Confidence'}</TableCell>
                            <TableCell>{i18n.language.startsWith('zh') ? '关系描述' : 'Relationship'}</TableCell>
                            {settings.developerMode ? <TableCell>{i18n.language.startsWith('zh') ? '默认值' : 'Defaults'}</TableCell> : null}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {relationshipCompletionSuggestions.map((suggestion) => {
                            const selected = selectedRelationshipSuggestionSet.has(suggestion.id);
                            const skipReason = relationshipSuggestionSkipReasons[suggestion.id];
                            const applied = appliedRelationshipSuggestionSet.has(suggestion.id);
                            const disabled = Boolean(skipReason || applied);
                            return (
                              <TableRow
                                key={suggestion.id}
                                hover={!disabled}
                                selected={selected}
                                sx={{ cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.72 : 1 }}
                                onClick={() => toggleRelationshipSuggestion(suggestion.id)}
                              >
                                <TableCell padding="checkbox">
                                  <Checkbox
                                    size="small"
                                    checked={selected}
                                    disabled={disabled}
                                    onChange={() => toggleRelationshipSuggestion(suggestion.id)}
                                    onClick={(event) => event.stopPropagation()}
                                  />
                                </TableCell>
                                <TableCell sx={{ minWidth: 150 }}>
                                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                    {suggestion.fromName} → {suggestion.toName}
                                  </Typography>
                                </TableCell>
                                <TableCell sx={{ minWidth: 118 }}>
                                  <Typography variant="body2" color={applied ? 'success.main' : skipReason ? 'text.secondary' : 'primary.main'} sx={{ fontWeight: applied ? 700 : 500, whiteSpace: 'nowrap' }}>
                                    {applied
                                      ? (i18n.language.startsWith('zh') ? '已补全' : 'Applied')
                                      : skipReason
                                        ? formatRelationshipSkipReason(skipReason, i18n.language)
                                        : (i18n.language.startsWith('zh') ? '可补全' : 'Ready')}
                                  </Typography>
                                </TableCell>
                                <TableCell sx={{ minWidth: 96 }}>
                                  <Typography
                                    variant="body2"
                                    sx={{
                                      fontWeight: suggestion.confidence >= HIGH_RELATIONSHIP_CONFIDENCE ? 700 : 500,
                                      color: suggestion.confidence >= HIGH_RELATIONSHIP_CONFIDENCE ? 'success.main' : 'text.secondary',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {formatRelationshipConfidence(suggestion, i18n.language)}
                                  </Typography>
                                </TableCell>
                                <TableCell>
                                  <Typography variant="body2">
                                    {suggestion.preset.note || describeRelationshipSuggestion(suggestion, i18n.language)}
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    {describeRelationshipSuggestion(suggestion, i18n.language)}
                                  </Typography>
                                </TableCell>
                                {settings.developerMode ? (
                                  <TableCell sx={{ minWidth: 260 }}>
                                    <Typography variant="caption" color="text.secondary">
                                      {formatRelationshipDebug(suggestion, i18n.language)}
                                    </Typography>
                                  </TableCell>
                                ) : null}
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  ) : (
                    <Alert severity="info">
                      {i18n.language.startsWith('zh') ? '没有识别到需要补全的默认关系。' : 'No default relationships need completion.'}
                    </Alert>
                  )}
                </>
              )}
            </Box>
          ) : null}

          {activeTab !== 'completion' && showGenerateCharactersFab ? (
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
          ) : null}
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

      <Dialog open={Boolean(previewCandidate)} onClose={() => setPreviewCandidate(null)} fullWidth maxWidth="sm">
        <DialogTitle>{i18n.language.startsWith('zh') ? '角色设定预览' : 'Role setup preview'}</DialogTitle>
        <DialogContent>
          {previewCandidate ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 0.5 }}>
              <Box
                sx={{
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 2,
                  bgcolor: 'background.default',
                  px: 2,
                  py: 1.5,
                }}
              >
                <Typography variant="h6" sx={{ fontSize: '1.05rem', fontWeight: 700, wordBreak: 'break-word' }}>
                  {formatCandidateName(previewCandidate, nameFormat)}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {previewCandidate.summary}
                </Typography>
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    {i18n.language.startsWith('zh') ? '本名' : 'Name'}
                  </Typography>
                  <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                    {previewCandidate.name}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    {i18n.language.startsWith('zh') ? '主要身份' : 'Primary role'}
                  </Typography>
                  <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                    {previewCandidate.role || (i18n.language.startsWith('zh') ? '未填写' : 'Not provided')}
                  </Typography>
                </Box>
              </Box>
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreviewCandidate(null)}>{i18n.language.startsWith('zh') ? '关闭' : 'Close'}</Button>
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
      <VipLimitDialog
        open={Boolean(vipLimitDialog)}
        title={vipLimitDialog?.title || ''}
        description={vipLimitDialog?.description || ''}
        current={vipLimitDialog?.current}
        limit={vipLimitDialog?.limit}
        helperText={vipLimitDialog?.helperText}
        onClose={() => setVipLimitDialog(null)}
      />
    </Box>
  );
}
