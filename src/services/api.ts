// HTTP API client for chat backend

import type { BubbleStyleDefinition } from '../types/bubbleStyle';
import type { CharacterVisualIdentity, CharacterVisualReferenceImage } from '../types/character';
import { storageKey } from '../constants/brand';

const API_BASE = '/api';

export interface TopicSourceSummary {
  id: string;
  label: string;
  status: 'ok' | 'degraded' | 'unavailable';
  note?: string;
}

export interface TopicItem {
  id: string;
  title: string;
  subtitle?: string;
  url?: string;
  heat?: string;
  source: string;
  fetchedAt: number;
  status: 'ok' | 'degraded' | 'unavailable';
}

export interface TopicAdaptationCharacterSuggestion {
  name: string;
  description: string;
}

export interface TopicAdaptationResult {
  suggestedName?: string;
  suggestedTopic?: string;
  suggestedStyle?: 'free' | 'debate' | 'brainstorm' | 'roleplay';
  suggestedMemberIds?: string[];
  recommendedCharacters?: TopicAdaptationCharacterSuggestion[];
}

export interface CharacterArtifactSyncEntry {
  id: string;
  kind: 'birth_letter' | 'diary' | 'final_letter';
  characterId: string;
  characterName: string;
  dateKey?: string | null;
  sourceKey?: string | null;
  title: string;
  text: string;
  source: 'ai' | 'local';
  unread: boolean;
  createdAt: number;
  updatedAt: number;
}

export class ApiError extends Error {
  code?: string;
  status?: number;

  constructor(message: string, options?: { code?: string; status?: number }) {
    super(message);
    this.name = 'ApiError';
    this.code = options?.code;
    this.status = options?.status;
  }
}

class ApiClient {
  private getToken(): string | null {
    return localStorage.getItem(storageKey('token'));
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const token = this.getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${API_BASE}${path}`;
    const options: RequestInit = {
      method,
      headers: this.getHeaders(),
    };

    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (response.status === 401) {
      localStorage.removeItem(storageKey('token'));
      localStorage.removeItem(storageKey('user'));
      window.location.href = '/login';
      throw new Error('登录已过期，请重新登录');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: '请求失败', code: 'REQUEST_FAILED' }));
      const detail = typeof error.detail === 'string' && error.detail ? ` (${error.detail})` : '';
      throw new ApiError(`${error.error || `HTTP ${response.status}`}${detail}`, { code: error.code, status: response.status });
    }

    return response.json();
  }

  async sendCode(phone: string, purpose: 'login' | 'register' | 'forgot-password' | 'change-phone' = 'login') {
    return this.request<{ success: boolean; mock?: boolean; code?: string }>('POST', '/auth/send-code', { phone, purpose });
  }

  async sendChangePhoneCode(phone: string) {
    return this.request<{ success: boolean; mock?: boolean; code?: string }>('POST', '/auth/change-phone/send-code', { phone });
  }

  async login(phone: string, code: string) {
    return this.request<{ token: string; user: { id: string; phone: string; nickname: string; avatar: string } }>('POST', '/auth/login', { phone, code });
  }

  async getMe() {
    return this.request<{ id: string; phone: string; nickname: string; avatar: string }>('GET', '/auth/me');
  }

  async updateMe(data: { nickname?: string; avatar?: string }) {
    return this.request<{ id: string; phone: string; nickname: string; avatar: string }>('PUT', '/auth/me', data);
  }

  async changePhone(phone: string, code: string) {
    return this.request<{ id: string; phone: string; nickname: string; avatar: string }>('PUT', '/auth/change-phone', { phone, code });
  }

  async getCharacters() {
    return this.request<Array<{
      id: string; name: string; avatar: string; personality: Record<string, number>;
      behavior?: object; expertise: string[]; speakingStyle: string; background: string; group?: string | null;
      visualIdentity?: CharacterVisualIdentity | null;
      visualReferenceImages?: CharacterVisualReferenceImage[];
      personalityDrift?: object; emotionalState?: object; soulState?: object; coreProfile?: object;
      speechProfile?: object; voiceConfig?: object; relationships?: object[]; memory?: object; layeredMemories?: object[]; intervention?: object; runtimeTimeline?: Array<{ type: string; text: string; createdAt: number }>;
      modelProfileId?: string | null; modelProfileIds?: Partial<Record<'text' | 'image' | 'audio' | 'document', string | null>>; bubbleStyle?: BubbleStyleDefinition | null; bubbleStyleId?: string | null;
      isPreset: boolean; deletedAt?: number | null; fieldVersions?: Record<string, number>; createdAt: number; updatedAt: number;
    }>>('GET', '/characters');
  }

  async createCharacter(data: {
    name: string; avatar?: string; personality: Record<string, number>;
    behavior?: object; expertise: string[]; speakingStyle: string; background: string; group?: string | null; personalityDrift?: object; emotionalState?: object; soulState?: object; coreProfile?: object;
    visualIdentity?: CharacterVisualIdentity | null;
    visualReferenceImages?: CharacterVisualReferenceImage[];
    speechProfile?: object; voiceConfig?: object; relationships?: object[]; memory?: object; layeredMemories?: object[]; intervention?: object; runtimeTimeline?: Array<{ type: string; text: string; createdAt: number }>;
    modelProfileId?: string | null; modelProfileIds?: Partial<Record<'text' | 'image' | 'audio' | 'document', string | null>>; bubbleStyle?: BubbleStyleDefinition | null; bubbleStyleId?: string | null;
  }) {
    return this.request<Record<string, unknown>>('POST', '/characters', data);
  }

  async createCharactersBatch(items: Array<{
    name: string; avatar?: string; personality: Record<string, number>;
    behavior?: object; expertise: string[]; speakingStyle: string; background: string; group?: string | null; personalityDrift?: object; emotionalState?: object; soulState?: object; coreProfile?: object;
    visualIdentity?: CharacterVisualIdentity | null;
    visualReferenceImages?: CharacterVisualReferenceImage[];
    speechProfile?: object; voiceConfig?: object; relationships?: object[]; memory?: object; layeredMemories?: object[]; intervention?: object; runtimeTimeline?: Array<{ type: string; text: string; createdAt: number }>;
    modelProfileId?: string | null; modelProfileIds?: Partial<Record<'text' | 'image' | 'audio' | 'document', string | null>>; bubbleStyleId?: string | null;
  }>) {
    return this.request<{ characters: Record<string, unknown>[] }>('POST', '/characters/batch', { items });
  }

  async updateCharacter(id: string, data: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('PUT', `/characters/${id}`, data);
  }

  async replaceCharacterVisualIdentity(id: string, data: {
    visualIdentity?: CharacterVisualIdentity | null;
    visualReferenceImages?: CharacterVisualReferenceImage[];
  }) {
    return this.request<Record<string, unknown>>('PUT', `/characters/${id}`, data);
  }

  async syncCharacterPatch(id: string, data: { operationId: string; clientTimestamp: number; patch: Record<string, unknown> }) {
    return this.request<{ success: boolean; character: Record<string, unknown> }>('PATCH', `/characters/${id}/sync`, data);
  }

  async syncChatPatch(id: string, data: { operationId: string; clientTimestamp: number; patch: Record<string, unknown> }) {
    return this.request<{ success: boolean; chat: Record<string, unknown> }>('PATCH', `/chats/${id}/sync`, data);
  }

  async deleteCharacter(id: string) {
    return this.request<{ success: boolean }>('DELETE', `/characters/${id}`);
  }

  async bulkDeleteCharacters(ids: string[]) {
    return this.request<{ success: boolean; deletedIds: string[] }>('POST', '/characters/bulk-delete', { ids });
  }

  async getDeletedCharacters() {
    return this.request<Array<Record<string, unknown>>>('GET', '/characters/deleted');
  }

  async restoreCharacter(id: string) {
    return this.request<{ success: boolean; character: Record<string, unknown> }>('POST', `/characters/${id}/restore`);
  }

  async bulkRestoreCharacters(ids: string[]) {
    return this.request<{ success: boolean; characters: Record<string, unknown>[] }>('POST', '/characters/bulk-restore', { ids });
  }

  async purgeCharacter(id: string) {
    return this.request<{ success: boolean }>('DELETE', `/characters/${id}/purge`);
  }

  async bulkPurgeCharacters(ids: string[]) {
    return this.request<{ success: boolean; deletedIds: string[] }>('POST', '/characters/bulk-purge', { ids });
  }

  async emptyDeletedCharacters() {
    return this.request<{ success: boolean; deletedIds: string[] }>('DELETE', '/characters/recycle-bin/empty-all');
  }

  async getDeletedCharacterStats() {
    return this.request<{ count: number }>('GET', '/characters/recycle-bin/stats');
  }

  async bulkUpdateCharacters(ids: string[], data: { group?: string | null }) {
    return this.request<{ success: boolean; characters: Record<string, unknown>[] }>('POST', '/characters/bulk-update', { ids, ...data });
  }

  async getChats() {
    return this.request<Array<{
      id: string; type?: string; mode?: string; modeConfig?: object; modeState?: object; name: string; topic: string; style: string;
      runtimeEvolutionIntensity?: 'slow' | 'balanced' | 'fast'; memberIds: string[]; speed: number; isActive: boolean;
      allowIntervention: boolean; showRoleActions?: boolean; topicSeed: string; sourceChatId?: string | null; sourceMemberIds?: string[]; runtimeSeed?: { notes?: string[]; artifacts?: string[] }; layeredMemories?: object[]; runtimeTimeline?: Array<{ type: string; text: string; createdAt: number }>;
      runtimeEventsV2?: object[]; relationshipLedger?: object[]; governance?: object; dramaRules?: object; worldState?: object; directorControls?: object;
      deletedAt?: number | null; fieldVersions?: Record<string, number>; latestMessage?: {
        id: string; chatId: string; type: string; senderId: string;
        senderName: string; content: string; metadata?: unknown; emotion: number;
        timestamp: number; isDeleted: boolean;
      } | null; createdAt: number; updatedAt: number; lastMessageAt: number;
    }>>('GET', '/chats');
  }

  async createChat(data: {
    type?: string; mode?: string; modeConfig?: object; modeState?: object; name: string; topic?: string; style?: string; runtimeEvolutionIntensity?: 'slow' | 'balanced' | 'fast'; memberIds: string[];
    speed?: number; isActive?: boolean; allowIntervention?: boolean; showRoleActions?: boolean; topicSeed?: string; sourceChatId?: string | null; sourceMemberIds?: string[]; runtimeSeed?: { notes?: string[]; artifacts?: string[] }; layeredMemories?: object[]; runtimeTimeline?: Array<{ type: string; text: string; createdAt: number }>;
    runtimeEventsV2?: object[]; relationshipLedger?: object[]; governance?: unknown; dramaRules?: unknown; worldState?: unknown; directorControls?: unknown;
  }) {
    return this.request<Record<string, unknown>>('POST', '/chats', data);
  }

  async updateChat(id: string, data: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('PUT', `/chats/${id}`, data);
  }

  async deleteChat(id: string) {
    return this.request<{ success: boolean }>('DELETE', `/chats/${id}`);
  }

  async bulkDeleteChats(ids: string[]) {
    return this.request<{ success: boolean; deletedIds: string[] }>('POST', '/chats/bulk-delete', { ids });
  }

  async getDeletedChats() {
    return this.request<Array<Record<string, unknown>>>('GET', '/chats?deletedOnly=1');
  }

  async restoreChat(id: string) {
    return this.request<{ success: boolean; chat: Record<string, unknown> }>('POST', `/chats/${id}/restore`);
  }

  async bulkRestoreChats(ids: string[]) {
    return this.request<{ success: boolean; chats: Record<string, unknown>[] }>('POST', '/chats/bulk-restore', { ids });
  }

  async purgeChat(id: string) {
    return this.request<{ success: boolean }>('DELETE', `/chats/${id}/purge`);
  }

  async bulkPurgeChats(ids: string[]) {
    return this.request<{ success: boolean; deletedIds: string[] }>('POST', '/chats/bulk-purge', { ids });
  }

  async emptyDeletedChats() {
    return this.request<{ success: boolean; deletedIds: string[] }>('DELETE', '/chats/recycle-bin/empty-all');
  }

  async getDeletedChatStats() {
    return this.request<{ group: number; direct: number; aiDirect: number }>('GET', '/chats/recycle-bin/stats');
  }

  async getMessages(chatId: string, options?: { limit?: number; before?: number }) {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.before) params.set('before', String(options.before));
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<Array<{
      id: string; chatId: string; type: string; senderId: string;
      senderName: string; content: string; metadata?: unknown; emotion: number;
      timestamp: number; isDeleted: boolean;
    }>>('GET', `/chats/${chatId}/messages${query}`);
  }

  async createMessage(chatId: string, data: {
    type: string; senderId: string; senderName: string;
    content: string; emotion?: number; metadata?: unknown; timestamp?: number;
  }) {
    return this.request<Record<string, unknown>>('POST', `/chats/${chatId}/messages`, data);
  }

  async updateMessageMetadata(id: string, metadata: unknown) {
    return this.request<Record<string, unknown>>('PATCH', `/messages/${id}/metadata`, { metadata });
  }

  async createMediaAsset(data: {
    chatId: string; messageId: string; attachmentId: string; kind: 'image' | 'audio' | 'sticker' | 'thumbnail'; dataUrl: string;
  }) {
    return this.request<{ id: string; url: string; mimeType: string; sizeBytes: number; checksum?: string }>('POST', '/media-assets', data);
  }

  async listCharacterVisualAssets(characterId: string) {
    return this.request<Array<{
      id: string; characterId: string; url: string; mimeType: string; sizeBytes: number; checksum?: string; label?: string | null;
      source: 'uploaded' | 'generated'; isPrimary: boolean; createdAt: number;
    }>>('GET', `/characters/${characterId}/visual-assets`);
  }

  async createCharacterVisualAsset(characterId: string, data: {
    dataUrl: string; label?: string | null; source?: 'uploaded' | 'generated'; isPrimary?: boolean;
  }) {
    return this.request<{ id: string; assetId?: string; characterId: string; url: string; mimeType: string; sizeBytes: number; checksum?: string; label?: string | null; source: 'uploaded' | 'generated'; isPrimary: boolean; createdAt: number }>('POST', `/characters/${characterId}/visual-assets`, data);
  }

  async updateCharacterVisualAsset(characterId: string, assetId: string, data: { isPrimary?: boolean }) {
    return this.request<{ success: boolean }>('PATCH', `/characters/${characterId}/visual-assets/${assetId}`, data);
  }

  async deleteCharacterVisualAsset(characterId: string, assetId: string) {
    return this.request<{ success: boolean }>('DELETE', `/characters/${characterId}/visual-assets/${assetId}`);
  }

  async clearChatMessages(chatId: string) {
    return this.request<{ success: boolean }>('DELETE', `/chats/${chatId}/messages`);
  }

  async deleteMessage(id: string) {
    return this.request<{ success: boolean }>('DELETE', `/messages/${id}`);
  }

  async getSettings() {
    return this.request<{
      api: { provider: string; apiKey: string; baseUrl: string; model: string };
      aiProfiles?: Array<{ id: string; name: string; type?: 'text' | 'image' | 'audio' | 'document'; isDefault?: boolean; provider: string; apiKey: string; baseUrl: string; model: string; imageCapabilities?: { textToImage?: boolean; referenceImage?: boolean; multiReferenceImage?: boolean; seed?: boolean; negativePrompt?: boolean } }>;
      theme: string; themeColor: string; language: string; defaultSpeed: number;
      developerMode?: boolean;
      autoGenerateCharacterAvatar?: boolean;
      avatarGeneration?: { autoGenerateCharacterAvatar?: boolean; preferNonPhotorealAvatar?: boolean };
      developerUI?: { showMemoryDebug?: boolean; showRelationshipEvents?: boolean; showAffectEvents?: boolean; showConflictEvents?: boolean; showStateEvents?: boolean; showMemoryDistillationEvents?: boolean; showLocalInterceptionHints?: boolean; showSpeechStyle?: boolean; showAdvancedRuntimePanels?: boolean; showWithdrawnMessageContent?: boolean; dramaBoost?: boolean };
      memoryUI?: { showDeveloperMemory?: boolean };
      chatDraftDefaults?: { style: string; showRoleActions: boolean; runtimeEvolutionIntensity: 'slow' | 'balanced' | 'fast' };
      customBubbleStyles?: Array<Record<string, unknown>>;
      userBubbleStyleId?: string | null;
      userBubbleStyle?: Record<string, unknown> | null;
      artifactAppearance?: Record<string, unknown> | null;
    }>('GET', '/settings');
  }

  async updateSettings(data: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('PUT', '/settings', data);
  }

  async getCharacterArtifacts() {
    return this.request<{ items: CharacterArtifactSyncEntry[]; updatedAt: number }>('GET', '/character-artifacts');
  }

  async updateCharacterArtifacts(data: { items: CharacterArtifactSyncEntry[]; updatedAt: number }) {
    return this.request<{ success: boolean; updatedAt: number }>('PUT', '/character-artifacts', data);
  }

  async getTopicSources() {
    return this.request<{ sources: TopicSourceSummary[] }>('GET', '/topics/sources');
  }

  async getTopics(source: string) {
    return this.request<{ items: TopicItem[]; status: 'ok' | 'degraded' | 'unavailable'; note?: string }>('GET', `/topics?source=${encodeURIComponent(source)}`);
  }

  async adaptTopic(data: { topic: { title: string; subtitle?: string; source: string }; characters: Record<string, unknown>[]; language: 'zh' | 'en' }) {
    return this.request<TopicAdaptationResult>('POST', '/topics/adapt', data);
  }
}

export const api = new ApiClient();
