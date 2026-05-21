import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, TextField, Typography, Chip, Snackbar, Alert, LinearProgress, Dialog, DialogContent, IconButton } from '@mui/material';
import type { AIModelProfile } from '../types/settings';
import type { AICharacter, PersonalityParams } from '../types/character';
import { enqueueAvatarGenerationForCharacters } from '../services/avatarGeneration';

const BATCH_GENERATE_GROUP_SIZE = 10;

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
    behavior: DEFAULT_CHARACTER_BEHAVIOR,
    relationships: [],
    memory: DEFAULT_CHARACTER_MEMORY,
    intervention: DEFAULT_CHARACTER_INTERVENTION,
    modelProfileId: params.profile.id,
    modelProfileIds: { text: params.profile.id, image: null, audio: null, document: null },
  };
}

async function processCharacterBatch(params: {
  selectedNames: string[];
  characters: Array<Pick<AICharacter, 'name' | 'group' | 'bubbleStyleId'>>;
  generatedGroup: string | null;
  customStyleIds: string[];
  profile: AIModelProfile;
  language: 'zh' | 'en';
  theme?: string | null;
  cancelGenerationRef: React.MutableRefObject<boolean>;
  setProgress: React.Dispatch<React.SetStateAction<ProgressState>>;
  duplicateMessage: string;
  getErrorMessage: (error: unknown) => string;
  addCharacters: (chars: Array<Omit<AICharacter, 'id' | 'createdAt' | 'updatedAt' | 'isPreset'>>) => Promise<AICharacter[]>;
}) {
  const existingNames = new Set(params.characters.map((char) => char.name.trim().toLowerCase()));
  const reservedNames = new Set<string>();

  await runInBatches(params.selectedNames, BATCH_GENERATE_GROUP_SIZE, async (batch) => {
    if (params.cancelGenerationRef.current) return;

    markCurrentName(params.setProgress, buildBatchProgressLabel(batch));
    const creatableNames = batch.filter((name) => {
      const normalizedName = name.trim().toLowerCase();
      const duplicated = existingNames.has(normalizedName) || reservedNames.has(normalizedName);
      if (duplicated) {
        appendProgressItem(params.setProgress, { name, status: 'skipped', reason: params.duplicateMessage });
        return false;
      }
      reservedNames.add(normalizedName);
      return true;
    });

    if (params.cancelGenerationRef.current || !creatableNames.length) return;

    try {
      const { success, failed } = await generateCharacterProfilesSafe(params.profile, creatableNames, params.language, params.theme);
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
}

import SearchIcon from '@mui/icons-material/Search';
import { useNavigate } from 'react-router-dom';
import { useLayoutHeaderActions } from '../components/layout/AppLayoutContext';
import { useTranslation } from 'react-i18next';
import { generateResponse } from '../services/aiClient';
import { generateCharacterProfilesSafe } from '../services/characterGenerator';

import { useSettingsStore } from '../stores/useSettingsStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import { DEFAULT_CHARACTER_BEHAVIOR, DEFAULT_CHARACTER_INTERVENTION, DEFAULT_CHARACTER_MEMORY } from '../types';
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

const NAMES_SYSTEM_PROMPT = `You help generate candidate character names for a theme.
Return strict JSON only in this shape: {"names":["name1","name2",...],"defaultSelectedNames":["name1","name2"]}
Rules:
- Build a usable cast, not just a protagonist list.
- Include a mix of: core characters, major supporting characters, recurring side characters, rivals, mentors, family members, allies, comic relief, or strongly associated peripheral figures.
- Aim for breadth around the theme: roughly 30-40% core names, 40-50% important supporting names, and 20-30% peripheral-but-recognizable related names.
- Do not stop at only the most famous names if the world clearly has a broader cast.
- For broad themes, return more names. For narrow themes, return fewer names.
- Put the most central or iconic names first, but keep expanding outward to a richer cast.
- defaultSelectedNames should contain only the characters that should be selected by default for an initial chat cast. Usually this means the core cast, not everyone.
- defaultSelectedNames must be a subset of names.
- Prefer well-known, distinctive characters or figures strongly associated with the theme.
- Do not include placeholders, headings, field names, or questions like "names?".
- Every item in names must be an actual character/person/figure name.
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
    const parsed = JSON.parse(extractJsonObject(content)) as { names?: unknown; defaultSelectedNames?: unknown };
    if (Array.isArray(parsed.names)) {
      const names = sanitizeNames(parsed.names.filter((item): item is string => typeof item === 'string'));
      const defaultSelectedNames = Array.isArray(parsed.defaultSelectedNames)
        ? sanitizeNames(parsed.defaultSelectedNames.filter((item): item is string => typeof item === 'string')).filter((name) => names.includes(name))
        : [];
      return { names, defaultSelectedNames };
    }
  } catch {
    // ignore
  }

  try {
    const parsed = JSON.parse(extractJsonArray(content)) as unknown;
    if (Array.isArray(parsed)) {
      return { names: sanitizeNames(parsed.filter((item): item is string => typeof item === 'string')), defaultSelectedNames: [] };
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
  if (parsedJson && parsedJson.names.length > 0) {
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

  const names = sanitizeNames([...quoted, ...lines]);
  if (names.length === 0) {
    throw new Error('AI 返回的名字列表格式无法解析');
  }
  return { names, defaultSelectedNames: [] };
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

export default function BatchGenerateCharactersPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { setHeaderTitle, setHeaderActions, setHeaderBackAction } = useLayoutHeaderActions();
  const settings = useSettingsStore();
  const { characters, loadCharacters, addCharacters } = useCharacterStore();
  const [topic, setTopic] = useState('');
  const [candidateNames, setCandidateNames] = useState<string[]>([]);
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  const [loadingNames, setLoadingNames] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; currentName?: string; items: ProgressItem[] }>({ current: 0, total: 0, currentName: '', items: [] });
  const cancelGenerationRef = useRef(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  useEffect(() => {
    setHeaderTitle(i18n.language.startsWith('zh') ? '批量生成角色' : 'Batch Generate');
    setHeaderBackAction(() => () => navigate(-1));
    setHeaderActions(null);
    return () => {
      setHeaderTitle(null);
      setHeaderBackAction(null);
      setHeaderActions(null);
    };
  }, [i18n.language, navigate, setHeaderActions, setHeaderBackAction, setHeaderTitle, t]);

  const selectedSet = useMemo(() => new Set(selectedNames), [selectedNames]);
  const canGenerateNames = topic.trim().length > 0 && !loadingNames;
  const canGenerateCharacters = selectedNames.length > 0 && !generating;

  const toggleName = (name: string) => {
    setSelectedNames((prev) =>
      prev.includes(name)
        ? prev.filter((item) => item !== name)
        : [...prev, name]
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
      const response = await generateResponse(
        profile,
        `${NAMES_SYSTEM_PROMPT}\nOutput exactly one valid JSON object. Do not include trailing commas. Do not truncate. Do not add explanations before or after the JSON.`,
        [{ role: 'user', content: i18n.language.startsWith('zh') ? `主题：${topic}\n请列出一个适合放进同一群聊的角色阵容，不要只给主角。需要同时包含主角、重要配角、反派/对手、老师/家人/同伴，以及少量但强相关的边缘角色。并请额外判断哪些角色应该默认选中作为初始群聊阵容。只返回合法JSON，格式必须是 {"names":["名字1","名字2"],"defaultSelectedNames":["名字1"]}` : `Theme: ${topic}\nReturn a cast suitable for the same group chat, not just protagonists. Include main characters, important supporting characters, rivals/antagonists, mentors/family/allies, and a few strongly related peripheral figures. Also decide which characters should be selected by default as the initial cast. Return only valid JSON in the format {"names":["name1","name2"],"defaultSelectedNames":["name1"]}.` }]
      );
      const parsed = parseNames(response);
      setCandidateNames(parsed.names);
      setSelectedNames(parsed.defaultSelectedNames.length ? parsed.defaultSelectedNames : parsed.names.slice(0, Math.min(4, parsed.names.length)));
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
    setProgress({ current: 0, total: selectedNames.length, currentName: '', items: [] });

    try {
      const generatedGroup = getTopicDerivedCharacterGroup(topic);
      await processCharacterBatch({
        selectedNames,
        characters,
        generatedGroup,
        customStyleIds: (settings.customBubbleStyles || []).map((style) => style.id),
        profile,
        language: i18n.language.startsWith('zh') ? 'zh' : 'en',
        theme: topic,
        cancelGenerationRef,
        setProgress,
        duplicateMessage: i18n.language.startsWith('zh') ? '同名已存在' : 'Duplicate name exists',
        getErrorMessage,
        addCharacters,
      });

      await loadCharacters();
      setSnackbar({
        open: true,
        message: cancelGenerationRef.current
          ? (i18n.language.startsWith('zh') ? '已取消批量生成' : 'Batch generation cancelled')
          : (i18n.language.startsWith('zh') ? '批量生成完成' : 'Batch generation completed'),
        severity: cancelGenerationRef.current ? 'error' : 'success',
      });
    } catch (error) {
      setSnackbar({ open: true, message: error instanceof Error ? error.message : t('common.error'), severity: 'error' });
    } finally {
      setGenerating(false);
      setProgress({ current: 0, total: 0, currentName: '', items: [] });
    }
  };

  return (
    <Box sx={{ p: 3, pt: { xs: 1, sm: 1, md: 3 }, maxWidth: 960, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
        <TextField
          label={i18n.language.startsWith('zh') ? '主题' : 'Theme'}
          placeholder={i18n.language.startsWith('zh') ? '例如：喜羊羊与灰太狼' : 'e.g. Pleasant Goat and Big Big Wolf'}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canGenerateNames) {
              e.preventDefault();
              void handleFetchNames();
            }
          }}
          fullWidth
        />
        <IconButton
          color="primary"
          onClick={handleFetchNames}
          disabled={!canGenerateNames}
          sx={{
            width: 56,
            height: 56,
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
            flexShrink: 0,
          }}
        >
          <SearchIcon />
        </IconButton>
      </Box>

      {candidateNames.length > 0 ? (
        <>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button size="small" variant="outlined" onClick={() => setSelectedNames(candidateNames)}>
              {i18n.language.startsWith('zh') ? '全选' : 'Select all'}
            </Button>
            <Button size="small" variant="outlined" onClick={() => setSelectedNames(candidateNames.filter((name) => !selectedSet.has(name)))}>
              {i18n.language.startsWith('zh') ? '反选' : 'Invert'}
            </Button>
            <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
              {selectedNames.length} · {candidateNames.length}
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
            {candidateNames.map((name) => {
              const selected = selectedSet.has(name);
              return (
                <Chip
                  key={name}
                  label={name}
                  clickable
                  color={selected ? 'primary' : 'default'}
                  variant={selected ? 'filled' : 'outlined'}
                  onClick={() => toggleName(name)}
                  sx={{ justifyContent: 'flex-start' }}
                />
              );
            })}
          </Box>

          <Button
            variant="contained"
            onClick={handleGenerateCharacters}
            disabled={!canGenerateCharacters}
            sx={{
              position: 'fixed',
              right: { xs: 24, sm: 32, md: 36 },
              bottom: { xs: 24, sm: 32, md: 36 },
              zIndex: 1200,
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

      <Snackbar open={snackbar.open} autoHideDuration={3000} onClose={() => setSnackbar({ ...snackbar, open: false })}>
        <Alert severity={snackbar.severity} onClose={() => setSnackbar({ ...snackbar, open: false })}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
}
