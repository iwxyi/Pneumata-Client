const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

const HELP = `
Story room real-model acceptance.

Required environment:
  PNEUMATA_STORY_LLM_API_KEY   Model API key.
  PNEUMATA_STORY_LLM_MODEL     Chat model name.

Optional environment:
  PNEUMATA_STORY_LLM_BASE_URL  OpenAI-compatible base URL. Defaults to ${DEFAULT_BASE_URL}
  PNEUMATA_STORY_LLM_TIMEOUT_MS Request timeout. Defaults to 45000

Example:
  PNEUMATA_STORY_LLM_API_KEY=... PNEUMATA_STORY_LLM_MODEL=gpt-4.1 \\
    npm run test:story-llm-acceptance --workspace=Pneumata-Client
`.trim();

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}

const config = {
  apiKey: process.env.PNEUMATA_STORY_LLM_API_KEY || '',
  model: process.env.PNEUMATA_STORY_LLM_MODEL || '',
  baseUrl: process.env.PNEUMATA_STORY_LLM_BASE_URL || DEFAULT_BASE_URL,
  timeoutMs: parseTimeoutMs(process.env.PNEUMATA_STORY_LLM_TIMEOUT_MS),
};

if (!config.apiKey || !config.model) {
  console.error('Missing PNEUMATA_STORY_LLM_API_KEY or PNEUMATA_STORY_LLM_MODEL.');
  console.error(HELP);
  process.exit(2);
}

function trimTrailingSlashes(value) {
  return value.replace(/\/+$/, '');
}

function parseTimeoutMs(value) {
  const parsed = Number(value || 45000);
  return Number.isFinite(parsed) ? Math.max(5000, parsed) : 45000;
}

function chatUrl(baseUrl) {
  const normalized = trimTrailingSlashes(baseUrl);
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`;
}

function normalizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function normalizeRepeatText(text) {
  return normalizeWhitespace(text)
    .replace(/[，。！？、；：“”"'‘’（）()[\]{}《》<>…—\-.,!?;:]/g, '')
    .trim();
}

function buildNgrams(text, size = 3) {
  const grams = new Set();
  if (text.length <= size) {
    if (text) grams.add(text);
    return grams;
  }
  for (let index = 0; index <= text.length - size; index += 1) grams.add(text.slice(index, index + size));
  return grams;
}

function textSimilarity(left, right) {
  const a = buildNgrams(normalizeRepeatText(left));
  const b = buildNgrams(normalizeRepeatText(right));
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  a.forEach((gram) => {
    if (b.has(gram)) overlap += 1;
  });
  return overlap / Math.min(a.size, b.size);
}

function countMatches(text, pattern) {
  pattern.lastIndex = 0;
  return Array.from(String(text || '').matchAll(pattern)).length;
}

function clip(text, max = 1600) {
  return normalizeWhitespace(text).slice(0, max).trim();
}

function parseJsonObject(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || raw;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error(`Model did not return JSON: ${raw.slice(0, 500)}`);
  }
}

function normalizeChoice(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const label = clip(raw.label, 120);
  const prompt = clip(raw.prompt || raw.label, 180);
  if (!label || !prompt) return null;
  return {
    label,
    prompt,
    intent: clip(raw.intent, 80),
    risk: clip(raw.risk, 120),
    reward: clip(raw.reward, 120),
  };
}

function isAbstractChoice(choice) {
  const text = normalizeWhitespace(`${choice.label} ${choice.prompt}`);
  return [
    /^(追查|调查|寻找|收集|整理|推进|深化|面对|探索|观察)(?:线索|真相|剧情|关系|情绪|内心|环境)?$/,
    /(?:推进剧情|深入内心|追查线索|调查真相|继续探索|面对关键人物|做出选择)/,
    /^(选项|路线|方向|分支)[一二三四1234]/,
  ].some((pattern) => pattern.test(text));
}

function hasAuthorNote(text) {
  const normalized = normalizeWhitespace(text);
  return [
    /^(接下来|下一步|后续|本轮|这一轮|这一段|本段)(?:的)?(?:剧情|故事|叙事|场景|内容|走向|分支|节拍)?(?:会|将|应该|需要|可以|要)/,
    /^(剧情|故事|叙事|场景|分支|节拍)(?:走向|安排|设计|说明|分析|总结|规划|目标|方向)/,
    /^(作者|编剧|导演|系统|旁白)(?:说明|提示|分析|安排|规划)/,
    /^(选择后|用户选择后)(?:剧情|故事|叙事|场景)?(?:会|将|应该|需要)/,
  ].some((pattern) => pattern.test(normalized));
}

function selectedChoiceAnchors(choice) {
  const text = normalizeWhitespace(`${choice?.label || ''} ${choice?.prompt || ''}`);
  const domainAnchors = text.match(/名单|钥匙|血迹|档案室|袖口|停电|失踪|门锁|走廊|医院|推开|交出|追问|逼问|检查/g) || [];
  const phraseAnchors = (text.match(/[\u4e00-\u9fa5]{2,}/g) || [])
    .filter((token) => !['让林医生', '林医生', '护士', '主角', '立刻', '先', '再'].includes(token))
    .filter((token) => token.length >= 2)
    .sort((left, right) => right.length - left.length);
  return Array.from(new Set([...domainAnchors, ...phraseAnchors]))
    .slice(0, 8);
}

function normalizeEvents(value) {
  if (!Array.isArray(value)) return [];
  const events = [];
  for (const raw of value.slice(0, 12)) {
    if (!raw || typeof raw !== 'object') continue;
    if (raw.type === 'narration') {
      const text = clip(raw.text, 1600);
      if (text) events.push({ type: 'narration', text });
      continue;
    }
    if (raw.type === 'speech') {
      const text = clip(raw.text, 600);
      const characterId = clip(raw.characterId || raw.actorId, 80);
      const speakerName = clip(raw.speakerName || raw.actorName, 80);
      if (text && (characterId || speakerName)) events.push({ type: 'speech', characterId: characterId || undefined, speakerName: speakerName || undefined, text });
      continue;
    }
    if (raw.type === 'choice_point') {
      const choices = Array.isArray(raw.choices) ? raw.choices.map(normalizeChoice).filter(Boolean).slice(0, 4) : [];
      if (choices.length >= 2) events.push({ type: 'choice_point', choices });
    }
  }
  return events;
}

function visibleText(events) {
  return events
    .filter((event) => event.type === 'narration' || event.type === 'speech')
    .map((event) => event.text)
    .join(' ');
}

function evaluateQuality(events) {
  const text = visibleText(events);
  const narrationCount = events.filter((event) => event.type === 'narration').length;
  const speechCount = events.filter((event) => event.type === 'speech').length;
  const choices = events.flatMap((event) => event.type === 'choice_point' ? event.choices : []);
  const concreteSignals = countMatches(text, /(门|窗|雨|血|灯|脚步|钥匙|名单|病历|档案|信|照片|袖口|走廊|房间|医院|妆台|院子|声音|气味|手指|眼神|伤口|锁)/g);
  const hookSignals = countMatches(text, /(为什么|谁|哪里|真相|秘密|隐瞒|失踪|异常|危险|威胁|暴露|怀疑|背叛|来不及|脚步声|敲击声|血迹|停电|名单|钥匙|代价|风险)/g);
  const relationshipSignals = countMatches(text, /(信任|怀疑|保护|试探|逼问|沉默|拒绝|靠近|远离|隐瞒|背叛|动摇|警觉|害怕|犹豫)/g);
  const labels = [
    narrationCount > 0 ? 'has_narration' : '',
    speechCount > 0 ? 'has_speech' : '',
    choices.length >= 2 ? 'has_choice_point' : '',
    concreteSignals >= 2 ? 'concrete_scene' : '',
    hookSignals > 0 ? 'has_story_hook' : '',
    relationshipSignals > 0 ? 'has_relationship_pressure' : '',
    choices.length >= 2 && choices.every((choice) => choice.risk && choice.reward) ? 'choices_have_tradeoffs' : '',
  ].filter(Boolean);
  const gaps = [
    narrationCount > 0 ? '' : 'missing_narration',
    !text || concreteSignals >= 2 ? '' : 'weak_concrete_scene',
    hookSignals > 0 ? '' : 'missing_story_hook',
    speechCount > 0 ? '' : 'no_character_speech',
    choices.length && choices.length < 2 ? 'too_few_choices' : '',
    choices.length >= 2 && choices.some((choice) => !choice.risk || !choice.reward) ? 'choice_tradeoff_missing' : '',
  ].filter(Boolean);
  const score = Math.max(0, Math.min(100, Math.round(
    (narrationCount > 0 ? 20 : 0)
    + (speechCount > 0 ? 12 : 0)
    + (concreteSignals >= 2 ? 22 : concreteSignals > 0 ? 10 : 0)
    + (hookSignals > 0 ? 18 : 0)
    + (relationshipSignals > 0 ? 10 : 0)
    + (choices.length >= 2 ? 10 : 0)
    + (choices.length >= 2 && choices.every((choice) => choice.risk && choice.reward) ? 8 : 0)
  )));
  return { score, labels, gaps, narrationCount, speechCount, choiceCount: choices.length };
}

function assertCondition(condition, message, detail) {
  if (!condition) {
    const suffix = detail ? `\n${JSON.stringify(detail, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

async function generateStoryEvents(messages) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(chatUrl(config.baseUrl), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.75,
        max_tokens: 1200,
        response_format: { type: 'json_object' },
        messages,
      }),
    });
    if (!response.ok) throw new Error(`LLM request failed: ${response.status} ${await response.text()}`);
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content || '';
    const parsed = parseJsonObject(content);
    return normalizeEvents(parsed.storyEvents || parsed.events);
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`LLM request timed out after ${config.timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildSystemPrompt() {
  return [
    '你是故事房叙事运行时的模型输出器。只输出 JSON，不要 Markdown。',
    'JSON schema: {"storyEvents":[{"type":"narration","text":"..."},{"type":"speech","characterId":"lin|nurse","text":"..."},{"type":"choice_point","choices":[{"label":"...","prompt":"...","intent":"...","risk":"...","reward":"..."}]}]}',
    'storyEvents 是唯一可见正文。旁白写外部动作、场景变化、后果和压力；角色台词只写角色能说出口的话。',
    '不要复述上一轮原句，不要输出作者说明、剧情规划、意图分析或“下一步将会”。',
    '抉择只在要求 choice_point 的轮次出现；每个选项必须是具体人物、地点、线索、威胁或目标上的行动。',
    '禁止抽象选项，例如“追查线索”“推进剧情”“深入内心”“面对关键人物”。',
  ].join('\n');
}

function buildUserPrompt(turn, transcript, selectedChoice) {
  const base = [
    '故事：雨夜旧医院。目标：查清旧医院停电和失踪名单的真相。',
    '角色：lin=林医生，nurse=护士。',
    '已发生正文：',
    transcript.length ? transcript.slice(-4).map((item, index) => `${index + 1}. ${item}`).join('\n') : '无',
  ];
  if (selectedChoice) base.push(`用户刚才选择：${selectedChoice.label}。必须把这个选择当作正史兑现，不能写未选分支已经发生。`);
  base.push('连续性资产：当前地点=旧医院走廊；线索=新鲜血迹、铜钥匙、被雨水洇开的名单；压力=护士隐瞒停电时档案室有人进入；未解问题=失踪名单少了谁。');
  const policy = {
    establish: '本轮是开场 establish。禁止 choice_point。开头必须在走廊现场，有具体物件/声音/动作，并至少一条角色台词。',
    pressure: '本轮是 pressure。禁止 choice_point。继续制造可见压力，给出新线索或关系裂缝，并至少一条角色台词。',
    decision: '本轮是 decision。必须输出 exactly one choice_point，包含 2-4 个具体选项。choice_point 前必须先有旁白或台词把压力推到抉择点。',
    consequence: '本轮是 consequence。禁止 choice_point。兑现用户选择，写出具体收益、代价、关系变化或新危险，并至少一条角色台词。',
  }[turn];
  return [...base, `要求：${policy}`].join('\n\n');
}

async function main() {
  const transcript = [];
  const summaries = [];
  const messages = [{ role: 'system', content: buildSystemPrompt() }];
  let selectedChoice = null;

  for (const turn of ['establish', 'pressure', 'decision']) {
    messages.push({ role: 'user', content: buildUserPrompt(turn, transcript, selectedChoice) });
    const events = await generateStoryEvents(messages);
    const text = visibleText(events);
    const quality = evaluateQuality(events);
    const choices = events.flatMap((event) => event.type === 'choice_point' ? event.choices : []);
    assertCondition(quality.score >= (turn === 'decision' ? 82 : 72), `Quality score too low on ${turn}`, { quality, events });
    assertCondition(turn === 'decision' ? choices.length >= 2 : choices.length === 0, `Unexpected choice policy result on ${turn}`, { choiceCount: choices.length, events });
    assertCondition(!hasAuthorNote(text), `Author note leaked into visible story text on ${turn}`, { text, events });
    assertCondition(choices.every((choice) => !isAbstractChoice(choice)), `Abstract story choice leaked on ${turn}`, { choices });
    for (const previous of transcript) {
      assertCondition(textSimilarity(text, previous) < 0.72, `Near-duplicate story text on ${turn}`, { text, previous, similarity: textSimilarity(text, previous) });
    }
    transcript.push(text);
    messages.push({ role: 'assistant', content: JSON.stringify({ storyEvents: events }) });
    summaries.push({ turn, quality, choiceCount: choices.length, sample: text.slice(0, 120) });
    if (turn === 'decision') {
      selectedChoice = choices[0];
      assertCondition(selectedChoice?.label && selectedChoice?.risk && selectedChoice?.reward, 'Decision choice lacks tradeoff metadata for runtime diagnostics', { selectedChoice });
    }
  }

  messages.push({ role: 'user', content: buildUserPrompt('consequence', transcript, selectedChoice) });
  const consequenceEvents = await generateStoryEvents(messages);
  const consequenceText = visibleText(consequenceEvents);
  const consequenceQuality = evaluateQuality(consequenceEvents);
  const consequenceChoices = consequenceEvents.flatMap((event) => event.type === 'choice_point' ? event.choices : []);
  assertCondition(consequenceQuality.score >= 72, 'Quality score too low on consequence', { quality: consequenceQuality, consequenceEvents });
  assertCondition(consequenceChoices.length === 0, 'Consequence turn must not reopen choices immediately', { consequenceChoices, consequenceEvents });
  assertCondition(!hasAuthorNote(consequenceText), 'Author note leaked into consequence visible story text', { consequenceText, consequenceEvents });
  assertCondition(textSimilarity(consequenceText, transcript.at(-1) || '') < 0.72, 'Consequence repeated the decision setup instead of resolving it', { consequenceText, previous: transcript.at(-1) });
  const anchors = selectedChoiceAnchors(selectedChoice);
  const normalizedConsequence = normalizeRepeatText(consequenceText);
  assertCondition(!anchors.length || anchors.some((anchor) => normalizedConsequence.includes(normalizeRepeatText(anchor))), 'Consequence did not visibly connect to the selected branch', { selectedChoice, anchors, consequenceText });
  summaries.push({ turn: 'consequence', quality: consequenceQuality, choiceCount: consequenceChoices.length, sample: consequenceText.slice(0, 120) });

  console.log(JSON.stringify({
    ok: true,
    model: config.model,
    baseUrl: config.baseUrl.replace(/\/\/[^/@]+@/, '//***@'),
    selectedChoice: selectedChoice?.label,
    turns: summaries,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
