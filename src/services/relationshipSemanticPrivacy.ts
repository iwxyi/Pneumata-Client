import type { RelationshipLedgerEntry } from '../types/runtimeEvent';

export function hasPrivateRelationshipSemanticRisk(text: string | undefined | null) {
  return /(不要|不想|别|公开|隐私|边界|禁忌|压力|焦虑|面试|考试|生日|纪念|私下|只告诉|秘密|暗号|住址|地址|电话|手机号|微信|QQ|生病|不舒服|失眠|抑郁|创伤|计划|下周|明天|今晚|昨晚|约定|承诺|称呼)/.test(text || '');
}

export function buildPublicSafeRelationshipSemanticSummary(
  entry: RelationshipLedgerEntry,
  cleanText: (text: string | undefined | null, max?: number) => string,
) {
  const semantic = entry.derived?.semantic;
  if (!semantic) return '';
  const summary = cleanText(semantic.summary, 220);
  if (summary && !hasPrivateRelationshipSemanticRisk(summary)) return summary;
  const stage = !hasPrivateRelationshipSemanticRisk(semantic.stage) ? cleanText(semantic.stage, 60) : '';
  const labels = (semantic.labels || [])
    .filter((label) => !hasPrivateRelationshipSemanticRisk(label))
    .map((label) => cleanText(label, 32))
    .filter(Boolean)
    .slice(0, 3);
  const parts = [stage, labels.length ? labels.join('、') : ''].filter(Boolean);
  if (parts.length) return parts.join('：');
  return semantic.intensity >= 45 ? '存在私下关系连续性' : '存在私下关系痕迹';
}
