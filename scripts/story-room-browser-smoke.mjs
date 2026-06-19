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

async function getPage() {
  const pages = await cdpFetch('/json/list');
  const page = pages.find((item) => item.type === 'page');
  if (page) return page;
  return cdpFetch(`/json/new?${encodeURIComponent(`${CLIENT_URL}/chats`)}`, { method: 'PUT' });
}

const seedStoryRoomExpression = String.raw`
(async () => {
  const [
    { useChatStore },
    { useMessageStore },
    { useCharacterStore },
    { normalizeConversation },
    characterTypes,
  ] = await Promise.all([
    import('/src/stores/useChatStore.ts'),
    import('/src/stores/useMessageStore.ts'),
    import('/src/stores/useCharacterStore.ts'),
    import('/src/types/chat.ts'),
    import('/src/types/character.ts'),
  ]);
  const now = Date.now();
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
    id: 'story-browser-smoke',
    type: 'group',
    mode: 'scripted_play',
    sessionKind: { family: 'conversation', scenarioId: 'story-reader', surfaceProfile: 'hybrid', topology: 'group' },
    modeConfig: { freeSpeaking: true, allowInterruptions: true, allowPrivateThreads: false, allowDirectorInterventions: true, showRoleActions: false },
    modeState: { phase: 'free' },
    name: '旧医院浏览器烟测',
    topic: '雨夜旧医院',
    style: 'roleplay',
    runtimeEvolutionIntensity: 'slow',
    memberIds: ['lin', 'nurse'],
    speed: 1,
    isActive: true,
    allowIntervention: true,
    topicSeed: '',
    scenarioState: {
      phase: 'choice',
      sceneBeatCount: 0,
      choiceEpoch: 2,
      storyGoal: '查清旧医院停电真相',
      storySituation: '林医生在旧医院走廊发现新鲜血迹。',
      branches: [
        { branchId: 'ask-nurse', label: '让林医生追问护士昨晚去向', prompt: '林医生逼问护士说出停电时的真相', status: 'available', choiceEpoch: 2, intent: '逼问', risk: '激怒护士', reward: '得到停电线索' },
        { branchId: 'inspect-blood', label: '让主角检查墙上的新鲜血迹', prompt: '主角检查墙上的新鲜血迹', status: 'available', choiceEpoch: 2, intent: '探索', risk: '暴露位置', reward: '发现新证据' },
      ],
      openQuestions: ['旧医院为什么停电？'],
      clues: ['墙上的新鲜血迹'],
      stakes: ['护士可能反咬一口'],
      relationshipShifts: [],
      choiceHistory: [],
    },
    worldState: { phase: 'warming', mood: '', focus: '', recentEvent: '', conflictAxes: [] },
    governance: { ownerCharacterId: null, adminCharacterIds: [], autoModeration: false, allowMute: true, allowPrivateThreads: false },
    dramaRules: { allowCliques: false, allowMockery: false, allowAlliances: true, allowContempt: false },
    directorControls: { allowSpeakAs: true, allowDirectorMode: true, allowEventInjection: true, allowForcedReply: true },
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
  });
  const messages = [
    {
      id: 'intro',
      chatId: chat.id,
      type: 'ai',
      senderId: 'narrator',
      senderName: '旁白',
      content: '雨水顺着旧医院走廊的窗缝往下流，墙上的新鲜血迹还没有干。',
      emotion: 0,
      timestamp: now,
      isDeleted: false,
      metadata: {
        narrativeTurn: {
          turnId: 'intro-turn',
          turnKind: 'narrative_beat',
          povActorId: 'narrator',
          blocks: [
            { id: 'intro-narration', actorId: 'narrator', actorKind: 'narrator', kind: 'prose', displayMode: 'paragraph', text: '雨水顺着旧医院走廊的窗缝往下流，墙上的新鲜血迹还没有干。' },
            { id: 'intro-speech', actorId: 'lin', actorKind: 'character', kind: 'dialogue', displayMode: 'bubble', characterId: 'lin', text: '不要碰那道血迹，先看护士的反应。' },
          ],
        },
      },
    },
    {
      id: 'choice-source',
      chatId: chat.id,
      type: 'ai',
      senderId: 'narrator',
      senderName: '旁白',
      content: '',
      emotion: 0,
      timestamp: now + 1,
      isDeleted: false,
      metadata: {
        narrativeTurn: {
          turnId: 'choice-source-turn',
          turnKind: 'choice_prompt',
          povActorId: 'narrator',
          blocks: [
            { id: 'choice-diagnostic', actorId: 'narrator', actorKind: 'system', kind: 'system_note', displayMode: 'system_panel', text: '新的抉择点\n前情：林医生在走廊发现血迹。\n取舍：逼问护士 / 检查血迹' },
          ],
        },
        storyChoices: [
          { label: '让林医生追问护士昨晚去向', prompt: '林医生逼问护士说出停电时的真相', intent: '逼问', risk: '激怒护士', reward: '得到停电线索' },
          { label: '让主角检查墙上的新鲜血迹', prompt: '主角检查墙上的新鲜血迹', intent: '探索', risk: '暴露位置', reward: '发现新证据' },
        ],
      },
    },
  ];
  useCharacterStore.setState({
    characters: [
      { ...baseCharacter, id: 'lin', name: '林医生' },
      { ...baseCharacter, id: 'nurse', name: '护士' },
    ],
  });
  useChatStore.setState({
    chats: [chat],
    remoteDeletedChatIds: [],
    remoteDeletedChats: [],
    isLoading: false,
  });
  useMessageStore.setState({
    activeChatId: chat.id,
    messages,
    messageWindowsByChatId: {
      [chat.id]: {
        messages,
        lastSyncedAt: now,
        updatedAt: now + 1,
        remoteExhausted: true,
        activeLimit: 40,
      },
    },
    isLoading: false,
    isLoadingOlder: false,
    hasMore: false,
  });
  history.pushState(null, '', '/chats/story-browser-smoke');
  window.dispatchEvent(new PopStateEvent('popstate'));
  return 'seeded';
})()
`;

function assertCondition(condition, message, detail) {
  if (!condition) {
    const suffix = detail ? `\n${JSON.stringify(detail, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

async function main() {
  const page = await getPage();
  const cdp = new CdpClient(page.webSocketDebuggerUrl);
  await cdp.open();
  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.navigate', { url: `${CLIENT_URL}/chats` });
    await wait(1500);
    await evaluate(cdp, seedStoryRoomExpression, true);
    await wait(2500);

    const before = JSON.parse(await evaluate(cdp, `JSON.stringify({
      path: location.pathname,
      text: document.body.innerText,
      buttons: Array.from(document.querySelectorAll('button')).map((button) => button.innerText.trim()).filter(Boolean),
      messageTypes: Array.from(document.querySelectorAll('[data-message-type]')).map((node) => node.getAttribute('data-message-type')),
      hasDiagnosticText: document.body.innerText.includes('新的抉择点'),
      hasChoicePrompt: document.body.innerText.includes('选择接下来的剧情走向'),
      hasSpeech: document.body.innerText.includes('不要碰那道血迹')
    })`));
    assertCondition(before.path === '/chats/story-browser-smoke', 'Story smoke did not navigate to the seeded chat', before);
    assertCondition(before.hasChoicePrompt, 'Story choice panel was not visible before choosing', before);
    assertCondition(before.hasSpeech, 'Story speech bubble text was not visible before choosing', before);
    assertCondition(!before.hasDiagnosticText, 'Developer-only story diagnostic text leaked to normal UI', before);
    assertCondition(before.buttons.includes('让林医生追问护士昨晚去向'), 'Expected story choice button was missing', before.buttons);

    await evaluate(cdp, `(() => {
      const button = Array.from(document.querySelectorAll('button')).find((item) => item.innerText.includes('让林医生追问护士昨晚去向'));
      if (!button) throw new Error('choice button not found');
      button.click();
      return 'clicked';
    })()`);
    await wait(2200);

    const after = JSON.parse(await evaluate(cdp, `JSON.stringify({
      text: document.body.innerText,
      buttons: Array.from(document.querySelectorAll('button')).map((button) => button.innerText.trim()).filter(Boolean),
      messageIds: Array.from(document.querySelectorAll('[data-message-id]')).map((node) => node.getAttribute('data-message-id')),
      messageTypes: Array.from(document.querySelectorAll('[data-message-type]')).map((node) => node.getAttribute('data-message-type'))
    })`));
    assertCondition(after.text.includes('你选择了'), 'Selected choice reading node was not visible after choosing', after);
    assertCondition(!after.buttons.includes('让林医生追问护士昨晚去向'), 'Story choice button remained visible after choosing', after.buttons);
    assertCondition(after.messageTypes.includes('user'), 'Selected choice did not render as a user narrative node', after);

    const errors = cdp.events
      .filter((event) => event.method === 'Runtime.exceptionThrown' || event.method === 'Log.entryAdded')
      .map((event) => event.params)
      .filter((entry) => entry?.level === 'error' || entry?.exceptionDetails);
    assertCondition(errors.length === 0, 'Browser reported runtime errors during story smoke', errors);

    console.log(JSON.stringify({
      ok: true,
      url: CLIENT_URL,
      cdp: CDP_URL,
      before: {
        messageTypes: before.messageTypes,
        buttons: before.buttons.filter((button) => button.includes('让')),
      },
      after: {
        messageTypes: after.messageTypes,
        messageIds: after.messageIds,
      },
    }, null, 2));
  } finally {
    cdp.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
