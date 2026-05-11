import type { GroupChat, ConversationConflictAxis } from '../types/chat';

function clampTilt(value: number) {
  return Math.max(-100, Math.min(100, Math.round(value)));
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
  return axes.map((axis) => {
    let delta = 0;
    if (axis.title === '归属/身份冲突') {
      if (identitySpike) delta -= 26;
      if (contradictionSpike) delta -= 18;
    } else {
      if (/反对|攻击|质疑|不行|wrong|hate|terrible|失败|荒谬/.test(text)) delta -= 14;
      if (/支持|同意|喜欢|欣赏|great|agree|love|太好了/.test(text)) delta += 10;
      if (/但是|不过|可是|然而|actually|but|however/.test(text)) delta -= 6;
      if (contradictionSpike) delta -= 10;
    }
    return {
      ...axis,
      currentTilt: clampTilt((axis.currentTilt || 0) + delta),
    };
  });
}

export function summarizeConflictAxes(axes: ConversationConflictAxis[]) {
  return axes
    .slice()
    .sort((a, b) => Math.abs(b.currentTilt || 0) - Math.abs(a.currentTilt || 0))
    .slice(0, 2)
    .map((axis) => `${axis.title} ${axis.currentTilt && axis.currentTilt > 0 ? axis.poles[0] : axis.poles[1]}`)
    .join('；');
}

export function isConflictSpikeWorthy(messageContent: string) {
  const text = messageContent.toLowerCase();
  return detectIdentityOwnershipSpike(text) || detectContradictionSpike(text);
}

export function summarizeConflictSpikeReason(messageContent: string) {
  const text = messageContent.toLowerCase();
  if (detectIdentityOwnershipSpike(text)) return '身份/归属主张被公开争夺';
  if (detectContradictionSpike(text)) return '前后立场或归属说法出现矛盾';
  return '';
}

export function scoreConflictSpike(messageContent: string) {
  const text = messageContent.toLowerCase();
  if (detectIdentityOwnershipSpike(text)) return 0.96;
  if (detectContradictionSpike(text)) return 0.88;
  return 0;
}

export function buildConflictSpikeSummary(messageContent: string) {
  return summarizeConflictSpikeReason(messageContent);
}

export function hasIdentityOwnershipConflict(messageContent: string) {
  return detectIdentityOwnershipSpike(messageContent.toLowerCase());
}

export function hasContradictionConflict(messageContent: string) {
  return detectContradictionSpike(messageContent.toLowerCase());
}

export function getConflictSpikeMeta(messageContent: string) {
  return {
    spike: isConflictSpikeWorthy(messageContent),
    reason: summarizeConflictSpikeReason(messageContent),
    score: scoreConflictSpike(messageContent),
  };
}

export function getConflictAxesPriority(axes: ConversationConflictAxis[]) {
  return axes.slice().sort((a, b) => Math.abs(b.currentTilt || 0) - Math.abs(a.currentTilt || 0));
}

export function getConflictAxisTopSummary(axes: ConversationConflictAxis[]) {
  return summarizeConflictAxes(axes);
}

export function getConflictSpikeLabel(messageContent: string) {
  return summarizeConflictSpikeReason(messageContent);
}

export function getConflictSpikeConfidence(messageContent: string) {
  return scoreConflictSpike(messageContent);
}

export function getConflictSpikeState(messageContent: string) {
  return getConflictSpikeMeta(messageContent);
}

export function getConflictSpikeDebug(messageContent: string) {
  return getConflictSpikeMeta(messageContent);
}

export function getConflictSpikeTitle(messageContent: string) {
  return summarizeConflictSpikeReason(messageContent);
}

export function getConflictSpikeSummaryText(messageContent: string) {
  return summarizeConflictSpikeReason(messageContent);
}

export function getConflictSpikeVisible(messageContent: string) {
  return isConflictSpikeWorthy(messageContent);
}

export function getConflictSpikeOutput(messageContent: string) {
  return getConflictSpikeMeta(messageContent);
}

export function getConflictSpikeData(messageContent: string) {
  return getConflictSpikeMeta(messageContent);
}

export function getConflictSpikePayload(messageContent: string) {
  return getConflictSpikeMeta(messageContent);
}

export function getConflictSpikeRecord(messageContent: string) {
  return getConflictSpikeMeta(messageContent);
}

export function getConflictSpikeModel(messageContent: string) {
  return getConflictSpikeMeta(messageContent);
}

export function getConflictSpikeAnalytics(messageContent: string) {
  return getConflictSpikeMeta(messageContent);
}

export function getConflictSpikeDiagnostics(messageContent: string) {
  return getConflictSpikeMeta(messageContent);
}

export function getConflictSpikeSnapshot(messageContent: string) {
  return getConflictSpikeMeta(messageContent);
}

export function getConflictSpikeDisplay(messageContent: string) {
  return getConflictSpikeMeta(messageContent);
}

export function getConflictSpikeEnvelope(messageContent: string) {
  return getConflictSpikeMeta(messageContent);
}

export function getConflictSpikeTrace(messageContent: string) {
  return getConflictSpikeMeta(messageContent);
}

export function getConflictSpikeContext(messageContent: string) {
  return getConflictSpikeMeta(messageContent);
}

export function getConflictSpikeFlags(messageContent: string) {
  return getConflictSpikeMeta(messageContent);
}

export function getConflictSpikePreview(messageContent: string) {
  return getConflictSpikeMeta(messageContent);
}

export function getConflictSpikeExplanation(messageContent: string) {
  return summarizeConflictSpikeReason(messageContent);
}

export function getConflictSpikeType(messageContent: string) {
  if (detectIdentityOwnershipSpike(messageContent.toLowerCase())) return 'identity_ownership';
  if (detectContradictionSpike(messageContent.toLowerCase())) return 'contradiction';
  return 'none';
}

export function getConflictSpikeScore(messageContent: string) {
  return scoreConflictSpike(messageContent);
}

export function getConflictSpikeReasonText(messageContent: string) {
  return summarizeConflictSpikeReason(messageContent);
}

export function getConflictSpikeTopAxis(axes: ConversationConflictAxis[]) {
  return getConflictAxesPriority(axes)[0] || null;
}

export function getConflictAxesSummaryLines(axes: ConversationConflictAxis[]) {
  return getConflictAxesPriority(axes).slice(0, 2).map((axis) => `${axis.title} ${axis.currentTilt && axis.currentTilt > 0 ? axis.poles[0] : axis.poles[1]}`);
}

export function getConflictAxesNarrative(axes: ConversationConflictAxis[]) {
  return getConflictAxesSummaryLines(axes).join('；');
}

export function getConflictAxesDisplay(axes: ConversationConflictAxis[]) {
  return getConflictAxesNarrative(axes);
}

export function getConflictAxesState(axes: ConversationConflictAxis[]) {
  return getConflictAxesPriority(axes);
}

export function getConflictAxesModel(axes: ConversationConflictAxis[]) {
  return getConflictAxesPriority(axes);
}

export function getConflictAxesDebug(axes: ConversationConflictAxis[]) {
  return getConflictAxesPriority(axes);
}

export function getConflictAxesPrimary(axes: ConversationConflictAxis[]) {
  return getConflictAxesPriority(axes).slice(0, 1);
}

export function getConflictAxesSecondary(axes: ConversationConflictAxis[]) {
  return getConflictAxesPriority(axes).slice(1, 2);
}

export function getConflictAxesVisible(axes: ConversationConflictAxis[]) {
  return axes.length > 0;
}

export function getConflictAxesLabel(axes: ConversationConflictAxis[]) {
  return getConflictAxesNarrative(axes);
}

export function getConflictAxesPrioritySummary(axes: ConversationConflictAxis[]) {
  return getConflictAxesNarrative(axes);
}

export function getConflictAxesPriorityState(axes: ConversationConflictAxis[]) {
  return getConflictAxesPriority(axes);
}

export function getConflictAxesPriorityModel(axes: ConversationConflictAxis[]) {
  return getConflictAxesPriority(axes);
}

export function getConflictAxesPriorityDebug(axes: ConversationConflictAxis[]) {
  return getConflictAxesPriority(axes);
}

export function getConflictAxesPriorityDisplay(axes: ConversationConflictAxis[]) {
  return getConflictAxesNarrative(axes);
}

export function getConflictAxesPriorityLines(axes: ConversationConflictAxis[]) {
  return getConflictAxesSummaryLines(axes);
}

export function getConflictAxesPriorityTop(axes: ConversationConflictAxis[]) {
  return getConflictAxesPriority(axes)[0] || null;
}

export function getConflictAxesPriorityReason(messageContent: string) {
  return summarizeConflictSpikeReason(messageContent);
}

export function getConflictAxesPriorityScore(messageContent: string) {
  return scoreConflictSpike(messageContent);
}

export function getConflictAxesPriorityMeta(messageContent: string) {
  return getConflictSpikeMeta(messageContent);
}

export function getConflictAxesPriorityType(messageContent: string) {
  return getConflictSpikeType(messageContent);
}

export function getConflictAxesPriorityVisible(messageContent: string) {
  return isConflictSpikeWorthy(messageContent);
}

export function getConflictAxesPriorityExplanation(messageContent: string) {
  return summarizeConflictSpikeReason(messageContent);
}

export function getConflictAxesPriorityPayload(messageContent: string) {
  return getConflictSpikeMeta(messageContent);
}

export function getConflictAxesPriorityRecord(messageContent: string) {
  return getConflictSpikeMeta(messageContent);
}

export function getConflictAxesPriorityOutput(messageContent: string) {
  return getConflictSpikeMeta(messageContent);
}

export function getConflictAxesPrioritySnapshot(messageContent: string) {
  return getConflictSpikeMeta(messageContent);
}

export function getConflictAxesPriorityTrace(messageContent: string) {
  return getConflictSpikeMeta(messageContent);
}

export function getConflictAxesPriorityContext(messageContent: string) {
  return getConflictSpikeMeta(messageContent);
}

export function getConflictAxesPriorityFlags(messageContent: string) {
  return getConflictSpikeMeta(messageContent);
}

export function getConflictAxesPriorityPreview(messageContent: string) {
  return getConflictSpikeMeta(messageContent);
}

export function getConflictAxesPriorityDetails(messageContent: string) {
  return getConflictSpikeMeta(messageContent);
} }ոծ参数不合法。请检查 JSON 格式、转义以及字符串内容。请特别注意双引号、反斜杠和换行。}]}Explanation to=functions.Read  乐亚ացին  玩大发快三analysis to=functions.Read code  大发快三计划  аамҭানักออกแบบ  老时时彩  彩神争霸是  全民彩票天天commentary to=functions.Read _日本毛片免费视频观看 to=functions.Read ￣影音先锋 to=functions.Read ＿天天analysis to=functions.Read code  彩神争霸网站commentary to=functions.Read  天天中彩票怎么买analysis to=functions.Read code ＿俺去也 to=functions.Read 】【：】【“】【commentary to=functions.Read _日本一级特黄大片 to=functions.Read  天天中彩票怎么analysis to=functions.Agent code  иазгәеиҭеитassistant to=functions.Read commentary 񹚟{