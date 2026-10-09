import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Requires a dedicated browser: this harness seeds local-only test conversations.
const clientUrl = process.env.PNEUMATA_CLIENT_URL;
const cdpUrl = process.env.PNEUMATA_CDP_URL;
const apiKey = process.env.PNEUMATA_TEST_LLM_API_KEY;
const baseUrl = process.env.PNEUMATA_TEST_LLM_BASE_URL;
const model = process.env.PNEUMATA_TEST_LLM_MODEL;
if (!process.argv.includes('--run') || !clientUrl || !cdpUrl || !apiKey || !baseUrl || !model) {
  throw new Error('Requires --run, PNEUMATA_CLIENT_URL, isolated PNEUMATA_CDP_URL and PNEUMATA_TEST_LLM_API_KEY/BASE_URL/MODEL');
}
const reportDir = resolve(process.env.PNEUMATA_BROWSER_REPORT_DIR || '/tmp/mirage-bubble-acceptance');
await mkdir(reportDir, { recursive: true });
const targetResponse = await fetch(`${cdpUrl}/json/new?${encodeURIComponent(clientUrl)}`, { method: 'PUT' });
if (!targetResponse.ok) throw new Error(`Could not create isolated test tab: ${targetResponse.status}`);
const target = await targetResponse.json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { socket.addEventListener('open', res, { once: true }); socket.addEventListener('error', rej, { once: true }); });
let nextId = 0;
const pending = new Map();
const errors = [];
socket.addEventListener('message', ({ data }) => {
  const event = JSON.parse(data.toString());
  if (event.id) {
    const entry = pending.get(event.id);
    if (!entry) return;
    pending.delete(event.id);
    clearTimeout(entry.timeout);
    if (event.error) entry.reject(new Error(JSON.stringify(event.error)));
    else entry.resolve(event.result);
  } else if (event.method === 'Runtime.exceptionThrown') {
    errors.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
  }
});
function send(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 240000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
async function waitFor(expression) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await wait(150);
  }
  throw new Error(`Page readiness timeout: ${expression}`);
}
const profile = {
  id: 'browser-acceptance', name: 'Browser acceptance', type: 'text',
  provider: process.env.PNEUMATA_TEST_LLM_PROVIDER || 'openai', apiKey,
  baseUrl, model, isDefault: true,
};
const results = [];
try {
  await send('Runtime.enable');
  await send('Page.enable');
  await waitFor('document.querySelector("#root")?.children.length > 0');
  await evaluate(`(async () => {
    const [{useAuthStore}, {useSettingsStore}, {useChatStore}, {useCharacterStore}, {useMessageStore}, {useSchedulerStore}, {flushBufferedPersistenceWrites}, {normalizeConversation}, types, init, {useUIStore}] = await Promise.all([
      import('/src/stores/useAuthStore.ts'), import('/src/stores/useSettingsStore.ts'), import('/src/stores/useChatStore.ts'),
      import('/src/stores/useCharacterStore.ts'), import('/src/stores/useMessageStore.ts'), import('/src/stores/useSchedulerStore.ts'),
      import('/src/stores/storePersistenceScope.ts'), import('/src/types/chat.ts'), import('/src/types/character.ts'), import('/src/services/conversationInitialization.ts'), import('/src/stores/useUIStore.ts')
    ]);
    await useAuthStore.getState().enterLocalMode();
    for (const store of [useSettingsStore, useChatStore, useCharacterStore, useMessageStore, useUIStore]) {
      if (!store.persist.hasHydrated()) await store.persist.rehydrate();
    }
    useSchedulerStore.getState().stop();
    useSchedulerStore.getState().pause();
    useSettingsStore.setState({enableStreamingDisplayAnimation: true, developerMode: false});
    const now = Date.now();
    const base = {avatar: '', personality: types.DEFAULT_PERSONALITY, behavior: types.DEFAULT_CHARACTER_BEHAVIOR,
      expertise: [], relationships: [], memory: types.DEFAULT_CHARACTER_MEMORY, intervention: types.DEFAULT_CHARACTER_INTERVENTION,
      isPreset: false, createdAt: now, updatedAt: now};
    const characters = [
      {...base, id: 'bubble-mira', name: '米拉', speakingStyle: '熟人聊天，嘴硬心软，言语简洁。', background: '博远的老朋友，最近工作忙。'},
      {...base, id: 'bubble-bo', name: '博远', speakingStyle: '爱开玩笑但关心朋友。', background: '米拉的老朋友。'}
    ];
    const chats = ['direct', 'ai_direct', 'group'].map(type => normalizeConversation({
      id: 'bubble-acceptance-' + type, type, name: '气泡验收 ' + type, mode: 'open_chat', style: 'free',
      topic: '熟人约饭', memberIds: type === 'direct' ? ['user', 'bubble-mira'] : ['bubble-mira', 'bubble-bo'],
      speed: 1, isActive: false, allowIntervention: true, showRoleActions: true,
      modeState: {phase: 'free', initialization: init.createConversationInitializationState('completed', 'bubble-bo|bubble-mira')},
      createdAt: now, updatedAt: now
    }));
    useCharacterStore.setState({characters, isLoading: false, pendingOperations: []});
    useChatStore.setState({chats, currentChatId: chats[0].id, isLoading: false, pendingOperations: [], chatSummaryLoadedAt: now});
    useMessageStore.setState({messages: [], activeChatId: chats[0].id, messageWindowsByChatId: {}, isLoading: false, hasMore: false});
    flushBufferedPersistenceWrites();
    await new Promise(resolve => setTimeout(resolve, 900));
  })()`);
  for (const type of ['direct', 'ai_direct', 'group']) {
    const chatId = `bubble-acceptance-${type}`;
    await evaluate(`history.pushState({}, '', ${JSON.stringify('/chats/' + chatId)}); window.dispatchEvent(new PopStateEvent('popstate'));`);
    await wait(300);
    await waitFor(`location.pathname === ${JSON.stringify('/chats/' + chatId)} && document.querySelector('[data-chat-message-list]')`);
    await waitFor('document.querySelector("[data-chat-message-list]")');
    const result = await evaluate(`(async () => {
      const [{generateAndCommitAiMessage}, {useMessageStore}, {useChatStore}, {useCharacterStore}, {useSchedulerStore}, {loadSessionEngine}, {persistLocalFirstMessage}, {buildRuntimeEventMessageContent}] = await Promise.all([
        import('/src/services/aiMessageOrchestrator.ts'), import('/src/stores/useMessageStore.ts'), import('/src/stores/useChatStore.ts'),
        import('/src/stores/useCharacterStore.ts'), import('/src/stores/useSchedulerStore.ts'), import('/src/services/sessionEngineLoader.ts'),
        import('/src/services/chatCommitMessage.ts'), import('/src/services/runtimeEventFactory.ts')
      ]);
      const chatId = ${JSON.stringify(chatId)};
      const api = ${JSON.stringify(profile)};
      const getChat = () => useChatStore.getState().chats.find(chat => chat.id === chatId);
      if (!getChat()) throw new Error('Seed chat missing after navigation: ' + JSON.stringify(useChatStore.getState().chats.map(c => c.id)));
      await useMessageStore.getState().hydrateMessagesFromCache(chatId);
      const seed = await useMessageStore.getState().addMessage({chatId, type: ${JSON.stringify(type === 'direct' ? 'user' : 'ai')},
        senderId: ${JSON.stringify(type === 'direct' ? 'user' : 'bubble-bo')}, senderName: '博远', emotion: 0,
        content: '我刚下班，饿得不行！你先单独回我一句，过一会儿另发一条告诉我去哪吃，最后再单独补一句你自己的吐槽，别合在一条里。'});
      const samples = [];
      const sample = () => {
        const state = useMessageStore.getState();
        samples.push(state.messages.filter(m => m.chatId === chatId && m.senderId === 'bubble-mira' && !m.isDeleted).map(m => ({
          id: m.id, length: m.content.length, streaming: Boolean(m.isStreaming),
          visible: Boolean(document.querySelector('[data-message-id="' + m.id + '"]'))
        })));
      };
      const timer = setInterval(sample, 30);
      const chars = () => useCharacterStore.getState().characters;
      const store = useMessageStore.getState();
      const appendEventMessage = async (id, payload, sourceMessageId) => {
        await persistLocalFirstMessage({upsertMessage: store.upsertMessage, message: {chatId: id, type: 'event', senderId: 'system', senderName: 'System', emotion: 0,
          content: buildRuntimeEventMessageContent({...payload, sourceMessageId})}});
      };
      let committed;
      try {
        const engine = await loadSessionEngine(getChat());
        committed = await generateAndCommitAiMessage({api, aiProfiles: [api], chatId, chat: getChat(),
          speaker: chars().find(c => c.id === 'bubble-mira'), characters: chars(), currentMessages: [seed],
          onCommit: args => engine.onMessageCommitted(args), upsertMessage: store.upsertMessage,
          updateCharacter: useCharacterStore.getState().updateCharacter,
          appendEventMessage, updateChat: useChatStore.getState().updateChat,
          applyChatRuntimeDelta: useChatStore.getState().applyChatRuntimeDelta,
          recordSpeak: useSchedulerStore.getState().recordSpeak, getCurrentChat: getChat, getCurrentCharacters: chars});
        await new Promise(resolve => setTimeout(resolve, 300));
        sample();
      } finally {clearInterval(timer);}
      const messages = committed.results.map(r => r.persistedMessage);
      const failures = [];
      if (messages.length < 2) failures.push('Model did not produce multiple bubbles for explicit multi-send request');
      if (new Set(messages.map(m => m.id)).size !== messages.length) failures.push('Duplicate bubble identities');
      for (const m of messages) {
        const history = samples.flat().filter(s => s.id === m.id);
        if (!document.querySelector('[data-message-id="' + m.id + '"]')) failures.push('Missing final bubble: ' + m.id);
        if (m.isStreaming) failures.push('Persisted bubble still streaming: ' + m.id);
        if (!history.some(s => s.streaming && s.length > 0 && s.length < m.content.length)) failures.push('No partial typewriter sample: ' + m.id);
        for (let i = 1; i < history.length; i++) if (history[i].length < history[i-1].length) failures.push('Typewriter regressed: ' + m.id);
      }
      return {type: ${JSON.stringify(type)}, bubbleCount: messages.length, messages: messages.map(m => ({id: m.id, content: m.content})),
        sampleCount: samples.length, failures};
    })()`);
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: name === 'mobile' });
      await wait(300);
      const screenshot = await send('Page.captureScreenshot', { format: 'png' });
      await writeFile(resolve(reportDir, `${type}-${name}.png`), Buffer.from(screenshot.data, 'base64'));
    }
    await send('Emulation.clearDeviceMetricsOverride');
    await send('Page.reload');
    await wait(1000);
    await evaluate(`(async () => {
      const [{useChatStore}, {useCharacterStore}] = await Promise.all([import('/src/stores/useChatStore.ts'), import('/src/stores/useCharacterStore.ts')]);
      await Promise.all([useChatStore.getState().loadChats(), useCharacterStore.getState().loadCharacters()]);
      const {useMessageStore} = await import('/src/stores/useMessageStore.ts');
      await useMessageStore.getState().hydrateMessagesFromCache(${JSON.stringify(chatId)});
    })()`);
    await waitFor('document.querySelector("[data-chat-message-list]")');
    await wait(600);
    result.afterReload = await evaluate(`Array.from(document.querySelectorAll('[data-message-id]')).map(el => el.dataset.messageId)`);
    for (const m of result.messages) if (!result.afterReload.includes(m.id)) result.failures.push(`Bubble lost after reload: ${m.id}`);
    results.push(result);
    console.log(JSON.stringify(result));
  }
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await writeFile(resolve(reportDir, 'report.json'), JSON.stringify({results, errors}, null, 2));
  socket.close();
}
if (errors.length || results.some(r => r.failures.length) || results.length !== 3) process.exitCode = 1;
