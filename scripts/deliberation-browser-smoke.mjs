const CLIENT_URL = process.env.PNEUMATA_CLIENT_URL || 'http://127.0.0.1:5174';
const CDP_URL = process.env.PNEUMATA_CDP_URL || 'http://127.0.0.1:9222';

async function cdpFetch(path, init) {
  const response = await fetch(`${CDP_URL}${path}`, init);
  if (!response.ok) throw new Error(`CDP ${path} failed: ${response.status} ${await response.text()}`);
  const text = await response.text();
  return text.trim() ? JSON.parse(text) : null;
}

class CdpClient {
  constructor(webSocketDebuggerUrl) {
    this.ws = new WebSocket(webSocketDebuggerUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data.toString());
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
        return;
      }
      this.events.push(message);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 15000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
    });
  }

  close() {
    this.ws.close();
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function evaluate(cdp, expression, awaitPromise = false) {
  let result;
  try {
    result = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
    });
  } catch (error) {
    if (!String(error?.message || error).includes('Promise was collected')) throw error;
    await wait(350);
    result = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
    });
  }
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result?.value;
}

async function navigate(cdp, path) {
  await cdp.send('Page.navigate', { url: `${CLIENT_URL}${path}` });
  await waitFor(cdp, `document.readyState === 'complete' || document.readyState === 'interactive'`, 10000);
}

async function waitFor(cdp, conditionExpression, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const ok = await evaluate(cdp, `Boolean(${conditionExpression})`).catch(() => false);
    if (ok) return;
    await wait(150);
  }
  const snapshot = await pageSnapshot(cdp).catch(() => null);
  throw new Error(`Timed out waiting for condition: ${conditionExpression}\n${JSON.stringify(snapshot, null, 2)}`);
}

async function pageSnapshot(cdp) {
  return JSON.parse(await evaluate(cdp, `JSON.stringify({
    path: location.pathname,
    title: document.title,
    bodyText: document.body.innerText.slice(0, 4000),
    buttons: Array.from(document.querySelectorAll('button')).map((item) => item.innerText.trim()).filter(Boolean).slice(0, 80),
    chips: Array.from(document.querySelectorAll('.MuiChip-label')).map((item) => item.textContent).filter(Boolean).slice(0, 80),
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((item) => item.textContent),
  })`));
}

function assertCondition(condition, message, detail) {
  if (!condition) throw new Error(`${message}\n${JSON.stringify(detail, null, 2)}`);
}

function findRuntimeErrors(events) {
  return events
    .filter((event) => event.method === 'Runtime.exceptionThrown' || event.method === 'Log.entryAdded')
    .map((event) => event.params?.exceptionDetails?.text || event.params?.entry?.text || JSON.stringify(event.params))
    .filter((text) => {
      const value = String(text || '');
      return value && !value.includes('favicon') && !value.includes('ResizeObserver loop completed');
    });
}

const oldDeliberationCopy = ['固定' + '轮次', '目标' + '轮次', '自动' + '收束'];
const oldThinkingCategoryCopy = '思考' + '协作';

async function getPage() {
  const pages = await cdpFetch('/json/list');
  const page = pages.find((item) => item.type === 'page');
  if (page) return page;
  return cdpFetch(`/json/new?${encodeURIComponent(`${CLIENT_URL}/chats/create`)}`, { method: 'PUT' });
}

const templateAssertionsExpression = String.raw`
(async () => {
  const [
    { getRoomTemplate, filterRoomTemplatesForAvailability, ROOM_TEMPLATES },
    { buildGroupChatDraft },
    { DISCUSSION_ENGINE },
    characterTypes,
  ] = await Promise.all([
    import('/src/services/roomTemplates.ts'),
    import('/src/services/chatDraftBuilder.ts'),
    import('/src/services/engines/discussionEngine.ts'),
    import('/src/types/character.ts'),
  ]);
  const publicKeys = filterRoomTemplatesForAvailability(ROOM_TEMPLATES, { developerMode: false }).map((template) => template.key);
  const requiredPublicKeys = ['opinion_review', 'roundtable_review', 'role_debate', 'courtroom_deliberation', 'expert_review', 'public_inquiry'];
  const missingPublicKeys = requiredPublicKeys.filter((key) => !publicKeys.includes(key));
  const forbiddenPublicKeys = ['brainstorm_workshop', 'retrospective_room'].filter((key) => publicKeys.includes(key));
  const templates = requiredPublicKeys.map((key) => getRoomTemplate(key));
  const draftRows = templates.map((template) => {
    const draft = buildGroupChatDraft({
      type: 'group',
      name: template.label,
      topic: '是否应该重构推荐系统',
      style: template.style,
      runtimeEvolutionIntensity: template.runtimeEvolutionIntensity,
      sessionKind: template.sessionKind,
      memberIds: ['analyst-a', 'analyst-b', 'analyst-c'],
      operatorIds: [],
      showRoleActions: true,
      seedMemoryText: '',
      seedArtifactText: '',
      ownerCharacterId: null,
      adminCharacterIds: [],
      autoModeration: false,
      allowMute: true,
      allowPrivateThreads: Boolean(template.defaults?.allowPrivateThreads),
      allowCliques: Boolean(template.defaults?.allowCliques),
      allowMockery: Boolean(template.defaults?.allowMockery),
      mood: '',
      focus: '',
      recentEvent: '',
      allowSpeakAs: true,
      allowDirectorMode: true,
      allowEventInjection: true,
      allowForcedReply: true,
    });
    const participants = DISCUSSION_ENGINE.buildParticipants(draft);
    const schema = DISCUSSION_ENGINE.getActionSchema({ conversation: draft, participants });
    const promptContext = DISCUSSION_ENGINE.buildGenerationPromptContext({
      conversation: draft,
      characters: [
        { id: 'analyst-a', name: '分析师A', ...characterTypes.DEFAULT_CHARACTER_MEMORY },
        { id: 'analyst-b', name: '分析师B', ...characterTypes.DEFAULT_CHARACTER_MEMORY },
        { id: 'analyst-c', name: '分析师C', ...characterTypes.DEFAULT_CHARACTER_MEMORY },
      ],
      messages: [],
      speaker: { id: 'analyst-a', name: '分析师A' },
    });
    return {
      key: template.key,
      label: template.label,
      scenarioId: draft.sessionKind?.scenarioId,
      family: draft.sessionKind?.family,
      mode: draft.mode,
      phase: draft.scenarioState?.phase,
      discussionMode: draft.scenarioState?.discussionMode,
      progress: draft.scenarioState?.progress?.[0],
      actionTypes: schema.actions.map((action) => action.type),
      actionLabels: schema.actions.map((action) => action.label),
      promptPrefix: promptContext?.promptPrefix || '',
    };
  });
  return JSON.stringify({ publicKeys, missingPublicKeys, forbiddenPublicKeys, draftRows });
})()
`;

const seedDeliberationExpression = String.raw`
(async () => {
  const [
    { useChatStore },
    { useMessageStore },
    { useCharacterStore },
    { useAuthStore },
    { useSettingsStore },
    { useUIStore },
    { useSchedulerStore },
    { flushBufferedPersistenceWrites },
    { normalizeConversation },
    characterTypes,
  ] = await Promise.all([
    import('/src/stores/useChatStore.ts'),
    import('/src/stores/useMessageStore.ts'),
    import('/src/stores/useCharacterStore.ts'),
    import('/src/stores/useAuthStore.ts'),
    import('/src/stores/useSettingsStore.ts'),
    import('/src/stores/useUIStore.ts'),
    import('/src/stores/useSchedulerStore.ts'),
    import('/src/stores/storePersistenceScope.ts'),
    import('/src/types/chat.ts'),
    import('/src/types/character.ts'),
  ]);
  const now = Date.now();
  const chatId = 'deliberation-browser-smoke';
  const baseCharacter = {
    avatar: '',
    personality: characterTypes.DEFAULT_PERSONALITY,
    behavior: characterTypes.DEFAULT_CHARACTER_BEHAVIOR,
    expertise: [],
    speakingStyle: '',
    background: '',
    relationships: [],
    memory: characterTypes.DEFAULT_CHARACTER_MEMORY,
    intervention: characterTypes.DEFAULT_CHARACTER_INTERVENTION,
    isPreset: false,
    createdAt: now,
    updatedAt: now,
  };
  const characters = [
    { ...baseCharacter, id: 'analyst-a', name: '分析师A' },
    { ...baseCharacter, id: 'analyst-b', name: '分析师B' },
    { ...baseCharacter, id: 'analyst-c', name: '分析师C' },
  ];
  const chat = normalizeConversation({
    id: chatId,
    type: 'group',
    mode: 'roundtable',
    sessionKind: { topology: 'table', family: 'analysis', scenarioId: 'role-debate', surfaceProfile: 'text' },
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: false, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free' },
    scenarioPackage: { scenarioId: 'role-debate', label: 'role-debate' },
    name: '审议浏览器烟测',
    topic: '是否应该重构推荐系统',
    style: 'debate',
    runtimeEvolutionIntensity: 'fast',
    memberIds: ['analyst-a', 'analyst-b', 'analyst-c'],
    speed: 1,
    isActive: true,
    allowIntervention: true,
    showRoleActions: true,
    topicSeed: '',
    scenarioState: {
      phase: 'debate',
      discussionMode: 'debate',
      turnOrder: ['analyst-a', 'analyst-b', 'analyst-c'],
      currentTurnActorId: 'analyst-b',
      goals: [{ goalId: 'discussion-goal', label: '是否应该重构推荐系统', status: 'active', progress: 0 }],
      progress: [{ key: 'speeches', label: '攻防进度', value: 2, target: 0 }],
      seats: [
        { seatId: 'seat-1', seatIndex: 0, actorId: 'analyst-a' },
        { seatId: 'seat-2', seatIndex: 1, actorId: 'analyst-b' },
        { seatId: 'seat-3', seatIndex: 2, actorId: 'analyst-c' },
      ],
      roleAssignments: [
        { actorId: 'analyst-a', roleId: 'affirmative', factionId: 'pro', summary: '支持重构' },
        { actorId: 'analyst-b', roleId: 'negative', factionId: 'con', summary: '反对重构' },
        { actorId: 'analyst-c', roleId: 'reviewer', factionId: 'review', summary: '评审论据质量' },
      ],
      deliberationClaims: [
        { id: 'claim-a', actorId: 'analyst-a', stance: 'support', text: '支持重构：召回层技术债已经影响推荐质量。' },
        { id: 'claim-b', actorId: 'analyst-b', stance: 'oppose', text: '反对立即重构：迁移成本和灰度风险还没有量化。' },
      ],
      deliberationEvidence: [
        { id: 'evidence-a', actorId: 'analyst-a', text: '证据：最近三次推荐事故都和召回层补丁有关。' },
      ],
      deliberationIssues: [
        { id: 'issue-b', targetActorId: 'analyst-b', text: '灰度链路缺口是否足以阻止本季度重构？', status: 'open' },
      ],
      deliberationVerdicts: [
        { id: 'verdict-c', actorId: 'analyst-c', text: '阶段判断：收益成立，但必须先补迁移成本证据。', tendency: 'mixed' },
      ],
      deliberationMomentum: { support: 1, oppose: 1, inquiry: 1, review: 1, label: '势均力敌' },
      summaryText: '当前分歧：收益明确，但迁移风险仍需证据支撑。',
    },
    worldState: { phase: 'debating', mood: 'contested', focus: '是否应该重构推荐系统', recentEvent: '审议推进：需要回应迁移风险', conflictAxes: [] },
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: false },
    dramaRules: { allowCliques: true, allowMockery: true, allowAlliances: true, allowContempt: false },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now + 2,
  });
  const messages = [
    {
      id: 'deliberation-a',
      chatId,
      type: 'ai',
      senderId: 'analyst-a',
      senderName: '分析师A',
      content: '支持重构的一方认为，推荐系统当前最大的瓶颈在召回层，继续补丁会扩大技术债。',
      emotion: 0,
      timestamp: now,
      isDeleted: false,
    },
    {
      id: 'deliberation-b',
      chatId,
      type: 'ai',
      senderId: 'analyst-b',
      senderName: '分析师B',
      content: '反方质疑迁移成本没有被量化，尤其是实验平台和灰度链路都还没有准备好。',
      emotion: 0,
      timestamp: now + 1,
      isDeleted: false,
    },
  ];
  localStorage.setItem('pneumata-auth-mode', 'local');
  localStorage.removeItem('pneumata-token');
  localStorage.removeItem('pneumata-user');
  localStorage.setItem('pneumata-cloud-sync-enabled', '0');
  useAuthStore.setState({ authMode: 'local', token: null, user: null, isLoggedIn: false, isLoading: false });
  await Promise.all([
    useChatStore.persist.hasHydrated() ? undefined : useChatStore.persist.rehydrate(),
    useMessageStore.persist.hasHydrated() ? undefined : useMessageStore.persist.rehydrate(),
    useCharacterStore.persist.hasHydrated() ? undefined : useCharacterStore.persist.rehydrate(),
    useSettingsStore.persist.hasHydrated() ? undefined : useSettingsStore.persist.rehydrate(),
    useUIStore.persist.hasHydrated() ? undefined : useUIStore.persist.rehydrate(),
  ]);
  useSchedulerStore.getState().stop();
  useSchedulerStore.getState().pause();
  useSettingsStore.setState((state) => ({ ...state, developerMode: false, developerUI: { ...state.developerUI, showAdvancedRuntimePanels: false } }));
  useUIStore.setState((state) => ({ ...state, rightPanelOpen: true, rightPanelTab: 'world' }));
  useCharacterStore.setState({
    characters,
    lastSyncedAt: now,
    pendingOperations: [],
    pendingEditSyncCount: 0,
    pendingEditSyncError: null,
    fieldConflicts: [],
    isLoading: false,
  });
  useChatStore.setState({
    chats: [chat],
    currentChatId: chat.id,
    lastSyncedAt: now,
    pendingOperations: [],
    pendingEditSyncCount: 0,
    pendingEditSyncError: null,
    remoteDeletedChatIds: [],
    remoteDeletedChats: [],
    fieldConflicts: [],
    chatSummaryLoadedAt: now,
    isLoading: false,
  });
  useMessageStore.setState({
    activeChatId: chat.id,
    messages,
    messageWindowsByChatId: {
      [chat.id]: {
        messages,
        lastSyncedAt: now,
        updatedAt: now,
        remoteExhausted: true,
        activeLimit: 80,
      },
    },
    pendingOperations: [],
    isLoading: false,
    isLoadingOlder: false,
    isLoadingNewer: false,
    hasMore: false,
    hasMoreNewer: false,
  });
  flushBufferedPersistenceWrites();
  await new Promise((resolve) => setTimeout(resolve, 400));
  history.pushState(null, '', '/chats/' + chatId);
  window.dispatchEvent(new PopStateEvent('popstate'));
  return chatId;
})()
`;

async function main() {
  const page = await getPage();
  const cdp = new CdpClient(page.webSocketDebuggerUrl);
  await cdp.open();
  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await navigate(cdp, '/');
    await evaluate(cdp, `(async () => {
      localStorage.setItem('pneumata-auth-mode', 'local');
      localStorage.removeItem('pneumata-token');
      localStorage.removeItem('pneumata-user');
      localStorage.setItem('pneumata-cloud-sync-enabled', '0');
      const { useAuthStore } = await import('/src/stores/useAuthStore.ts');
      useAuthStore.setState({ authMode: 'local', token: null, user: null, isLoggedIn: false, isLoading: false });
      return 'local-auth-ready';
    })()`, true);
    await navigate(cdp, '/chats/create');
    await waitFor(cdp, `document.body.innerText.includes('玩法')`, 12000);
    await evaluate(cdp, `(() => {
      const button = Array.from(document.querySelectorAll('button')).find((item) => item.innerText.trim() === '玩法');
      if (!button) throw new Error('gameplay tab button not found');
      button.click();
      return 'gameplay-tab-clicked';
    })()`);
    await waitFor(cdp, `document.body.innerText.includes('玩法类型')`, 12000);
    const createSnapshot = await pageSnapshot(cdp);
    assertCondition(createSnapshot.bodyText.includes('观点审议'), 'Create page did not expose the deliberation structure', createSnapshot);
    assertCondition(createSnapshot.bodyText.includes('自由互动'), 'Create page lost free interaction structure while adding deliberation', createSnapshot);
    assertCondition(!createSnapshot.bodyText.includes(oldThinkingCategoryCopy), 'Create page still exposed old thinking-collaboration category text', createSnapshot);
    assertCondition(!oldDeliberationCopy.some((text) => createSnapshot.bodyText.includes(text)), 'Create page leaked old fixed-round deliberation copy', createSnapshot);

    const templateResult = JSON.parse(await evaluate(cdp, templateAssertionsExpression, true));
    assertCondition(templateResult.missingPublicKeys.length === 0, 'Some publishable deliberation templates are hidden from standard users', templateResult);
    assertCondition(templateResult.forbiddenPublicKeys.length === 0, 'Experimental brainstorm/retrospective templates leaked to standard users', templateResult);
    for (const row of templateResult.draftRows) {
      assertCondition(row.family === 'analysis', 'Deliberation template did not use analysis family', row);
      assertCondition(row.progress?.target === 0, 'Deliberation draft is not open-ended', row);
      assertCondition(row.actionTypes.includes('question_member') && row.actionTypes.includes('submit_evidence') && row.actionTypes.includes('record_verdict') && row.actionTypes.includes('summarize_discussion') && row.actionTypes.includes('shift_to_synthesis'), 'Deliberation action schema is incomplete', row);
      assertCondition(row.actionTypes.includes('mute_member'), 'Deliberation action schema did not inherit governance mute action', row);
      assertCondition(row.actionLabels.includes('质询成员') && row.actionLabels.some((label) => label.includes('总结')), 'Deliberation action labels are not user-facing', row);
      assertCondition(row.promptPrefix.includes('deliberation') || row.promptPrefix.includes('debate') || row.promptPrefix.includes('review') || row.promptPrefix.includes('inquiry'), 'Deliberation prompt context did not describe the scenario', row);
    }

    const chatId = await evaluate(cdp, seedDeliberationExpression, true);
    await waitFor(cdp, `document.body.innerText.includes('支持重构的一方认为')`, 12000);
    await evaluate(cdp, `(async () => {
      const { useUIStore } = await import('/src/stores/useUIStore.ts');
      useUIStore.setState((state) => ({ ...state, rightPanelOpen: true, rightPanelTab: 'world' }));
      window.dispatchEvent(new Event('resize'));
      return 'world-tab-opened';
    })()`, true);
    await waitFor(cdp, `document.body.innerText.includes('场景规则')`, 12000);
    const worldSnapshot = await pageSnapshot(cdp);
    assertCondition(worldSnapshot.bodyText.includes('攻防进度'), 'Runtime sidebar did not show deliberation progress label', worldSnapshot);
    assertCondition(worldSnapshot.bodyText.includes('当前发言') && worldSnapshot.bodyText.includes('分析师B'), 'Runtime sidebar did not show current deliberation speaker', worldSnapshot);
    assertCondition(worldSnapshot.bodyText.includes('论点树') && worldSnapshot.bodyText.includes('支持重构'), 'Runtime sidebar did not show deliberation claims', worldSnapshot);
    assertCondition(worldSnapshot.bodyText.includes('证据') && worldSnapshot.bodyText.includes('推荐事故'), 'Runtime sidebar did not show deliberation evidence', worldSnapshot);
    assertCondition(worldSnapshot.bodyText.includes('待回应漏洞') && worldSnapshot.bodyText.includes('灰度链路缺口'), 'Runtime sidebar did not show deliberation open issues', worldSnapshot);
    assertCondition(worldSnapshot.bodyText.includes('裁决记录') && worldSnapshot.bodyText.includes('阶段判断'), 'Runtime sidebar did not show deliberation verdicts', worldSnapshot);
    assertCondition(worldSnapshot.bodyText.includes('审议势头') && worldSnapshot.bodyText.includes('势均力敌'), 'Runtime sidebar did not show deliberation momentum', worldSnapshot);
    assertCondition(worldSnapshot.bodyText.includes('当前分歧'), 'Runtime sidebar did not show deliberation summary text', worldSnapshot);
    assertCondition(!oldDeliberationCopy.some((text) => worldSnapshot.bodyText.includes(text)), 'Runtime sidebar leaked old fixed-round copy', worldSnapshot);

    await evaluate(cdp, `(async () => {
      const { useUIStore } = await import('/src/stores/useUIStore.ts');
      useUIStore.setState((state) => ({ ...state, rightPanelOpen: true, rightPanelTab: 'actions' }));
      window.dispatchEvent(new Event('resize'));
      return 'actions-tab';
    })()`, true);
    await waitFor(cdp, `document.body.innerText.includes('质询成员')`, 12000);
    const actionSnapshot = await pageSnapshot(cdp);
    assertCondition(actionSnapshot.bodyText.includes('质询成员'), 'Action panel did not render question-member action', actionSnapshot);
    assertCondition(actionSnapshot.bodyText.includes('提交证据'), 'Action panel did not render submit-evidence action', actionSnapshot);
    assertCondition(actionSnapshot.bodyText.includes('记录裁决'), 'Action panel did not render record-verdict action', actionSnapshot);
    assertCondition(actionSnapshot.bodyText.includes('总结审议'), 'Action panel did not render summarize action', actionSnapshot);
    assertCondition(actionSnapshot.bodyText.includes('结论整理'), 'Action panel did not render manual phase-shift action', actionSnapshot);
    assertCondition(!actionSnapshot.bodyText.includes('question_member') && !actionSnapshot.bodyText.includes('submit_evidence') && !actionSnapshot.bodyText.includes('record_verdict') && !actionSnapshot.bodyText.includes('summarize_discussion') && !actionSnapshot.bodyText.includes('shift_to_synthesis'), 'Action panel leaked raw action type text', actionSnapshot);

    const errors = findRuntimeErrors(cdp.events);
    assertCondition(errors.length === 0, 'Browser reported runtime errors during deliberation smoke', errors);
    console.log(JSON.stringify({
      ok: true,
      url: CLIENT_URL,
      cdp: CDP_URL,
      publicTemplates: templateResult.draftRows.map((row) => row.key),
      chatId,
      worldChecks: {
        hasProgress: worldSnapshot.bodyText.includes('攻防进度'),
        hasCurrentSpeaker: worldSnapshot.bodyText.includes('当前发言'),
        hasArtifacts: worldSnapshot.bodyText.includes('论点树') && worldSnapshot.bodyText.includes('审议势头'),
      },
      actionButtons: actionSnapshot.buttons.filter((button) => ['发起质询', '提交证据', '记录裁决', '生成总结', '整理结论', '执行动作'].some((text) => button.includes(text))),
    }, null, 2));
  } finally {
    cdp.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
