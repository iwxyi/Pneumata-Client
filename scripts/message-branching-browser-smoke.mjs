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
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
  });
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
  return JSON.parse(await evaluate(cdp, `(async () => {
    const [{ useChatStore }, { useMessageStore }, { projectCurrentChatMessages }, { buildMessageBranchVersionInfoByMessageId, isMessageBranchingEnabled }] = await Promise.all([
      import('/src/stores/useChatStore.ts'),
      import('/src/stores/useMessageStore.ts'),
      import('/src/services/currentChatMessages.ts'),
      import('/src/services/messageBranching.ts'),
    ]);
    const chatState = useChatStore.getState();
    const messageState = useMessageStore.getState();
    const smokeChat = chatState.chats.find((chat) => chat.id === 'message-branching-browser-smoke') || null;
    const projected = smokeChat ? projectCurrentChatMessages({
      chatId: smokeChat.id,
      chat: smokeChat,
      activeMessages: messageState.messages,
      cachedWindow: messageState.messageWindowsByChatId[smokeChat.id],
    }) : [];
    const versionInfo = smokeChat ? buildMessageBranchVersionInfoByMessageId(
      smokeChat,
      projectCurrentChatMessages({
        chatId: smokeChat.id,
        activeMessages: messageState.messages,
        cachedWindow: messageState.messageWindowsByChatId[smokeChat.id],
      }),
      projected.map((message) => message.id),
    ) : {};
    return JSON.stringify({
      path: location.pathname,
      bodyText: document.body.innerText.slice(0, 3000),
      messageIds: Array.from(document.querySelectorAll('[data-message-id]')).map((item) => item.dataset.messageId).slice(0, 80),
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((item) => item.textContent),
      chatStore: {
        chatIds: chatState.chats.map((chat) => chat.id),
        currentChatId: chatState.currentChatId,
        hasSmokeChat: Boolean(chatState.chats.find((chat) => chat.id === 'message-branching-browser-smoke')),
        branchingEnabled: isMessageBranchingEnabled(smokeChat),
      },
      messageStore: {
        activeChatId: messageState.activeChatId,
        activeMessages: messageState.messages.length,
        windowMessages: messageState.messageWindowsByChatId['message-branching-browser-smoke']?.messages?.length || 0,
        projectedIds: projected.map((message) => message.id).slice(0, 80),
        versionInfoKeys: Object.keys(versionInfo),
      },
    });
  })()`, true));
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

async function getPage() {
  const pages = await cdpFetch('/json/list');
  const page = pages.find((item) => item.type === 'page');
  if (page) return page;
  return cdpFetch(`/json/new?${encodeURIComponent(`${CLIENT_URL}/chats`)}`, { method: 'PUT' });
}

const seedMessageBranchingExpression = String.raw`
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
  const chatId = 'message-branching-browser-smoke';
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
  const chat = normalizeConversation({
    id: chatId,
    type: 'group',
    mode: 'open_chat',
    sessionKind: { topology: 'group', family: 'conversation', scenarioId: 'open-chat', surfaceProfile: 'text' },
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: true, allowDirectorInterventions: true, showRoleActions: true },
    modeState: { phase: 'free' },
    name: '消息分支浏览器烟测',
    topic: '分支测试',
    style: 'free',
    runtimeEvolutionIntensity: 'balanced',
    memberIds: ['alice'],
    speed: 1,
    isActive: true,
    allowIntervention: true,
    showRoleActions: true,
    topicSeed: '',
    messageBranchState: {
      selectedRevisionByRootId: { 'branch-root': 'branch-root', 'nested-root': 'nested-alt' },
      activeChildByParentNodeId: { 'anchor': 'branch-root', 'branch-alt': 'nested-alt' },
      activeLeafNodeId: 'original-tail',
      updatedAt: now,
    },
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: true },
    dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
    worldState: { phase: 'idle', mood: '', focus: '', recentEvent: '', conflictAxes: [] },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now + 90,
  });
  const storyChat = normalizeConversation({
    ...chat,
    id: 'message-branching-disabled-story-smoke',
    mode: 'scripted_play',
    sessionKind: { topology: 'group', family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid' },
    name: '禁用分支故事房烟测',
    messageBranchState: null,
  });
  const message = (id, content, timestamp, metadata = undefined) => ({
    id,
    chatId,
    type: 'ai',
    senderId: 'alice',
    senderName: 'Alice',
    content,
    emotion: 0,
    timestamp,
    metadata,
    isDeleted: false,
  });
  const fillerBefore = Array.from({ length: 20 }, (_, index) => message(
    'before-' + (index + 1),
    '切换前填充消息 ' + (index + 1),
    now + index,
  ));
  const branchMessages = [
    message('anchor', '共同上游锚点', now + 30),
    message('branch-root', '原始版本消息', now + 31),
    message('original-tail', '原始版本后续', now + 32),
    message('branch-alt', '新版本消息', now + 33, { branching: { parentNodeId: 'anchor', revisionRootId: 'branch-root', revisionOfMessageId: 'branch-root' } }),
    message('nested-root', '新版本下的默认子分支', now + 34, { branching: { parentNodeId: 'branch-alt' } }),
    message('nested-alt', '新版本下恢复的子分支', now + 35, { branching: { parentNodeId: 'branch-alt', revisionRootId: 'nested-root', revisionOfMessageId: 'nested-root' } }),
    message('nested-tail', '恢复子分支后的后续', now + 36, { branching: { parentNodeId: 'nested-alt' } }),
  ];
  const fillerAfter = Array.from({ length: 30 }, (_, index) => message(
    'after-' + (index + 1),
    '切换后填充消息 ' + (index + 1),
    now + 50 + index,
  ));
  const messages = [...fillerBefore, ...branchMessages, ...fillerAfter];

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
  useSettingsStore.setState((state) => ({ ...state, developerMode: false }));
  useCharacterStore.setState({
    characters: [{ ...baseCharacter, id: 'alice', name: 'Alice' }],
    lastSyncedAt: now,
    pendingOperations: [],
    pendingEditSyncCount: 0,
    pendingEditSyncError: null,
    fieldConflicts: [],
    isLoading: false,
  });
  useChatStore.setState({
    chats: [chat, storyChat],
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
    messages: messages.slice(-40),
    messageWindowsByChatId: {
      [chat.id]: {
        messages,
        lastSyncedAt: now,
        updatedAt: now + 90,
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
  await new Promise((resolve) => setTimeout(resolve, 900));
  return { chatId: chat.id, storyChatId: storyChat.id };
})()
`;

const smokeAssertionsExpression = String.raw`
(async () => {
  const list = document.querySelector('[data-chat-message-list]');
  if (!list) throw new Error('missing message list');
  const byText = (text) => document.body.innerText.includes(text);
  if (!byText('原始版本消息')) throw new Error('original branch message is not visible');
  if (byText('新版本消息')) throw new Error('inactive revision is visible before switching');
  if (!byText('1/2')) throw new Error('revision indicator 1/2 is missing');
  const original = document.querySelector('[data-message-id="branch-root"]');
  if (!original) throw new Error('missing branch-root element');
  list.scrollTop = Math.max(0, original.offsetTop - list.clientHeight * 0.35);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const beforeTop = original.getBoundingClientRect().top;
  const revisionLabel = Array.from(document.querySelectorAll('body *')).find((node) => node.textContent?.trim() === '1/2');
  if (!revisionLabel) throw new Error('missing exact revision label');
  const controls = revisionLabel.parentElement;
  const buttons = Array.from(controls?.querySelectorAll('button') || []);
  const nextButton = buttons.at(-1);
  if (!nextButton || nextButton.disabled) throw new Error('next revision button unavailable');
  nextButton.click();
  await new Promise((resolve) => setTimeout(resolve, 450));
  if (!byText('新版本消息')) throw new Error('new revision did not become visible');
  if (!byText('恢复子分支后的后续')) throw new Error('nested descendant branch path was not restored');
  if (byText('原始版本后续')) throw new Error('inactive original continuation is still visible');
  if (!byText('2/2')) throw new Error('revision indicator did not update to 2/2');
  const target = document.querySelector('[data-message-id="branch-alt"]');
  if (!target) throw new Error('missing branch-alt element after switch');
  const afterTop = target.getBoundingClientRect().top;
  if (Math.abs(afterTop - beforeTop) > 48) {
    throw new Error('branch switch scroll anchor moved too far: before=' + beforeTop + ', after=' + afterTop);
  }
  return {
    beforeTop,
    afterTop,
    text: document.body.innerText.slice(0, 1200),
  };
})()
`;

const disabledModeAssertionExpression = String.raw`
(async () => {
  const { isMessageBranchingEnabled } = await import('/src/services/messageBranching.ts');
  const enabled = isMessageBranchingEnabled({
    mode: 'scripted_play',
    sessionKind: { topology: 'group', family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid' },
    messageBranchState: null,
  });
  if (enabled) throw new Error('story-reader should not enable message branching');
  return true;
})()
`;

const page = await getPage();
const cdp = new CdpClient(page.webSocketDebuggerUrl);
await cdp.open();

try {
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1366,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await navigate(cdp, '/chats/message-branching-browser-smoke');
  await wait(600);
  const seeded = await evaluate(cdp, seedMessageBranchingExpression, true);
  await navigate(cdp, `/chats/${seeded.chatId}`);
  await waitFor(cdp, `document.body.innerText.includes('原始版本消息') && document.body.innerText.includes('1/2')`, 12000);
  const result = await evaluate(cdp, smokeAssertionsExpression, true);
  await evaluate(cdp, disabledModeAssertionExpression, true);
  const runtimeErrors = findRuntimeErrors(cdp.events);
  if (runtimeErrors.length) throw new Error(`Runtime errors during message branching smoke:\n${runtimeErrors.join('\n')}`);
  console.log(JSON.stringify({ ok: true, result }, null, 2));
} catch (error) {
  const snapshot = await pageSnapshot(cdp).catch(() => null);
  console.error(JSON.stringify({ ok: false, error: String(error?.stack || error), snapshot }, null, 2));
  process.exitCode = 1;
} finally {
  cdp.close();
}
