import type { GroupChat, ConversationConflictAxis } from '../types/chat';

const AXIS_DECAY_STEP = 8;
const AXIS_DISPLAY_THRESHOLD = 12;

function clampTilt(value: number) {
  return Math.max(-100, Math.min(100, Math.round(value)));
}

function relaxTilt(value: number) {
  if (Math.abs(value) <= AXIS_DECAY_STEP) return 0;
  return value > 0 ? value - AXIS_DECAY_STEP : value + AXIS_DECAY_STEP;
}

function isMeaningfulTilt(value: number | undefined) {
  return Math.abs(value || 0) >= AXIS_DISPLAY_THRESHOLD;
}

function formatAxisSummary(axis: ConversationConflictAxis) {
  if (!isMeaningfulTilt(axis.currentTilt)) return null;
  return `${axis.title} ${(axis.currentTilt || 0) > 0 ? axis.poles[0] : axis.poles[1]}`;
}

function detectIdentityOwnershipSpike(text: string) {
  const ownershipClaim = /(我儿子|我家|我老婆|我老公|我对象|我的人|我们家的|咱家的)/.test(text);
  const authorityChallenge = /(轮不到|关你什么事|谁说的|谁准你|还得你批准|少插嘴|你算谁|凭什么)/.test(text);
  const mirroredClaim = /(就是|说得对).*(我儿子|我家|咱家的)/.test(text);
  return ownershipClaim && (authorityChallenge || mirroredClaim);
}

function detectContradictionSpike(text: string) {
  return /(前后矛盾|你刚才还|不是.*又|怎么又|到底谁|谁才是|明明是|凭什么说是你的|关你什么事)/.test(text);
}

function readAxisDelta(axis: ConversationConflictAxis, text: string, identitySpike: boolean, contradictionSpike: boolean) {
  if (axis.title === '归属/身份冲突') {
    let delta = 0;
    if (identitySpike) delta -= 26;
    if (contradictionSpike) delta -= 18;
    return delta;
  }

  let delta = 0;
  if (/反对|攻击|质疑|不行|wrong|hate|terrible|失败|荒谬/.test(text)) delta -= 14;
  if (/支持|同意|喜欢|欣赏|great|agree|love|太好了/.test(text)) delta += 10;
  if (/但是|不过|可是|然而|actually|but|however/.test(text)) delta -= 6;
  if (contradictionSpike) delta -= 10;
  return delta;
}

export function createDefaultConflictAxes(chat: Pick<GroupChat, 'topic' | 'style' | 'dramaRules'>): ConversationConflictAxis[] {
  const axes: ConversationConflictAxis[] = [];
  if (chat.style === 'debate') {
    axes.push({ title: '立场冲突', poles: ['支持', '反对'], currentTilt: 0 });
  }
  if (chat.style === 'brainstorm') {
    axes.push({ title: '方法冲突', poles: ['发散创意', '收敛执行'], currentTilt: 10 });
  }
  axes.push({ title: '归属/身份冲突', poles: ['默认认同', '公开争夺'], currentTilt: 0 });
  if (chat.dramaRules.allowCliques) {
    axes.push({ title: '群体关系', poles: ['结盟', '拆台'], currentTilt: 0 });
  }
  if (chat.dramaRules.allowMockery || chat.dramaRules.allowContempt) {
    axes.push({ title: '表达风格', poles: ['克制', '尖锐'], currentTilt: 20 });
  }
  return axes;
}

export function evolveConflictAxes(chat: GroupChat, messageContent: string) {
  const axes = (chat.worldState.conflictAxes || []).length ? (chat.worldState.conflictAxes || []) : createDefaultConflictAxes(chat);
  const text = messageContent.toLowerCase();
  const identitySpike = detectIdentityOwnershipSpike(text);
  const contradictionSpike = detectContradictionSpike(text);
  return axes.map((axis) => ({
    ...axis,
    currentTilt: clampTilt(relaxTilt(axis.currentTilt || 0) + readAxisDelta(axis, text, identitySpike, contradictionSpike)),
  }));
}

export function summarizeConflictAxes(axes: ConversationConflictAxis[]) {
  return axes
    .slice()
    .sort((a, b) => Math.abs(b.currentTilt || 0) - Math.abs(a.currentTilt || 0))
    .map(formatAxisSummary)
    .filter((value): value is string => Boolean(value))
    .slice(0, 2)
    .join('；');
}

export function getConflictAxesPriority(axes: ConversationConflictAxis[]) {
  return axes.slice().sort((a, b) => Math.abs(b.currentTilt || 0) - Math.abs(a.currentTilt || 0));
}

export function getConflictAxesSummaryLines(axes: ConversationConflictAxis[]) {
  return getConflictAxesPriority(axes)
    .map(formatAxisSummary)
    .filter((value): value is string => Boolean(value))
    .slice(0, 2);
}

export function getConflictAxesNarrative(axes: ConversationConflictAxis[]) {
  return getConflictAxesSummaryLines(axes).join('；');
}

export function getConflictAxesTopSummary(axes: ConversationConflictAxis[]) {
  return summarizeConflictAxes(axes);
}
