function isZh(language: string) {
  return language.startsWith('zh');
}

function humanizeUnknownId(value: string, language: string) {
  const compact = value.trim();
  if (!compact) return isZh(language) ? '角色位' : 'Role';
  if (isZh(language)) return '自定义角色';
  return compact
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatScenarioRoleLabel(roleId: string | null | undefined, language = 'zh') {
  const key = String(roleId || '').trim();
  const labels: Record<string, { zh: string; en: string }> = {
    interviewer: { zh: '面试官', en: 'Interviewer' },
    candidate: { zh: '候选人', en: 'Candidate' },
    werewolf: { zh: '狼人', en: 'Werewolf' },
    villager: { zh: '村民', en: 'Villager' },
    seer: { zh: '预言家', en: 'Seer' },
    moderator: { zh: '主持人', en: 'Moderator' },
    judge: { zh: '裁判', en: 'Judge' },
    leader: { zh: '领队', en: 'Leader' },
  };
  if (!key) return isZh(language) ? '角色位' : 'Role';
  const label = labels[key];
  return label ? (isZh(language) ? label.zh : label.en) : humanizeUnknownId(key, language);
}

export function formatScenarioBoardKind(kind: string | null | undefined, language = 'zh') {
  const key = String(kind || '').trim();
  const labels: Record<string, { zh: string; en: string }> = {
    grid: { zh: '网格棋盘', en: 'Grid board' },
    gomoku: { zh: '五子棋盘', en: 'Gomoku board' },
    chess: { zh: '棋盘', en: 'Chess board' },
  };
  if (!key) return isZh(language) ? '棋盘' : 'Board';
  const label = labels[key];
  if (label) return isZh(language) ? label.zh : label.en;
  return isZh(language) ? '自定义棋盘' : humanizeUnknownId(key, language);
}
