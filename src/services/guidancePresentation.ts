import type { GuidanceExecutionReason } from './guidanceExecution';

export function formatGuidanceKindLabel(kind: string | undefined) {
  const labels: Record<string, string> = {
    topic_shift: '话题引导',
    direct_reply: '点名回应',
    media_request: '媒体请求',
  };
  return kind ? labels[kind] || kind : '';
}

export function formatGuidanceExecutionStatusLabel(status: string | undefined) {
  const labels: Record<string, string> = {
    accepted: '已执行',
    accepted_after_retry: '重试后执行',
    failed_after_retry: '重试后仍偏航',
  };
  return status ? labels[status] || status : '';
}

export function formatGuidanceExecutionReasonLabel(reason: GuidanceExecutionReason | string | undefined) {
  const labels: Record<string, string> = {
    matched: '已回应用户要求',
    wrong_speaker: '发言角色不匹配',
    missing_requested_image: '没有执行发图动作',
    missing_requested_subject: '没有对准图片对象',
    missing_topic_focus: '没有回到新话题',
    missing_question_answer: '没有先回答新问题',
    missing_direct_reply_focus: '没有先回应点名要求',
    empty_content: '生成内容为空',
  };
  return reason ? labels[reason] || reason : '';
}
