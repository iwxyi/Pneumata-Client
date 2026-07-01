import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api as backendApi, type TopicAdaptationResult, type TopicItem, type TopicSourceSummary } from '../../services/api';
import { generateCharacterProfile } from '../../services/characterGenerator';
import { DEFAULT_CHARACTER_INTERVENTION, DEFAULT_CHARACTER_MEMORY } from '../../types';
import type { AICharacter } from '../../types/character';
import type { ChatStyle } from '../../types/chat';
import type { APIConfig, AIModelProfile } from '../../types/settings';
import { getPreferredAIProfile, isAIProfileUsable } from '../../types/settings';
import { enqueueAvatarGenerationForCharacters } from '../../services/avatarGeneration';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { chooseRandomBubbleStyleId, createCharacterBubbleStyleId } from '../../utils/bubbleStyle';

const BATCH_GENERATE_GROUP_SIZE = 10;
const HOT_TOPIC_RECOMMENDED_CHARACTER_GROUP = '自动推荐';

function getErrorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : '';
}

function getErrorStatus(error: unknown) {
  return error && typeof error === 'object' && 'status' in error && typeof (error as { status?: unknown }).status === 'number'
    ? (error as { status: number }).status
    : null;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  return '';
}

function buildCreateCharacterErrorMessage(error: unknown, isZh: boolean) {
  const code = getErrorCode(error);
  const status = getErrorStatus(error);
  const message = getErrorMessage(error);
  if (message === 'DUPLICATE_CHARACTER_NAME' || code === 'DUPLICATE_CHARACTER_NAME') {
    return isZh ? '存在同名角色，已阻止创建' : 'Duplicate character names blocked creation';
  }
  if (code === 'DUPLICATE_CHARACTER_NAME_BATCH') {
    return isZh ? '推荐角色列表中存在重复名字，已阻止创建' : 'Suggested characters contain duplicate names';
  }
  const detailParts = [
    message,
    code ? `code=${code}` : '',
    status ? `HTTP ${status}` : '',
  ].filter(Boolean);
  const fallback = isZh ? '未知错误' : 'Unknown error';
  return `${isZh ? '批量创建推荐角色失败' : 'Failed to create suggested characters'}：${detailParts.join(' · ') || fallback}`;
}

function getSourceTabs(sources: TopicSourceSummary[]) {
  return [...sources]
      .filter((source) => source.id !== 'ai_ideas')
      .sort((a, b) => {
        const order = ['zhihu', 'baidu', 'weibo', 'toutiao', 'bilibili', 'douyin', 'tieba', 'hupu', '36kr', 'ifanr', 'jinritemai', 'sspai', 'github', 'hackernews'];
        const aIndex = order.indexOf(a.id);
        const bIndex = order.indexOf(b.id);
        if (aIndex === -1 && bIndex === -1) return 0;
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
      });
}

async function runInBatches<T>(items: T[], batchSize: number, worker: (batch: T[], batchStartIndex: number) => Promise<void>) {
  for (let start = 0; start < items.length; start += batchSize) {
    await worker(items.slice(start, start + batchSize), start);
  }
}

export function useHotTopicDialog(params: {
  language: string;
  apiConfig: APIConfig;
  aiProfiles: AIModelProfile[];
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
  const [selectedTopic, setSelectedTopic] = useState<TopicItem | null>(null);
  const [adaptation, setAdaptation] = useState<TopicAdaptationResult | null>(null);
  const [selectedSuggestedMemberIds, setSelectedSuggestedMemberIds] = useState<string[]>([]);
  const [selectedCharacterNames, setSelectedCharacterNames] = useState<string[]>([]);
  const [createdCharacterNames, setCreatedCharacterNames] = useState<string[]>([]);
  const [overwriteName, setOverwriteName] = useState(false);
  const [overwriteTopic, setOverwriteTopic] = useState(false);
  const creationInFlightRef = useRef(false);
  const initializedRef = useRef(false);
  const initializingRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (!open && sources.length === 0) return;
    const visibleSourceCount = getSourceTabs(sources).length;
    if (sourceTab <= visibleSourceCount - 1) return;
    setSourceTab(Math.max(0, visibleSourceCount - 1));
  }, [sourceTab, sources, open]);

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
    setSelectedSuggestedMemberIds([]);
    setSelectedCharacterNames([]);
  }, [topics, selectedTopic]);

  useEffect(() => {
    const recommended = adaptation?.recommendedCharacters || [];
    if (!recommended.length) {
      setSelectedCharacterNames((prev) => (prev.length ? [] : prev));
      setCreatedCharacterNames((prev) => (prev.length ? [] : prev));
      return;
    }
    const recommendedNames = new Set(recommended.map((item) => item.name));
    setSelectedCharacterNames((prev) => {
      const kept = prev.filter((item) => recommendedNames.has(item));
      return kept.length === prev.length && kept.every((item, index) => item === prev[index]) ? prev : kept;
    });
    setCreatedCharacterNames((prev) => {
      const next = prev.filter((createdName) => recommended.some((item) => item.name === createdName));
      return next.length === prev.length && next.every((item, index) => item === prev[index]) ? prev : next;
    });
  }, [params.characters, adaptation]);

  useEffect(() => {
    setSelectedCharacterNames((prev) => {
      const recommendedNames = new Set((adaptation?.recommendedCharacters || []).map((item) => item.name));
      const next = prev.filter((itemName) => recommendedNames.has(itemName));
      return next.length === prev.length ? prev : next;
    });
  }, [adaptation]);

  useEffect(() => {
    if (!createdCharacterNames.length) return;
    setSelectedCharacterNames((prev) => {
      const next = Array.from(new Set([...prev, ...createdCharacterNames]));
      return next.length === prev.length && next.every((item, index) => item === prev[index]) ? prev : next;
    });
  }, [createdCharacterNames]);

  useEffect(() => {
    if (!params.characters.length) return;
    setCreatedCharacterNames((prev) => {
      const next = prev.filter((createdName) => params.characters.some((character) => character.name.trim().toLowerCase() === createdName.trim().toLowerCase()));
      return next.length === prev.length && next.every((item, index) => item === prev[index]) ? prev : next;
    });
  }, [params.characters]);

  const loadTopics = useCallback(async (sourceId: string) => {
    setLoading(true);
    try {
      const result = await backendApi.getTopics(sourceId);
      setTopics(result.items || []);
    } catch {
      params.onError(isZh ? '热点加载失败' : 'Failed to load topics');
      setTopics([]);
    } finally {
      setLoading(false);
    }
  }, [isZh, params]);

  const initializeDialog = useCallback(async () => {
    if (initializedRef.current) return;
    if (initializingRef.current) {
      await initializingRef.current;
      return;
    }

    const initializeTask = (async () => {
      try {
        const result = await backendApi.getTopicSources();
        const nextSources = result.sources || [];
        setSources(nextSources);
        const firstSourceId = getSourceTabs(nextSources)[0]?.id;
        setSourceTab(0);
        if (firstSourceId) {
          await loadTopics(firstSourceId);
        } else {
          setTopics([]);
        }
        initializedRef.current = true;
      } catch {
        setSources([]);
        setSourceTab(0);
        setTopics([]);
        initializedRef.current = true;
        params.onError(isZh ? '热点来源加载失败' : 'Failed to load topic sources');
      } finally {
        initializingRef.current = null;
      }
    })();

    initializingRef.current = initializeTask;
    await initializeTask;
  }, [isZh, loadTopics, params]);

  const openDialog = useCallback(async () => {
    setOpen(true);
    await initializeDialog();
  }, [initializeDialog]);

  const closeDialog = useCallback(() => {
    setOpen(false);
  }, []);

  const handleSourceTabChange = useCallback(async (_: unknown, value: number) => {
    setSourceTab(value);
    const sourceId = getSourceTabs(sources)[value]?.id;
    if (sourceId) {
      await loadTopics(sourceId);
    } else {
      setTopics([]);
    }
  }, [sources, loadTopics]);

  const handleTopicSelect = useCallback(async (topicItem: TopicItem) => {
    const activeConfig = getPreferredAIProfile(params.aiProfiles, 'text') || params.apiConfig;
    if (!isAIProfileUsable(activeConfig)) {
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
      setCreatedCharacterNames([]);
      setSelectedSuggestedMemberIds([]);
      setSelectedCharacterNames([]);
      setAdaptation(nextAdaptation);
    } catch (error) {
      params.onError(error instanceof Error
        ? error.message
        : (isZh ? '热点改编失败' : 'Failed to adapt topic'));
      setAdaptation(null);
      setSelectedSuggestedMemberIds([]);
      setSelectedCharacterNames([]);
    } finally {
      setAdapting(false);
    }
  }, [isZh, params]);

  const handleApply = useCallback(() => {
    if (adapting) return;
    if (!adaptation) return;
    if ((!params.name.trim() || overwriteName) && adaptation.suggestedName) params.setName(adaptation.suggestedName);
    if ((!params.topic.trim() || overwriteTopic) && adaptation.suggestedTopic) params.setTopic(adaptation.suggestedTopic);
    if (adaptation.suggestedStyle) params.setStyle(adaptation.suggestedStyle);
    if (selectedSuggestedMemberIds.length) {
      params.setSelectedMembers((prev) => Array.from(new Set([...prev, ...selectedSuggestedMemberIds])).slice(0, params.maxMembers));
    }
    closeDialog();
    params.setSnackbar({ open: true, message: isZh ? '已应用热点灵感' : 'Topic inspiration applied', severity: 'success' });
  }, [adapting, adaptation, params, overwriteName, overwriteTopic, selectedSuggestedMemberIds, closeDialog, isZh]);

  const handleToggleSuggestedMember = useCallback((characterId: string) => {
    setSelectedSuggestedMemberIds((prev) => prev.includes(characterId) ? prev.filter((item) => item !== characterId) : [...prev, characterId]);
  }, []);

  const handleToggleAllSuggestedMembers = useCallback(() => {
    const ids = adaptation?.suggestedMemberIds?.filter((memberId) => params.characters.some((character) => character.id === memberId)) || [];
    setSelectedSuggestedMemberIds((prev) => {
      const selected = new Set(prev);
      const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
      return allSelected ? prev.filter((id) => !ids.includes(id)) : Array.from(new Set([...prev, ...ids]));
    });
  }, [adaptation, params.characters]);

  const handleToggleCharacter = useCallback((characterName: string) => {
    setSelectedCharacterNames((prev) => prev.includes(characterName) ? prev.filter((item) => item !== characterName) : [...prev, characterName]);
  }, []);

  const getCharacterCardState = useCallback((candidateName: string) => {
    const normalizedName = candidateName.trim().toLowerCase();
    const alreadyExists = params.characters.some((character) => character.name.trim().toLowerCase() === normalizedName);
    const created = createdCharacterNames.some((name) => name.trim().toLowerCase() === normalizedName);
    return { alreadyExists, created };
  }, [params.characters, createdCharacterNames]);

  const getSelectableRecommendedCharacterNames = useCallback(() => {
    return (adaptation?.recommendedCharacters || [])
      .filter((candidate) => {
        const { alreadyExists, created } = getCharacterCardState(candidate.name);
        return !alreadyExists && !created;
      })
      .map((candidate) => candidate.name);
  }, [adaptation, getCharacterCardState]);

  const handleToggleAllRecommendedCharacters = useCallback(() => {
    const names = getSelectableRecommendedCharacterNames();
    setSelectedCharacterNames((prev) => {
      const selected = new Set(prev);
      const allSelected = names.length > 0 && names.every((name) => selected.has(name));
      return allSelected ? prev.filter((name) => !names.includes(name)) : Array.from(new Set([...prev, ...names]));
    });
  }, [getSelectableRecommendedCharacterNames]);

  const buildCharacterCreatePayload = useCallback(async (name: string, backgroundHint: string | undefined, config: APIConfig | AIModelProfile) => {
    const generated = await generateCharacterProfile(config, name, isZh ? 'zh' : 'en');
    return {
      name,
      avatar: generated.avatar,
      personality: generated.personality,
      behavior: generated.behavior,
      expertise: generated.expertise,
      speakingStyle: generated.speakingStyle,
      background: backgroundHint || generated.background,
      group: HOT_TOPIC_RECOMMENDED_CHARACTER_GROUP,
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
        generatedGroup: HOT_TOPIC_RECOMMENDED_CHARACTER_GROUP,
        customStyleIds: [],
      }),
    };
  }, [isZh, params.characters]);

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
    if (adapting) return;
    if (creatingCharacters || creationInFlightRef.current) return;
    const activeConfig = getPreferredAIProfile(params.aiProfiles, 'text') || params.apiConfig;
    if (!isAIProfileUsable(activeConfig)) {
      params.onError(isZh ? '请先配置AI模型后再创建推荐角色' : 'Configure AI model before creating suggested characters');
      return;
    }
    if (!adaptation?.recommendedCharacters?.length) return;
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
        const payloads = await Promise.all(batch.map(async (candidate) => {
          try {
            return await buildCharacterCreatePayload(candidate.name, candidate.description, activeConfig);
          } catch (error) {
            const reason = getErrorMessage(error) || (isZh ? 'AI 生成角色档案失败' : 'AI profile generation failed');
            throw new Error(`${isZh ? '生成角色失败' : 'Failed to generate character'}「${candidate.name}」：${reason}`);
          }
        }));
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
    } catch (error) {
      console.error('[hot-topic:create-characters:error]', { queue: queue.map((candidate) => candidate.name), error });
      params.onError(buildCreateCharacterErrorMessage(error, isZh));
    } finally {
      creationInFlightRef.current = false;
      setCreatingCharacters(false);
    }
  }, [adapting, creatingCharacters, params, adaptation, createQueue, buildCharacterCreatePayload, isZh]);

  const sourceTabs = useMemo(() => getSourceTabs(sources), [sources]);
  const suggestedMembers = useMemo(() => adaptation?.suggestedMemberIds?.length ? params.characters.filter((character) => adaptation.suggestedMemberIds?.includes(character.id)) : [], [adaptation, params.characters]);
  const selectableRecommendedCharacterNames = useMemo(() => getSelectableRecommendedCharacterNames(), [getSelectableRecommendedCharacterNames]);
  const allSuggestedMembersSelected = suggestedMembers.length > 0 && suggestedMembers.every((character) => selectedSuggestedMemberIds.includes(character.id));
  const allRecommendedCharactersSelected = selectableRecommendedCharacterNames.length > 0 && selectableRecommendedCharacterNames.every((name) => selectedCharacterNames.includes(name));
  const createCount = useMemo(() => (adaptation?.recommendedCharacters || []).filter((candidate) => {
    const { alreadyExists, created } = getCharacterCardState(candidate.name);
    return selectedCharacterNames.includes(candidate.name) && !alreadyExists && !created;
  }).length, [adaptation, getCharacterCardState, selectedCharacterNames]);
  const canApply = Boolean(adaptation);
  const canCreateCharacters = createCount > 0;
  const applyLabel = overwriteName || overwriteTopic ? (isZh ? '覆盖并应用' : 'Overwrite and apply') : (isZh ? '应用到草稿' : 'Apply to draft');
  const createLabel = creatingCharacters ? (isZh ? '创建角色中…' : 'Creating characters…') : canCreateCharacters ? (isZh ? `创建 ${createCount} 个推荐角色` : `Create ${createCount} suggested characters`) : (isZh ? '批量创建推荐角色' : 'Create suggested characters');
  const currentSource = sourceTabs[sourceTab] || null;
  const selectionConflictText = [
    overwriteName ? (isZh ? '群聊名称将被覆盖' : 'Chat name will be overwritten') : '',
    overwriteTopic ? (isZh ? '话题文案将被覆盖' : 'Topic text will be overwritten') : '',
  ].filter(Boolean).join(' · ');
  const loadingText = loading ? (isZh ? '加载热点中…' : 'Loading topics…') : adapting ? (isZh ? 'AI 改编中…' : 'Adapting with AI…') : '';
  const emptyText = currentSource ? (isZh ? '当前来源暂无热点。' : 'No topics available for this source.') : (isZh ? '暂无可用热点来源。' : 'No topic sources are available.');

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
      selectedSuggestedMemberIds,
      selectedCharacterNames,
      allSuggestedMembersSelected,
      allRecommendedCharactersSelected,
      adapting,
      creatingCharacters,
      canCreateCharacters,
      canApply,
      createLabel,
      applyLabel,
      getHotCharacterCardState: getCharacterCardState,
      onClose: closeDialog,
      onSourceTabChange: handleSourceTabChange,
      onTopicSelect: handleTopicSelect,
      onToggleSuggestedMember: handleToggleSuggestedMember,
      onToggleAllSuggestedMembers: handleToggleAllSuggestedMembers,
      onToggleCharacter: handleToggleCharacter,
      onToggleAllRecommendedCharacters: handleToggleAllRecommendedCharacters,
      onCreateCharacters: handleCreateCharacters,
      onApply: handleApply,
    },
    openHotDialog: openDialog,
  };
}
