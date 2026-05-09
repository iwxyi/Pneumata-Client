import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api as backendApi, type TopicAdaptationResult, type TopicItem, type TopicSourceSummary } from '../../services/api';
import { generateCharacterProfile } from '../../services/characterGenerator';
import { DEFAULT_CHARACTER_BEHAVIOR, DEFAULT_CHARACTER_INTERVENTION, DEFAULT_CHARACTER_MEMORY } from '../../types';
import type { AICharacter } from '../../types/character';
import type { ChatStyle } from '../../types/chat';
import { getPreferredAIProfile } from '../../types/settings';
import { enqueueAvatarGenerationForCharacters } from '../../services/avatarGeneration';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { chooseRandomBubbleStyleId, createCharacterBubbleStyleId } from '../../utils/bubbleStyle';

const BATCH_GENERATE_GROUP_SIZE = 10;

function getSourceTabs(sources: TopicSourceSummary[], isZh: boolean) {
  return (sources.length
    ? [...sources].sort((a, b) => {
        const order = ['ai_ideas', 'weibo', 'zhihu', 'baidu', 'toutiao', 'tieba', 'hupu', '36kr', 'cls', 'ifanr', 'jinritemai', 'sspai', 'github', 'hackernews'];
        const aIndex = order.indexOf(a.id);
        const bIndex = order.indexOf(b.id);
        if (aIndex === -1 && bIndex === -1) return 0;
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
      })
    : [{ id: 'ai_ideas', label: isZh ? 'AI灵感' : 'AI ideas', status: 'ok' as const }]);
}

async function runInBatches<T>(items: T[], batchSize: number, worker: (batch: T[], batchStartIndex: number) => Promise<void>) {
  for (let start = 0; start < items.length; start += batchSize) {
    await worker(items.slice(start, start + batchSize), start);
  }
}

export function useHotTopicDialog(params: {
  language: string;
  apiConfig: any;
  aiProfiles: any[];
  autoGenerateCharacterAvatar?: boolean;
  characters: AICharacter[];
  name: string;
  topic: string;
  setName: (value: string) => void;
  setTopic: (value: string) => void;
  setStyle: (value: ChatStyle) => void;
  setSelectedMembers: React.Dispatch<React.SetStateAction<string[]>>;
  addCharacters: (chars: Array<Omit<AICharacter, 'id' | 'createdAt' | 'updatedAt' | 'isPreset'>>) => Promise<AICharacter[]>;
  maxMembers: number;
  onError: (message: string) => void;
  setSnackbar: React.Dispatch<React.SetStateAction<{ open: boolean; message: string; severity: 'success' | 'error' }>>;
}) {
  const isZh = params.language.startsWith('zh');
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<TopicSourceSummary[]>([]);
  const [sourceTab, setSourceTab] = useState(0);
  const [topics, setTopics] = useState<TopicItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [adapting, setAdapting] = useState(false);
  const [creatingCharacters, setCreatingCharacters] = useState(false);
  const [sourceNote, setSourceNote] = useState('');
  const [selectedTopic, setSelectedTopic] = useState<TopicItem | null>(null);
  const [adaptation, setAdaptation] = useState<TopicAdaptationResult | null>(null);
  const [selectedCharacterNames, setSelectedCharacterNames] = useState<string[]>([]);
  const [createdCharacterNames, setCreatedCharacterNames] = useState<string[]>([]);
  const [overwriteName, setOverwriteName] = useState(false);
  const [overwriteTopic, setOverwriteTopic] = useState(false);
  const hasManualCharacterSelectionRef = useRef(false);
  const creationInFlightRef = useRef(false);

  useEffect(() => {
    if (!open && sources.length === 0) return;
    if (sourceTab <= sources.length - 1) return;
    setSourceTab(Math.max(0, sources.length - 1));
  }, [sourceTab, sources.length, open]);

  useEffect(() => {
    if (!adaptation) return;
    setOverwriteName(Boolean(params.name.trim() && adaptation.suggestedName && params.name.trim() !== adaptation.suggestedName.trim()));
    setOverwriteTopic(Boolean(params.topic.trim() && adaptation.suggestedTopic && params.topic.trim() !== adaptation.suggestedTopic.trim()));
  }, [adaptation, params.name, params.topic]);

  useEffect(() => {
    if (!selectedTopic) return;
    if (topics.some((item) => item.id === selectedTopic.id)) return;
    setSelectedTopic(null);
    setAdaptation(null);
    setSelectedCharacterNames([]);
  }, [topics, selectedTopic]);

  useEffect(() => {
    const recommended = adaptation?.recommendedCharacters || [];
    if (!recommended.length) {
      setSelectedCharacterNames([]);
      setCreatedCharacterNames([]);
      return;
    }
    const recommendedNames = new Set(recommended.map((item) => item.name));
    const existingNames = new Set(params.characters.map((character) => character.name.trim().toLowerCase()));
    const createdNames = new Set(createdCharacterNames.map((name) => name.trim().toLowerCase()));
    const selectableNames = recommended
      .map((item) => item.name)
      .filter((itemName) => !existingNames.has(itemName.trim().toLowerCase()) && !createdNames.has(itemName.trim().toLowerCase()));
    setSelectedCharacterNames((prev) => {
      const kept = prev.filter((item) => recommendedNames.has(item));
      if (kept.length) return kept;
      return hasManualCharacterSelectionRef.current ? kept : selectableNames;
    });
    setCreatedCharacterNames((prev) => prev.filter((createdName) => recommended.some((item) => item.name === createdName)));
  }, [params.characters, adaptation, createdCharacterNames]);

  useEffect(() => {
    setSelectedCharacterNames((prev) => {
      const recommendedNames = new Set((adaptation?.recommendedCharacters || []).map((item) => item.name));
      const next = prev.filter((itemName) => recommendedNames.has(itemName));
      return next.length === prev.length ? prev : next;
    });
  }, [adaptation]);

  useEffect(() => {
    if (!createdCharacterNames.length) return;
    setSelectedCharacterNames((prev) => Array.from(new Set([...prev, ...createdCharacterNames])));
  }, [createdCharacterNames]);

  useEffect(() => {
    if (!params.characters.length) return;
    setCreatedCharacterNames((prev) => prev.filter((createdName) => params.characters.some((character) => character.name.trim().toLowerCase() === createdName.trim().toLowerCase())));
  }, [params.characters]);

  const loadTopics = useCallback(async (sourceId: string) => {
    setLoading(true);
    try {
      const result = await backendApi.getTopics(sourceId);
      setTopics(result.items || []);
      setSourceNote(result.note || '');
    } catch (error) {
      params.onError(isZh ? '热点加载失败' : 'Failed to load topics');
      setTopics([]);
      setSourceNote('');
    } finally {
      setLoading(false);
    }
  }, [isZh, params]);

  const openDialog = useCallback(async () => {
    setOpen(true);
    setAdaptation(null);
    setSelectedTopic(null);
    setSelectedCharacterNames([]);
    setCreatedCharacterNames([]);
    setOverwriteName(false);
    setOverwriteTopic(false);
    hasManualCharacterSelectionRef.current = false;
    try {
      const result = await backendApi.getTopicSources();
      const nextSources = result.sources || [];
      setSources(nextSources);
      const firstSourceId = nextSources[0]?.id || 'ai_ideas';
      setSourceTab(0);
      await loadTopics(firstSourceId);
    } catch {
      setSources([]);
      setSourceTab(0);
      await loadTopics('ai_ideas');
      params.onError(isZh ? '热点来源加载失败' : 'Failed to load topic sources');
    }
  }, [isZh, loadTopics, params]);

  const closeDialog = useCallback(() => {
    hasManualCharacterSelectionRef.current = false;
    setOpen(false);
    setAdaptation(null);
    setSelectedTopic(null);
    setSelectedCharacterNames([]);
    setCreatedCharacterNames([]);
    setOverwriteName(false);
    setOverwriteTopic(false);
  }, []);

  const handleSourceTabChange = useCallback(async (_: unknown, value: number) => {
    setSourceTab(value);
    const sourceId = getSourceTabs(sources, isZh)[value]?.id || 'ai_ideas';
    await loadTopics(sourceId);
  }, [sources, isZh, loadTopics]);

  const handleTopicSelect = useCallback(async (topicItem: TopicItem) => {
    const activeConfig = getPreferredAIProfile(params.aiProfiles, 'text') || params.apiConfig;
    if (!activeConfig?.apiKey || !activeConfig?.model) {
      params.onError(isZh ? '请先配置AI模型后再使用热点改编' : 'Configure AI model before using topic adaptation');
      return;
    }
    setSelectedTopic(topicItem);
    setAdapting(true);
    try {
      const nextAdaptation = await backendApi.adaptTopic({
        topic: { title: topicItem.title, subtitle: topicItem.subtitle, source: topicItem.source },
        characters: params.characters.map((character) => ({
          id: character.id,
          name: character.name,
          background: character.background,
          expertise: character.expertise,
          speakingStyle: character.speakingStyle,
          isPreset: character.isPreset,
        })),
        language: isZh ? 'zh' : 'en',
      });
      hasManualCharacterSelectionRef.current = false;
      setCreatedCharacterNames([]);
      setAdaptation(nextAdaptation);
    } catch {
      params.onError(isZh ? '热点改编失败' : 'Failed to adapt topic');
      setAdaptation(null);
      setSelectedCharacterNames([]);
    } finally {
      setAdapting(false);
    }
  }, [isZh, params]);

  const handleApply = useCallback(() => {
    if (!adaptation) return;
    if ((!params.name.trim() || overwriteName) && adaptation.suggestedName) params.setName(adaptation.suggestedName);
    if ((!params.topic.trim() || overwriteTopic) && adaptation.suggestedTopic) params.setTopic(adaptation.suggestedTopic);
    if (adaptation.suggestedStyle) params.setStyle(adaptation.suggestedStyle);
    if (adaptation.suggestedMemberIds?.length) {
      params.setSelectedMembers((prev) => Array.from(new Set([...prev, ...adaptation.suggestedMemberIds!])).slice(0, params.maxMembers));
    }
    closeDialog();
    params.setSnackbar({ open: true, message: isZh ? '已应用热点灵感' : 'Topic inspiration applied', severity: 'success' });
  }, [adaptation, params, overwriteName, overwriteTopic, closeDialog, isZh]);

  const handleToggleCharacter = useCallback((characterName: string) => {
    hasManualCharacterSelectionRef.current = true;
    setSelectedCharacterNames((prev) => prev.includes(characterName) ? prev.filter((item) => item !== characterName) : [...prev, characterName]);
  }, []);

  const getCharacterCardState = useCallback((candidateName: string) => {
    const normalizedName = candidateName.trim().toLowerCase();
    const alreadyExists = params.characters.some((character) => character.name.trim().toLowerCase() === normalizedName);
    const created = createdCharacterNames.some((name) => name.trim().toLowerCase() === normalizedName);
    return { alreadyExists, created };
  }, [params.characters, createdCharacterNames]);

  const buildCharacterCreatePayload = useCallback(async (name: string, backgroundHint: string | undefined, config: any) => {
    const generated = await generateCharacterProfile(config, name, isZh ? 'zh' : 'en');
    return {
      name,
      avatar: generated.avatar,
      personality: generated.personality,
      behavior: DEFAULT_CHARACTER_BEHAVIOR,
      expertise: generated.expertise,
      speakingStyle: generated.speakingStyle,
      background: backgroundHint || generated.background,
      speechProfile: generated.speechProfile,
      bubbleStyle: { ...generated.bubbleStyle, id: createCharacterBubbleStyleId() },
      relationships: [],
      memory: DEFAULT_CHARACTER_MEMORY,
      layeredMemories: [],
      intervention: DEFAULT_CHARACTER_INTERVENTION,
      runtimeTimeline: [],
      modelProfileId: null,
      modelProfileIds: { text: null, image: null, audio: null, document: null },
      bubbleStyleId: chooseRandomBubbleStyleId({
        allCharacters: params.characters,
        generatedGroup: params.topic?.trim() || null,
        customStyleIds: [],
      }),
    };
  }, [isZh]);

  const createQueue = useCallback(() => {
    const recommended = adaptation?.recommendedCharacters || [];
    const existingNames = new Set(params.characters.map((character) => character.name.trim().toLowerCase()));
    const createdNames = new Set(createdCharacterNames.map((name) => name.trim().toLowerCase()));
    const selectedNames = new Set(selectedCharacterNames.map((name) => name.trim().toLowerCase()));
    const queuedNames = new Set<string>();
    return recommended.filter((candidate) => {
      const normalizedName = candidate.name.trim().toLowerCase();
      if (!selectedNames.has(normalizedName)) return false;
      if (existingNames.has(normalizedName) || createdNames.has(normalizedName) || queuedNames.has(normalizedName)) return false;
      queuedNames.add(normalizedName);
      return true;
    });
  }, [adaptation, params.characters, createdCharacterNames, selectedCharacterNames]);

  const handleCreateCharacters = useCallback(async () => {
    if (creatingCharacters || creationInFlightRef.current) return;
    const activeConfig = getPreferredAIProfile(params.aiProfiles, 'text') || params.apiConfig;
    if (!activeConfig?.apiKey || !activeConfig?.model || !adaptation?.recommendedCharacters?.length) return;
    const queue = createQueue();
    if (!queue.length) {
      params.setSnackbar({ open: true, message: isZh ? '没有需要创建的新角色' : 'No new characters needed', severity: 'success' });
      return;
    }

    creationInFlightRef.current = true;
    setCreatingCharacters(true);
    try {
      const createdIds: string[] = [];
      await runInBatches(queue, BATCH_GENERATE_GROUP_SIZE, async (batch) => {
        const payloads = await Promise.all(batch.map((candidate) => buildCharacterCreatePayload(candidate.name, candidate.description, activeConfig)));
        const createdCharacters = await params.addCharacters(payloads);
        if (!createdCharacters.length) return;
        createdIds.push(...createdCharacters.map((character) => character.id));
        if (params.autoGenerateCharacterAvatar) {
          try {
            enqueueAvatarGenerationForCharacters(
              createdCharacters.map((character) => ({
                id: character.id,
                name: character.name,
                background: character.background || '',
                speakingStyle: character.speakingStyle || '',
                group: character.group || '',
                expertise: character.expertise || [],
                personality: character.personality,
                speechProfile: character.speechProfile,
              })),
              params.aiProfiles,
              isZh ? 'zh' : 'en',
              useSettingsStore.getState().avatarGeneration,
            );
          } catch (error) {
            params.setSnackbar({
              open: true,
              message: error instanceof Error ? error.message : (isZh ? '头像生成未启动' : 'Avatar generation did not start'),
              severity: 'error',
            });
          }
        }
        setCreatedCharacterNames((prev) => Array.from(new Set([...prev, ...createdCharacters.map((character) => character.name)])));
        params.setSnackbar({ open: true, message: isZh ? `已创建 ${createdCharacters.length} 个角色` : `${createdCharacters.length} characters created`, severity: 'success' });
      });
      if (createdIds.length) {
        params.setSelectedMembers((prev) => Array.from(new Set([...prev, ...createdIds])).slice(0, params.maxMembers));
      }
    } catch {
      params.onError(isZh ? '批量创建推荐角色失败' : 'Failed to create suggested characters');
    } finally {
      creationInFlightRef.current = false;
      setCreatingCharacters(false);
    }
  }, [creatingCharacters, params, adaptation, createQueue, buildCharacterCreatePayload, isZh]);

  const sourceTabs = useMemo(() => getSourceTabs(sources, isZh), [sources, isZh]);
  const suggestedMembers = useMemo(() => adaptation?.suggestedMemberIds?.length ? params.characters.filter((character) => adaptation.suggestedMemberIds?.includes(character.id)) : [], [adaptation, params.characters]);
  const createCount = useMemo(() => (adaptation?.recommendedCharacters || []).filter((candidate) => {
    const { alreadyExists, created } = getCharacterCardState(candidate.name);
    return selectedCharacterNames.includes(candidate.name) && !alreadyExists && !created;
  }).length, [adaptation, getCharacterCardState, selectedCharacterNames]);
  const canApply = Boolean(adaptation);
  const canCreateCharacters = createCount > 0;
  const applyLabel = overwriteName || overwriteTopic ? (isZh ? '覆盖并应用' : 'Overwrite and apply') : (isZh ? '应用到草稿' : 'Apply to draft');
  const createLabel = creatingCharacters ? (isZh ? '创建角色中…' : 'Creating characters…') : canCreateCharacters ? (isZh ? `创建 ${createCount} 个推荐角色` : `Create ${createCount} suggested characters`) : (isZh ? '批量创建推荐角色' : 'Create suggested characters');
  const currentSource = sourceTabs[sourceTab] || null;
  const currentSourceId = currentSource?.id || 'ai_ideas';
  const selectionConflictText = [
    overwriteName ? (isZh ? '群聊名称将被覆盖' : 'Chat name will be overwritten') : '',
    overwriteTopic ? (isZh ? '话题文案将被覆盖' : 'Topic text will be overwritten') : '',
  ].filter(Boolean).join(' · ');
  const loadingText = loading ? (isZh ? '加载热点中…' : 'Loading topics…') : adapting ? (isZh ? 'AI 改编中…' : 'Adapting with AI…') : '';
  const emptyText = currentSourceId === 'ai_ideas' ? (isZh ? '当前没有可用灵感，请稍后再试。' : 'No AI ideas are available right now.') : (isZh ? '当前来源暂无热点。' : 'No topics available for this source.');

  return {
    hotDialogProps: {
      open,
      cancelLabel: isZh ? '取消' : 'Cancel',
      language: params.language,
      loadingText,
      sourceTab,
      sourceTabs,
      currentSource,
      selectionConflictText,
      loading,
      topics,
      emptyText,
      selectedTopic,
      adaptation,
      suggestedMembers,
      selectedCharacterNames,
      creatingCharacters,
      canCreateCharacters,
      canApply,
      createLabel,
      applyLabel,
      getHotCharacterCardState: getCharacterCardState,
      onClose: closeDialog,
      onSourceTabChange: handleSourceTabChange,
      onTopicSelect: handleTopicSelect,
      onToggleCharacter: handleToggleCharacter,
      onCreateCharacters: handleCreateCharacters,
      onApply: handleApply,
    },
    openHotDialog: openDialog,
  };
}
