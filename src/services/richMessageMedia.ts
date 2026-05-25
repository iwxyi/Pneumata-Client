import type { AICharacter } from '../types/character';
import type { Message, MessageAttachment, MessageMetadata } from '../types/message';
import type { AIModelProfile } from '../types/settings';
import { api } from './api';
import { generateImageWithAdapter, synthesizeSpeechWithAdapter } from './aiGenerationAdapter';

function findProfile(profiles: AIModelProfile[], id?: string | null) {
  const profile = id ? profiles.find((item) => item.id === id) : null;
  return profile?.apiKey && profile.model ? profile : null;
}

function findGenerationProfile(profiles: AIModelProfile[], type: 'image' | 'audio', id?: string | null) {
  const profile = findProfile(profiles, id) || profiles.find((item) => item.type === type && item.isDefault && item.apiKey && item.model) || profiles.find((item) => item.type === type && item.apiKey && item.model);
  return profile?.apiKey && profile.model ? profile : null;
}

async function blobToDataUrl(blob: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

async function ensureDataUrl(value: string) {
  if (value.startsWith('data:')) return value;
  const response = await fetch(value);
  const blob = await response.blob();
  return blobToDataUrl(blob);
}

export function isLocalOnlyMediaMode() {
  return (typeof localStorage !== 'undefined' ? localStorage.getItem('miragetea-auth-mode') : 'local') !== 'cloud';
}

function updateAttachment(metadata: MessageMetadata | undefined, attachmentId: string, patch: Partial<MessageAttachment>): MessageMetadata {
  const attachments = (metadata?.attachments || []).map((attachment) => (
    attachment.id === attachmentId ? { ...attachment, ...patch, updatedAt: Date.now() } : attachment
  ));
  const generationStatus = attachments.some((item) => item.status === 'queued' || item.status === 'generating')
    ? 'generating'
    : attachments.some((item) => item.status === 'failed')
      ? 'failed'
      : 'ready';
  return {
    ...(metadata || {}),
    attachments,
    generation: {
      ...(metadata?.generation || {}),
      status: generationStatus,
      updatedAt: Date.now(),
    },
  };
}

export async function processRichMessageMedia(params: {
  message: Message;
  character?: AICharacter | null;
  aiProfiles: AIModelProfile[];
  upsertMessage: (message: Message) => void;
}) {
  const attachments = params.message.metadata?.attachments || [];
  if (!attachments.some((item) => item.status === 'queued')) return;

  for (const attachment of attachments) {
    if (attachment.status !== 'queued') continue;
    const generatingMetadata = updateAttachment(params.message.metadata, attachment.id, { status: 'generating' });
    let currentMessage = { ...params.message, metadata: generatingMetadata };
    params.upsertMessage(currentMessage);
    if (!isLocalOnlyMediaMode()) void api.updateMessageMetadata(currentMessage.serverId || currentMessage.id, generatingMetadata).catch(() => undefined);

    try {
      if (attachment.kind === 'image') {
        const profile = findGenerationProfile(params.aiProfiles, 'image', params.character?.modelProfileIds?.image);
        if (!profile || !attachment.promptText) throw new Error('图片模型未配置');
        const images = await generateImageWithAdapter({
          profile,
          prompt: attachment.promptText,
          count: 1,
          intent: 'chat-image',
          character: params.character,
          allowCharacterReferenceImages: true,
          negativePrompt: params.character?.visualIdentity?.negativePrompt,
          seed: params.character?.visualIdentity?.seed,
        });
        const first = images[0];
        if (!first?.dataUrl) throw new Error('图片生成失败');
        const dataUrl = await ensureDataUrl(first.dataUrl);
        const asset = isLocalOnlyMediaMode()
          ? { id: undefined, url: dataUrl, mimeType: first.mimeType, sizeBytes: dataUrl.length, checksum: undefined }
          : await api.createMediaAsset({
              chatId: currentMessage.chatId,
              messageId: currentMessage.serverId || currentMessage.id,
              attachmentId: attachment.id,
              kind: 'image',
              dataUrl,
            });
        const readyMetadata = updateAttachment(currentMessage.metadata, attachment.id, {
          status: 'ready',
          assetId: asset.id,
          url: asset.url,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          checksum: asset.checksum,
        });
        currentMessage = { ...currentMessage, metadata: readyMetadata };
        params.upsertMessage(currentMessage);
        if (!isLocalOnlyMediaMode()) void api.updateMessageMetadata(currentMessage.serverId || currentMessage.id, readyMetadata).catch(() => undefined);
      }

      if (attachment.kind === 'audio') {
        const profile = findGenerationProfile(params.aiProfiles, 'audio', params.character?.modelProfileIds?.audio);
        if (!profile) throw new Error('语音模型未配置');
        const voice = params.character?.voiceConfig?.voiceName || profile.model;
        const audio = await synthesizeSpeechWithAdapter({
          profile,
          intent: 'chat-audio',
          input: attachment.promptText || currentMessage.content,
          voice,
          format: 'mp3',
        });
        const dataUrl = await blobToDataUrl(audio.blob);
        const asset = isLocalOnlyMediaMode()
          ? { id: undefined, url: dataUrl, mimeType: audio.mimeType, sizeBytes: dataUrl.length, checksum: undefined }
          : await api.createMediaAsset({
              chatId: currentMessage.chatId,
              messageId: currentMessage.serverId || currentMessage.id,
              attachmentId: attachment.id,
              kind: 'audio',
              dataUrl,
            });
        const readyMetadata = updateAttachment(currentMessage.metadata, attachment.id, {
          status: 'ready',
          assetId: asset.id,
          url: asset.url,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
        });
        currentMessage = { ...currentMessage, metadata: readyMetadata };
        params.upsertMessage(currentMessage);
        if (!isLocalOnlyMediaMode()) void api.updateMessageMetadata(currentMessage.serverId || currentMessage.id, readyMetadata).catch(() => undefined);
      }
    } catch (error) {
      const failedMetadata = updateAttachment(currentMessage.metadata, attachment.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      currentMessage = { ...currentMessage, metadata: failedMetadata };
      params.upsertMessage(currentMessage);
      if (!isLocalOnlyMediaMode()) void api.updateMessageMetadata(currentMessage.serverId || currentMessage.id, failedMetadata).catch(() => undefined);
    }
  }
}

export function hasLocalDataUrlMedia(message: Message) {
  return Boolean(message.metadata?.attachments?.some((attachment) => attachment.status === 'ready' && typeof attachment.url === 'string' && attachment.url.startsWith('data:')));
}

export function scrubLocalMediaUrlsForCloud(message: Message) {
  if (!message.metadata?.attachments?.length) return message.metadata;
  return {
    ...message.metadata,
    attachments: message.metadata.attachments.map((attachment) => {
      if (attachment.status === 'ready' && typeof attachment.url === 'string' && attachment.url.startsWith('data:')) {
        return {
          ...attachment,
          status: 'queued' as const,
          url: undefined,
          assetId: undefined,
          updatedAt: Date.now(),
        };
      }
      return attachment;
    }),
  };
}

export async function uploadLocalMessageMediaToCloud(params: {
  localMessage: Message;
  cloudMessage: Message;
}) {
  const attachments = params.localMessage.metadata?.attachments || [];
  if (!attachments.length) return params.cloudMessage.metadata;
  let nextMetadata = params.cloudMessage.metadata || scrubLocalMediaUrlsForCloud(params.localMessage);
  for (const attachment of attachments) {
    if (attachment.status !== 'ready' || !attachment.url?.startsWith('data:')) continue;
    const asset = await api.createMediaAsset({
      chatId: params.cloudMessage.chatId,
      messageId: params.cloudMessage.serverId || params.cloudMessage.id,
      attachmentId: attachment.id,
      kind: attachment.kind,
      dataUrl: attachment.url,
    });
    nextMetadata = updateAttachment(nextMetadata, attachment.id, {
      status: 'ready',
      assetId: asset.id,
      url: asset.url,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      checksum: asset.checksum,
    });
  }
  await api.updateMessageMetadata(params.cloudMessage.serverId || params.cloudMessage.id, nextMetadata);
  return nextMetadata;
}
