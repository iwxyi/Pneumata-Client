import { useEffect, useMemo, useState } from 'react';
import type { AICharacter } from '../types/character';
import { buildDefaultSessionSurfaceProjection, type GroupChat } from '../types/chat';
import type { Message } from '../types/message';
import type { SessionActionDefinition } from '../types/sessionEngine';
import { buildDirectMemoryPanelContext } from '../services/promptBuilder';
import { buildProjectedSessionActions } from '../services/sessionProjection';

type SessionProjectionData = Awaited<ReturnType<typeof import('../services/sessionEngineKernel')['resolveSessionProjectionData']>>;
type ProjectedChatDetailState = ReturnType<typeof import('../services/sessionProjection')['buildProjectedChatDetailState']>;
type ChatWithProjectedRuntime = GroupChat & { primaryRecentEvent?: string };

export function enrichParticipantActionOptions(actions: SessionActionDefinition[], members: AICharacter[]): SessionActionDefinition[] {
  if (!actions.length || !members.length) return actions;
  const memberNames = new Map(members.map((member) => [member.id, member.name] as const));
  return actions.map((action) => ({
    ...action,
    fields: action.fields?.map((field) => {
      const shouldResolveMember = field.targetSource === 'participants' || field.key === 'actorId' || field.key === 'targetId';
      if (!shouldResolveMember || !field.options?.length) return field;
      return {
        ...field,
        options: field.options.map((option) => ({
          ...option,
          label: memberNames.get(option.value) || option.label,
        })),
      };
    }),
  }));
}

function mergeProjectedRuntimeChat(chat: GroupChat, projected?: ChatWithProjectedRuntime | null, primaryRecentEvent?: string): ChatWithProjectedRuntime {
  if (!projected) return { ...chat, primaryRecentEvent };
  return {
    ...chat,
    ...projected,
    worldState: {
      ...chat.worldState,
      ...(projected.worldState || {}),
      conflictAxes: projected.worldState?.conflictAxes || chat.worldState.conflictAxes,
      conflictState: projected.worldState?.conflictState ?? chat.worldState.conflictState,
      structuredRoomState: projected.worldState?.structuredRoomState ?? chat.worldState.structuredRoomState,
    },
    layeredMemories: projected.layeredMemories?.length ? projected.layeredMemories : chat.layeredMemories,
    runtimeSeed: projected.runtimeSeed || chat.runtimeSeed,
    runtimeTimeline: projected.runtimeTimeline?.length ? projected.runtimeTimeline : chat.runtimeTimeline,
    runtimeEventsV2: projected.runtimeEventsV2?.length ? projected.runtimeEventsV2 : chat.runtimeEventsV2,
    relationshipLedger: projected.relationshipLedger?.length ? projected.relationshipLedger : chat.relationshipLedger,
    primaryRecentEvent: projected.primaryRecentEvent || primaryRecentEvent,
  };
}

export function useChatSidebarProjection(params: {
  chat: GroupChat | undefined;
  members: AICharacter[];
  activeMembers: AICharacter[];
  characters: AICharacter[];
  currentChatMessages: Message[];
  rightPanelTab: string;
  speakAsChar: AICharacter | null;
}) {
  const { chat, members, activeMembers, characters, currentChatMessages, rightPanelTab, speakAsChar } = params;
  const [projectionData, setProjectionData] = useState<SessionProjectionData | null>(null);
  const [projectedDetailState, setProjectedDetailState] = useState<ProjectedChatDetailState | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!chat) {
      setProjectionData(null);
      setProjectedDetailState(null);
      return undefined;
    }

    void Promise.all([
      import('../services/sessionEngineRegistry'),
      import('../services/sessionEngineKernel'),
      import('../services/sessionProjection'),
    ]).then(([registry, kernel, projection]) => {
      if (cancelled) return;
      const engine = registry.getSessionEngine(chat.mode);
      const runtimeContext = kernel.createSessionRuntimeContext(engine, chat);
      const nextProjectionData = kernel.resolveSessionProjectionData(engine, runtimeContext);
      setProjectionData(nextProjectionData);
      setProjectedDetailState(nextProjectionData.frameworkState.definition ? projection.buildProjectedChatDetailState({
        chat,
        runtimeState: nextProjectionData.runtimeState,
        privatePayloads: nextProjectionData.privatePayloads,
        visiblePanels: nextProjectionData.view.visiblePanels,
        schemaActions: nextProjectionData.actionSchema?.actions || [],
        schemaTitle: nextProjectionData.actionSchema?.title,
        rightPanelTab,
        frameworkState: nextProjectionData.frameworkState,
        speakAsChar,
        members,
      }) : null);
    });

    return () => {
      cancelled = true;
    };
  }, [chat, members, rightPanelTab, speakAsChar]);

  const projectedRuntimeState = projectionData?.runtimeState || null;
  const frameworkState = projectionData?.frameworkState || null;
  const privatePayloads = projectionData?.privatePayloads || [];
  const actionSchema = projectionData?.actionSchema || null;
  const inputSurfaces = frameworkState?.surfaces.surfaces || [];
  const actionTabActions = useMemo(() => enrichParticipantActionOptions(actionSchema?.actions || [], members), [actionSchema, members]);
  const calendarDraftApplyAction: SessionActionDefinition = useMemo(() => ({
    type: 'apply_calendar_patch_drafts',
    label: '应用日历冲突草案',
    description: '将当前会话范围内的日历冲突修正草案批量写入运行时事件，并参与云同步。',
    visibility: 'public',
  }), []);

  const showMemberTab = projectedDetailState?.showMemberTab ?? true;
  const showRuntimeTab = projectedDetailState?.showRuntimeTab ?? true;
  const showActionTab = projectedDetailState?.showActionTab ?? (chat?.type === 'group');
  const projectedActiveTab = projectedDetailState?.activeSidebarTab === 'actions'
    ? 'activities'
    : projectedDetailState?.activeSidebarTab;
  const activeSidebarTab = projectedActiveTab
    || (showMemberTab && rightPanelTab === 'members' ? 'members'
      : showRuntimeTab && rightPanelTab === 'narrative' ? 'narrative'
      : showRuntimeTab && rightPanelTab === 'world' ? 'world'
      : showActionTab && rightPanelTab === 'activities' ? 'activities'
        : showMemberTab ? 'members' : 'world');
  const memberTabTitle = projectedDetailState?.memberTabTitle || (chat?.type === 'group' ? '成员' : '角色');
  const runtimeTabTitle = projectedDetailState?.runtimeTabTitle || '运行态';
  const projectedSidebarTitle = projectedDetailState?.sidebarTitle === '动作'
    ? '活动'
    : projectedDetailState?.sidebarTitle;
  const sidebarTitle = projectedSidebarTitle
    || (activeSidebarTab === 'members'
      ? memberTabTitle
      : activeSidebarTab === 'activities'
        ? '活动'
        : activeSidebarTab === 'narrative'
          ? '叙事线'
          : runtimeTabTitle);
  const runtimePanelLoading = !projectionData && Boolean(chat);

  const directMemoryPanelContext = useMemo(() => {
    if (!chat || chat.type !== 'direct' || !activeMembers[0]) return null;
    return buildDirectMemoryPanelContext(activeMembers[0], currentChatMessages, new Map(characters.map((item) => [item.id, item] as const)));
  }, [activeMembers, characters, chat, currentChatMessages]);

  const sessionActions = useMemo(() => {
    if (!chat) return actionTabActions;
    if (chat.type !== 'group') return actionTabActions;
    return [calendarDraftApplyAction, ...buildProjectedSessionActions(chat, actionTabActions.filter((action) => action.type !== 'apply_calendar_patch_drafts'), members)];
  }, [actionTabActions, calendarDraftApplyAction, chat, members]);
  const projectedSidebarChat = useMemo(
    () => chat ? mergeProjectedRuntimeChat(chat, projectedDetailState?.sidebarChat.chat, projectedRuntimeState?.primaryRecentEvent) : null,
    [chat, projectedDetailState, projectedRuntimeState]
  );
  const projectedActionPanelActions = useMemo(() => {
    const projected = enrichParticipantActionOptions(projectedDetailState?.actionPanel.actions || [], members);
    if (chat?.type !== 'group') return projected;
    if (projected.some((action) => action.type === 'apply_calendar_patch_drafts')) return projected;
    return [calendarDraftApplyAction, ...projected];
  }, [calendarDraftApplyAction, chat?.type, members, projectedDetailState]);
  const actionPanelTitle = chat?.type === 'group' ? '动作与派生' : actionSchema?.title;
  const composerSurfaces = projectedDetailState?.composerSurfaces || (inputSurfaces.length ? inputSurfaces : (chat ? buildDefaultSessionSurfaceProjection(chat).surfaces : []));

  return {
    actionSchema,
    actionPanelTitle,
    activeSidebarTab,
    composerSurfaces,
    directMemoryPanelContext,
    memberTabTitle,
    privatePayloads,
    projectedActionPanelActions,
    projectedDetailState,
    projectedRuntimeState,
    projectedSidebarChat,
    runtimePanelLoading,
    runtimeTabTitle,
    sessionActions,
    showActionTab,
    showMemberTab,
    showRuntimeTab,
    sidebarTitle,
  };
}
