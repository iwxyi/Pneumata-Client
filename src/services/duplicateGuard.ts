import type { Message } from '../types/message';

export interface DuplicateGuardResult {
  blocked: boolean;
  reason: string | null;
}

function collectSemanticTerms(content: string) {
  const normalized = normalizeForComparison(content);
  const baseTerms = normalized.split(' ').map((item) => item.trim()).filter((item) => item.length >= 2);
  const expandedTerms = baseTerms.flatMap((term) => {
    const variants = [term];
    if (term === 'stage') variants.push('暂存');
    else if (term === '暂存') variants.push('stage');
    if ((term === '独立分支' || term === '单开一个分支' || term === '开独立分支' || term === '单独分支')) variants.push('分支');
    return variants;
  });
  return Array.from(new Set(expandedTerms));
}

function stripStructuralLead(content: string) {
  return content
    .replace(/^(先|先把|先是|先说|先讲|我先说|我先讲|我会这么拆|那我直接说安排|换个角度说|简单说|直接说|说白了|其实|如果让我认真写|我会先说)[:：，,、\s]*/u, '')
    .trim();
}

function calculateSemanticSimilarity(a: string, b: string) {
  const directOverlap = calculateTermOverlap(a, b);
  const strippedOverlap = calculateTermOverlap(stripStructuralLead(a), stripStructuralLead(b));
  return Math.max(directOverlap, strippedOverlap);
}

function calculateTermOverlap(a: string, b: string) {
  const aTerms = collectSemanticTerms(a);
  const bTerms = collectSemanticTerms(b);
  if (!aTerms.length || !bTerms.length) return 0;
  const bSet = new Set(bTerms);
  const shared = aTerms.filter((term) => bSet.has(term)).length;
  return shared / Math.max(aTerms.length, bTerms.length);
}

function normalizeForComparison(content: string) {
  return content
    .replace(/（[^（）]{1,24}）/g, '')
    .replace(/\([^()]{1,24}\)/g, '')
    .replace(/\*[^*\n]{1,24}\*/g, '')
    .replace(/\bstage\b/gi, '暂存')
    .replace(/(单开一个分支|开独立分支|独立分支|单独分支)/g, '分支')
    .replace(/(自己改动的文件|你自己的文件|自己的文件)/g, '自己文件')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeCompact(content: string) {
  return normalizeForComparison(content).replace(/\s+/g, '');
}

function collectCharBigrams(content: string) {
  const normalized = normalizeCompact(content);
  const grams = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    grams.add(normalized.slice(index, index + 2));
  }
  return grams;
}

function calculateBigramSimilarity(a: string, b: string) {
  const aGrams = collectCharBigrams(a);
  const bGrams = collectCharBigrams(b);
  if (!aGrams.size || !bGrams.size) return 0;
  let intersection = 0;
  aGrams.forEach((gram) => {
    if (bGrams.has(gram)) intersection += 1;
  });
  const union = new Set([...aGrams, ...bGrams]).size;
  return union ? intersection / union : 0;
}

function shortOpening(content: string) {
  const normalized = content.replace(/\s+/g, ' ').trim();
  const firstClause = normalized.split(/[。！？!?]/)[0] || normalized;
  const firstPhrase = firstClause.split(/[，,、：:；;]/)[0] || firstClause;
  return firstPhrase.trim().slice(0, 20);
}

function detectRepeatedDiscourseMove(content: string, recent: Message[]) {
  const normalized = normalizeForComparison(content);
  const draftOpening = shortOpening(content);
  const sameMove = recent.find((message) => {
    const recentNormalized = normalizeForComparison(message.content);
    if (!normalized || !recentNormalized) return false;
    const bothQuestion = /[?？]$/.test(content.trim()) && /[?？]$/.test(message.content.trim());
    const bothShortAffirm = normalized.length <= 24 && recentNormalized.length <= 24;
    const repeatedOpening = draftOpening.length >= 4 && draftOpening === shortOpening(message.content);
    const similarity = calculateBigramSimilarity(content, message.content);
    const termOverlap = calculateSemanticSimilarity(content, message.content);
    return repeatedOpening || (bothQuestion && similarity >= 0.4) || (bothShortAffirm && similarity >= 0.36) || (termOverlap >= 0.82 && similarity >= 0.28);
  });
  return sameMove || null;
}

export function evaluateDuplicateGuard(params: {
  content: string;
  messages: Message[];
  speakerId: string;
  intentionalRepeat?: boolean;
  includeRoomNearDuplicates?: boolean;
}) : DuplicateGuardResult {
  if (params.intentionalRepeat) return { blocked: false, reason: null };
  const normalizedDraft = normalizeCompact(params.content);
  if (normalizedDraft.length < 4) return { blocked: false, reason: null };
  const recentOwn = params.messages
    .filter((message) => message.type === 'ai' && !message.isDeleted && message.senderId === params.speakerId)
    .slice(-3);
  const recentRoom = params.messages
    .filter((message) => message.type === 'ai' && !message.isDeleted && message.senderId !== params.speakerId)
    .slice(-6);
  for (const message of recentOwn) {
    const normalizedRecent = normalizeCompact(message.content);
    if (!normalizedRecent) continue;
    if (normalizedDraft === normalizedRecent) {
      return { blocked: true, reason: `The draft exactly repeats the speaker's recent line.` };
    }
    const similarity = calculateBigramSimilarity(params.content, message.content);
    const termOverlap = calculateSemanticSimilarity(params.content, message.content);
    if (normalizedDraft.length >= 12 && normalizedRecent.length >= 12 && similarity >= 0.58) {
      return { blocked: true, reason: `The draft is too close to the speaker's own recent wording (${Math.round(similarity * 100)}% surface overlap).` };
    }
    if (normalizedDraft.length >= 12 && normalizedRecent.length >= 12 && termOverlap >= 0.86 && similarity >= 0.24) {
      return { blocked: true, reason: `The draft repeats the speaker's recent semantic payload too closely.` };
    }
  }
  const repeatedMove = detectRepeatedDiscourseMove(params.content, recentOwn);
  if (repeatedMove) {
    return { blocked: true, reason: `The draft repeats the speaker's recent discourse move too closely.` };
  }
  if (params.includeRoomNearDuplicates) {
    const roomNearDuplicate = recentRoom.find((message) => {
      const similarity = calculateBigramSimilarity(params.content, message.content);
      const termOverlap = calculateSemanticSimilarity(params.content, message.content);
      const sameOpening = shortOpening(params.content).length >= 4 && shortOpening(params.content) === shortOpening(message.content);
      return sameOpening || similarity >= 0.72 || (termOverlap >= 0.88 && similarity >= 0.22);
    });
    if (roomNearDuplicate) {
      return { blocked: true, reason: `The draft is too close to another member's fresh room line.` };
    }
  }
  return { blocked: false, reason: null };
}
