export function getAttachmentErrorText(attachment: { error?: string }) {
  const text = attachment.error?.trim();
  return text || '生成任务失败，请检查模型配置或稍后重试。';
}
