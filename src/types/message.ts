export type MessageType = 'ai' | 'user' | 'system' | 'god' | 'event';

export type MessageAttachmentKind = 'image' | 'audio' | 'sticker';
export type MessageAttachmentStatus = 'placeholder' | 'queued' | 'generating' | 'ready' | 'failed' | 'deleted';

export interface MessageAttachment {
  id: string;
  kind: MessageAttachmentKind;
  status: MessageAttachmentStatus;
  altText: string;
  assetId?: string;
  url?: string;
  mimeType?: string;
  sizeBytes?: number;
  durationMs?: number;
  width?: number;
  height?: number;
  generationJobId?: string;
  promptText?: string;
  thumbnailAssetId?: string;
  checksum?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MediaGenerationDecision {
  image?: {
    shouldGenerate: boolean;
    reason?: string;
    prompt?: string;
    altText?: string;
  } | null;
  audio?: {
    shouldGenerate: boolean;
    reason?: string;
    text?: string;
    voiceProfileId?: string;
  } | null;
}

export interface MessageMetadata {
  format?: 'plain' | 'markdown';
  contextText?: string;
  renderText?: string;
  attachments?: MessageAttachment[];
  generationDecision?: MediaGenerationDecision;
  generation?: {
    status?: 'queued' | 'generating' | 'ready' | 'failed';
    updatedAt?: number;
    error?: string;
  };
  runtimeDecision?: {
    directorIntent?: {
      source: string;
      beatType: string;
      targetLineId?: string;
      targetActorIds?: string[];
      pressure?: number;
      reason?: string;
    };
    narrativeLines?: Array<{
      id: string;
      type: string;
      title: string;
      salience: number;
      tension: number;
      status: string;
      participantIds?: string[];
    }>;
    speakerScore?: Record<string, unknown>;
  };
  visibility?: string;
  cachePolicy?: Record<string, unknown>;
}

export interface Message {
  id: string;
  clientKey?: string;
  serverId?: string;
  chatId: string;
  type: MessageType;
  senderId: string;         // AI character ID, 'user', or 'system'
  senderName: string;
  content: string;
  metadata?: MessageMetadata;
  emotion: number;           // -1 to 1
  timestamp: number;
  isDeleted: boolean;
  isOptimistic?: boolean;
  isStreaming?: boolean;
}
