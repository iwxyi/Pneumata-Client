import type { AICharacter } from '../types/character';
import { summarizeExpressionFeedbackInfluence } from './expressionFeedbackInfluence';
import { formatInnerImpulseLabel, formatSoulMetricLabel } from './runtimeDecisionLabels';

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

function buildDebugHint(member: AICharacter, language: string) {
  const soul = member.soulState;
  if (!soul) return '';
  return [
    ['energy', soul.energy],
    ['attention', soul.attention],
    ['loneliness', soul.loneliness],
    ['repression', soul.repression],
    ['shame', soul.shame],
    ['envy', soul.envy],
    ['trustInRoom', soul.trustInRoom],
    ['ignoredStreak', soul.ignoredStreak],
  ].map(([label, value]) => `${formatSoulMetricLabel(String(label), language)} ${Math.round(Number(value) || 0)}`).join(' / ');
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
  const title = chips[0]?.label || formatInnerImpulseLabel(soul.lastImpulse, language, 'member');
  const fallbackText = isZh
    ? '最近互动还没有留下特别清晰的内心余波。'
    : 'Recent interactions have not left a strong inner residue yet.';
  const text = soul.lastImpulseReason || chips[0]?.hint || fallbackText;
  return {
    title,
    text,
    chips: chips.length ? chips : [{
      label: formatInnerImpulseLabel(soul.lastImpulse, language, 'member'),
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
