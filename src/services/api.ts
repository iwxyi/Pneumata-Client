// HTTP API client for chat backend

import type { BubbleStyleDefinition } from '../types/bubbleStyle';
import type { AICharacter, CharacterVisualIdentity, CharacterVisualReferenceImage } from '../types/character';
import type { Message } from '../types/message';
import { storageKey } from '../constants/brand';
import { dispatchAuthSessionExpired } from './authSession';

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
  deletedAt?: number | null;
  revision?: number;
  generationSnapshot?: {
    promptVersion: 'character-experience-artifacts-v2';
    character: Partial<AICharacter>;
    relatedCharacters: Array<{ id: string; name: string }>;
    generatedAt: number;
  };
}

export type CharacterArtifactSyncKind = CharacterArtifactSyncEntry['kind'];

export interface CharacterArtifactSummaryEntry extends Omit<CharacterArtifactSyncEntry, 'text' | 'generationSnapshot'> {
  deletedAt?: number | null;
  revision?: number;
}

export interface CharacterArtifactQuery {
  kind?: CharacterArtifactSyncKind;
  characterId?: string;
  dateFrom?: string;
  dateTo?: string;
  includeDeleted?: boolean;
}

export type SyncChangeScope =
  | 'characters.summary'
  | `characters.detail:${string}`
  | 'chats.summary'
  | `chats.detail:${string}`
  | `messages.window:${string}`
  | 'world-runtime.window'
  | 'artifacts.summary'
  | `artifacts.summary:${string}`
  | 'settings.account';

export interface SyncChangesResponse {
  status: 'modified' | 'not_modified' | 'reset_required';
  scope: SyncChangeScope;
  cursor: string;
  revision: string;
  changes: Array<Record<string, unknown>>;
  hasMore?: boolean;
  code?: string;
  resetReason?: string;
  minAvailableCursor?: string;
  retentionMs?: number;
}

export interface ChatShareState {
  enabled: boolean;
  token: string | null;
  viewerCount: number;
}

export interface PublicChatShareResponse {
  chat: {
    name: string;
    updatedAt: number;
    lastMessageAt: number;
  };
  members: Array<{
    id: string;
    name: string;
    avatar: string;
    personality?: Record<string, number>;
    expertise?: string[];
    speakingStyle?: string;
    background?: string;
    speechProfile?: Record<string, unknown> | null;
    bubbleStyle?: BubbleStyleDefinition | null;
    bubbleStyleId?: string | null;
    isPreset?: boolean;
  }>;
  messages: Message[];
  hasMore: boolean;
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

  private async parseJsonResponse<T>(response: Response): Promise<T> {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return response.json() as Promise<T>;
    }
    const text = await response.text().catch(() => '');
    const normalized = text.trimStart().toLowerCase();
    const isHtml = normalized.startsWith('<!doctype') || normalized.startsWith('<html');
    throw new ApiError(
      isHtml ? '接口返回了前端页面，请检查后端服务或开发代理配置' : '接口返回了非 JSON 响应',
      { status: response.status, code: 'INVALID_API_RESPONSE' },
    );
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

    if (!response.ok) {
      const error: { error?: string; detail?: string; code?: string } = await this.parseJsonResponse<{ error?: string; detail?: string; code?: string }>(response).catch(() => ({ error: '请求失败', code: 'REQUEST_FAILED' }));
      const detail = typeof error.detail === 'string' && error.detail ? ` (${error.detail})` : '';
      if (response.status === 401 || response.status === 403) {
        dispatchAuthSessionExpired({ status: response.status, path });
      }
      throw new ApiError(`${error.error || `HTTP ${response.status}`}${detail}`, { code: error.code, status: response.status });
    }

    return this.parseJsonResponse<T>(response);
  }

  async sendCode(phone: string, purpose: 'login' | 'register' | 'forgot-password' | 'change-phone' = 'login') {
    return this.request<{ success: boolean; mock?: boolean; code?: string }>('POST', '/auth/send-code', { phone, purpose });
  }

  async sendChangePhoneCode(phone: string) {
    return this.request<{ success: boolean; mock?: boolean; code?: string }>('POST', '/auth/change-phone/send-code', { phone });
  }

  async login(phone: string, code: string) {
    return this.request<{ token: string; user: { id: string; phone: string; nickname: string; avatar: string; cloudSyncEntitled?: boolean } }>('POST', '/auth/login', { phone, code });
  }

  async getMe() {
    return this.request<{ id: string; phone: string; nickname: string; avatar: string; cloudSyncEntitled?: boolean }>('GET', '/auth/me');
  }

  async updateMe(data: { nickname?: string; avatar?: string }) {
    return this.request<{ id: string; phone: string; nickname: string; avatar: string; cloudSyncEntitled?: boolean }>('PUT', '/auth/me', data);
  }

  async changePhone(phone: string, code: string) {
    return this.request<{ id: string; phone: string; nickname: string; avatar: string; cloudSyncEntitled?: boolean }>('PUT', '/auth/change-phone', { phone, code });
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
      generationPreferences?: { moments?: 'follow_global' | 'on' | 'off'; diaries?: 'follow_global' | 'on' | 'off'; companionship?: 'follow_global' | 'on' | 'off' };
      isPreset: boolean; deletedAt?: number | null; fieldVersions?: Record<string, number>; createdAt: number; updatedAt: number;
    }>>('GET', '/characters');
  }

  async getCharacter(id: string) {
    return this.request<Record<string, unknown>>('GET', `/characters/${id}`);
  }

  async createCharacter(data: {
    id?: string;
    operationId?: string;
    name: string; avatar?: string; personality: Record<string, number>;
    behavior?: object; expertise: string[]; speakingStyle: string; background: string; group?: string | null; personalityDrift?: object; emotionalState?: object; soulState?: object; coreProfile?: object;
    visualIdentity?: CharacterVisualIdentity | null;
    visualReferenceImages?: CharacterVisualReferenceImage[];
    speechProfile?: object; voiceConfig?: object; relationships?: object[]; memory?: object; layeredMemories?: object[]; intervention?: object; runtimeTimeline?: Array<{ type: string; text: string; createdAt: number }>;
    modelProfileId?: string | null; modelProfileIds?: Partial<Record<'text' | 'image' | 'audio' | 'document', string | null>>; bubbleStyle?: BubbleStyleDefinition | null; bubbleStyleId?: string | null;
    generationPreferences?: { moments?: 'follow_global' | 'on' | 'off'; diaries?: 'follow_global' | 'on' | 'off'; companionship?: 'follow_global' | 'on' | 'off' };
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
    generationPreferences?: { moments?: 'follow_global' | 'on' | 'off'; diaries?: 'follow_global' | 'on' | 'off'; companionship?: 'follow_global' | 'on' | 'off' };
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
      id: string; type?: string; mode?: string; modeConfig?: object; modeState?: object; sessionKind?: object; scenarioState?: object; channels?: object[]; layoutState?: object; scenarioPackage?: object | null; judgeAgent?: object | null; layeredGrowth?: object; modeStateSummary?: object; memoryLayerSummary?: object; growthSnapshots?: object[]; roleMemorySummaries?: object[]; scenarioMemorySummary?: object | null; topologySummary?: object | null; name: string; topic: string; style: string;
      runtimeEvolutionIntensity?: 'slow' | 'balanced' | 'fast'; memberIds: string[]; speed: number; isActive: boolean;
      allowIntervention: boolean; showRoleActions?: boolean; topicSeed: string; sourceChatId?: string | null; sourceMemberIds?: string[]; memberCharacterSummaries?: Array<Record<string, unknown>>; runtimeSeed?: { notes?: string[]; artifacts?: string[] }; layeredMemories?: object[]; runtimeTimeline?: Array<{ type: string; text: string; createdAt: number }>;
      runtimeEventsV2?: object[]; relationshipLedger?: object[]; governance?: object; dramaRules?: object; worldState?: object; directorControls?: object;
      deletedAt?: number | null; fieldVersions?: Record<string, number>; latestMessage?: {
        id: string; chatId: string; type: string; senderId: string;
        senderName: string; content: string; metadata?: unknown; emotion: number;
        timestamp: number; isDeleted: boolean;
      } | null; createdAt: number; updatedAt: number; lastMessageAt: number;
    }>>('GET', '/chats');
  }

  async getChat(id: string) {
    return this.request<Record<string, unknown>>('GET', `/chats/${id}`);
  }

  async getChatShareState(id: string) {
    return this.request<ChatShareState>('GET', `/chats/${id}/share`);
  }

  async updateChatShareState(id: string, enabled: boolean) {
    return this.request<ChatShareState>('PATCH', `/chats/${id}/share`, { enabled });
  }

  async getPublicChatShare(token: string, options?: { limit?: number; before?: number }) {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.before) params.set('before', String(options.before));
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<PublicChatShareResponse>('GET', `/public/chat-shares/${encodeURIComponent(token)}${query}`);
  }

  async getWorldRuntimeChats() {
    return this.request<Array<Record<string, unknown>>>('GET', '/chats/world-runtime');
  }

  async createChat(data: {
    id?: string;
    operationId?: string;
    type?: string; mode?: string; modeConfig?: object; modeState?: object; sessionKind?: object; scenarioState?: object; channels?: object[]; layoutState?: object; scenarioPackage?: object | null; judgeAgent?: object | null; layeredGrowth?: object; modeStateSummary?: object; memoryLayerSummary?: object; growthSnapshots?: object[]; roleMemorySummaries?: object[]; scenarioMemorySummary?: object | null; topologySummary?: object | null; name: string; topic?: string; style?: string; runtimeEvolutionIntensity?: 'slow' | 'balanced' | 'fast'; memberIds: string[];
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

  async getSyncChanges(params: { scope: SyncChangeScope; since?: string | number | null }): Promise<SyncChangesResponse> {
    const query = new URLSearchParams({ scope: params.scope });
    if (params.since !== undefined && params.since !== null && String(params.since).trim()) {
      query.set('since', String(params.since));
    }
    const result = await this.request<SyncChangesResponse>('GET', `/sync/changes?${query.toString()}`);
    if (result.status !== 'reset_required' || params.since === undefined || params.since === null || !String(params.since).trim()) return result;
    return this.getSyncChanges({ scope: params.scope });
  }

  async getDeletedChatStats() {
    return this.request<{ group: number; direct: number; aiDirect: number }>('GET', '/chats/recycle-bin/stats');
  }

  async getMessages(chatId: string, options?: { limit?: number; before?: number; after?: number; aroundTimestamp?: number }) {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) params.set('limit', String(options.limit));
    if (options?.before !== undefined) params.set('before', String(options.before));
    if (options?.after !== undefined) params.set('after', String(options.after));
    if (options?.aroundTimestamp !== undefined) params.set('aroundTimestamp', String(options.aroundTimestamp));
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<Array<{
      id: string; chatId: string; type: string; senderId: string;
      senderName: string; content: string; metadata?: unknown; emotion: number;
      timestamp: number; isDeleted: boolean;
    }>>('GET', `/chats/${chatId}/messages${query}`);
  }

  async createMessage(chatId: string, data: {
    type: string; senderId: string; senderName: string;
    content: string; emotion?: number; metadata?: unknown; timestamp?: number; clientKey?: string; operationId?: string;
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
      developerUI?: { showMemoryDebug?: boolean; showRelationshipEvents?: boolean; showAffectEvents?: boolean; showConflictEvents?: boolean; showStateEvents?: boolean; showMemoryDistillationEvents?: boolean; showLocalInterceptionHints?: boolean; showSpeechStyle?: boolean; showAdvancedRuntimePanels?: boolean; showMomentDebug?: boolean; showWithdrawnMessageContent?: boolean; dramaBoost?: boolean };
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
    return this.request<{ items: CharacterArtifactSummaryEntry[]; updatedAt: number }>('GET', '/character-artifacts');
  }

  async getCharacterArtifactSummaries(query: CharacterArtifactQuery = {}) {
    const params = new URLSearchParams();
    if (query.kind) params.set('kind', query.kind);
    if (query.characterId) params.set('characterId', query.characterId);
    if (query.dateFrom) params.set('dateFrom', query.dateFrom);
    if (query.dateTo) params.set('dateTo', query.dateTo);
    if (query.includeDeleted) params.set('includeDeleted', 'true');
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return this.request<{ items: CharacterArtifactSummaryEntry[]; updatedAt: number }>('GET', `/character-artifacts/summary${suffix}`);
  }

  async getCharacterArtifactDetails(query: CharacterArtifactQuery = {}) {
    const params = new URLSearchParams();
    if (query.kind) params.set('kind', query.kind);
    if (query.characterId) params.set('characterId', query.characterId);
    if (query.dateFrom) params.set('dateFrom', query.dateFrom);
    if (query.dateTo) params.set('dateTo', query.dateTo);
    if (query.includeDeleted) params.set('includeDeleted', 'true');
    params.set('includeText', 'true');
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return this.request<{ items: CharacterArtifactSyncEntry[]; updatedAt: number }>('GET', `/character-artifacts${suffix}`);
  }

  async getCharacterArtifactItem(id: string) {
    return this.request<{ item: CharacterArtifactSyncEntry }>('GET', `/character-artifacts/items/${encodeURIComponent(id)}`);
  }

  async upsertCharacterArtifactItem(item: CharacterArtifactSyncEntry & { operationId?: string; baseRevision?: number; clientTimestamp?: number }) {
    return this.request<{
      success: boolean;
      accepted?: boolean;
      status?: 'accepted' | 'rejected';
      reason?: 'stale_base' | 'older_update';
      updatedAt: number;
      revision: number;
    }>('PUT', `/character-artifacts/items/${encodeURIComponent(item.id)}`, item);
  }

  async deleteCharacterArtifactItem(id: string, data: { operationId?: string; baseRevision?: number; deletedAt?: number } = {}) {
    return this.request<{
      success: boolean;
      accepted?: boolean;
      status?: 'accepted' | 'rejected';
      reason?: 'stale_base' | 'older_update';
      deletedAt: number;
      revision: number;
    }>('DELETE', `/character-artifacts/items/${encodeURIComponent(id)}`, data);
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
