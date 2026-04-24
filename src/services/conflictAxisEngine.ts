import type { GroupChat, ConversationConflictAxis } from '../types/chat';

function clampTilt(value: number) {
  return Math.max(-100, Math.min(100, Math.round(value)));
}

export function createDefaultConflictAxes(chat: Pick<GroupChat, 'topic' | 'style' | 'dramaRules'>): ConversationConflictAxis[] {
  const axes: ConversationConflictAxis[] = [];
  if (chat.style === 'debate') {
    axes.push({ title: '立场冲突', poles: ['支持', '反对'], currentTilt: 0 });
  }
  if (chat.style === 'brainstorm') {
    axes.push({ title: '方法冲突', poles: ['发散创意', '收敛执行'], currentTilt: 10 });
  }
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
  return axes.map((axis) => {
    let delta = 0;
    if (/反对|攻击|质疑|不行|wrong|hate|terrible|失败|荒谬/.test(text)) delta -= 14;
    if (/支持|同意|喜欢|欣赏|great|agree|love|太好了/.test(text)) delta += 10;
    if (/但是|不过|可是|然而|actually|but|however/.test(text)) delta -= 6;
    return {
      ...axis,
      currentTilt: clampTilt((axis.currentTilt || 0) + delta),
    };
  });
}

export function summarizeConflictAxes(axes: ConversationConflictAxis[]) {
  return axes.slice(0, 2).map((axis) => `${axis.title} ${axis.currentTilt && axis.currentTilt > 0 ? axis.poles[0] : axis.poles[1]}`).join('；');
}
