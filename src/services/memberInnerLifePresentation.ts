import type { AICharacter } from '../types/character';
import { summarizeExpressionFeedbackInfluence } from './expressionFeedbackInfluence';

export interface MemberInnerLifeChip {
  label: string;
  hint: string;
  color: 'default' | 'primary' | 'secondary' | 'warning' | 'info';
}

export interface MemberInnerLifeSummary {
  title: string;
  text: string;
  chips: MemberInnerLifeChip[];
  debugHint: string;
}

function formatImpulseLabel(impulse: string | undefined, isZh: boolean) {
  const zhLabels: Record<string, string> = {
    answer: '想回应',
    show_off: '想证明自己',
    defend_face: '在维护面子',
    seek_attention: '想被看见',
    comfort: '想接住别人',
    repair: '别扭找补',
    mock: '带点刺',
    avoid: '想躲开',
    change_topic: '想岔开话题',
    stay_silent: '暂时沉默',
    send_emoji: '想用表情带过',
    withdraw: '说了又想吞回去',
  };
  const enLabels: Record<string, string> = {
    answer: 'Wants to answer',
    show_off: 'Wants to prove themself',
    defend_face: 'Defending face',
    seek_attention: 'Wants notice',
    comfort: 'Wants to catch someone',
    repair: 'Awkward repair',
    mock: 'A little sharp',
    avoid: 'Wants to avoid',
    change_topic: 'Wants to deflect',
    stay_silent: 'Holding silence',
    send_emoji: 'Would rather use an emoji',
    withdraw: 'Wants to take it back',
  };
  if (!impulse) return isZh ? '内心未定' : 'Unsettled';
  return (isZh ? zhLabels : enLabels)[impulse] || impulse;
}

function buildDebugHint(member: AICharacter, language: string) {
  const soul = member.soulState;
  if (!soul) return '';
  const isZh = language.startsWith('zh');
  const pairs = isZh
    ? [
        ['能量', soul.energy],
        ['注意', soul.attention],
        ['被忽视感', soul.loneliness],
        ['压抑', soul.repression],
        ['面子风险', soul.shame],
        ['酸意', soul.envy],
        ['房间安全感', soul.trustInRoom],
        ['未被接住', soul.ignoredStreak],
      ]
    : [
        ['energy', soul.energy],
        ['attention', soul.attention],
        ['loneliness', soul.loneliness],
        ['repression', soul.repression],
        ['shame', soul.shame],
        ['envy', soul.envy],
        ['room trust', soul.trustInRoom],
        ['ignored streak', soul.ignoredStreak],
      ];
  return pairs.map(([label, value]) => `${label} ${Math.round(Number(value) || 0)}`).join(' / ');
}

export function buildMemberInnerLifeChips(member: AICharacter, language: string): MemberInnerLifeChip[] {
  const soul = member.soulState;
  if (!soul) return [];
  const isZh = language.startsWith('zh');
  const reason = soul.lastImpulseReason || (isZh ? '由最近发言、关系和回应情况推导。' : 'Projected from recent speech, relationships, and response traces.');
  const items: MemberInnerLifeChip[] = [];

  if (soul.lastImpulse === 'repair') {
    items.push({
      label: isZh ? '别扭找补' : 'Awkward repair',
      hint: isZh ? `前面的刺感留下了余波：${reason}` : reason,
      color: 'secondary',
    });
  }
  if (soul.lastImpulse === 'seek_attention' && (soul.ignoredStreak >= 2 || soul.loneliness >= 58)) {
    items.push({
      label: isZh ? '想被看见' : 'Wants notice',
      hint: isZh ? `最近发言没有被明显接住：${reason}` : reason,
      color: 'info',
    });
  }
  if (soul.lastImpulse === 'defend_face' || soul.shame >= 58) {
    items.push({
      label: isZh ? '有点防备' : 'Guarded',
      hint: isZh ? `面子风险或压抑感正在影响表达：${reason}` : reason,
      color: 'warning',
    });
  }
  if (soul.lastImpulse === 'comfort' && soul.trustInRoom >= 48) {
    items.push({
      label: isZh ? '想接住' : 'Wants to catch',
      hint: isZh ? `它仍然觉得这个房间有余地：${reason}` : reason,
      color: 'primary',
    });
  }
  if (soul.lastImpulse === 'mock' && soul.repression >= 42) {
    items.push({
      label: isZh ? '带点刺' : 'A little sharp',
      hint: isZh ? `关系张力或压着的话正在外溢：${reason}` : reason,
      color: 'warning',
    });
  }
  if (!items.length && soul.trustInRoom >= 62 && soul.loneliness < 45) {
    items.push({
      label: isZh ? '较放松' : 'At ease',
      hint: isZh ? '当前房间安全感较高，表达更容易留有余地。' : 'The room feels safe enough for softer expression.',
      color: 'primary',
    });
  }

  return items.slice(0, 2);
}

export function buildMemberInnerLifeSummary(member: AICharacter, language: string): MemberInnerLifeSummary | null {
  const soul = member.soulState;
  if (!soul) return null;
  const isZh = language.startsWith('zh');
  const chips = buildMemberInnerLifeChips(member, language);
  const title = chips[0]?.label || formatImpulseLabel(soul.lastImpulse, isZh);
  const fallbackText = isZh
    ? '最近互动还没有留下特别清晰的内心余波。'
    : 'Recent interactions have not left a strong inner residue yet.';
  const text = soul.lastImpulseReason || chips[0]?.hint || fallbackText;
  return {
    title,
    text,
    chips: chips.length ? chips : [{
      label: formatImpulseLabel(soul.lastImpulse, isZh),
      hint: text,
      color: 'default',
    }],
    debugHint: buildDebugHint(member, language),
  };
}

export function buildMemberExpressionFeedbackChips(member: AICharacter, language: string, showDebugDetails: boolean): MemberInnerLifeChip[] {
  const isZh = language.startsWith('zh');
  const signals = summarizeExpressionFeedbackInfluence(member.layeredMemories || [])
    .filter((signal) => signal.negativeCount > 0 && signal.strength > 0.08);
  if (!signals.length) return [];

  if (!showDebugDetails) {
    const strongest = signals[0];
    return [{
      label: isZh ? '表达在校准' : 'Expression tuning',
      hint: isZh
        ? `最近有人反馈过它的表达方式，系统会把这类反馈作为软记忆参考。当前最明显的是：${strongest.label}。`
        : `Recent expression feedback is being used as soft style memory. Strongest signal: ${strongest.label}.`,
      color: 'info',
    }];
  }

  return signals.slice(0, 2).map((signal) => ({
    label: `${signal.label} ${Math.round(signal.strength * 100)}%`,
    hint: isZh
      ? `表达反馈影响：负向 ${signal.negativeCount} 条，正向 ${signal.positiveCount} 条。只作为软约束，不会锁死角色说话。`
      : `Expression feedback influence: ${signal.negativeCount} negative, ${signal.positiveCount} positive. This is a soft constraint, not a hard style lock.`,
    color: signal.strength >= 0.45 ? 'warning' : 'info',
  }));
}
