// HTTP API client for AI Chat Group backend

const API_BASE = '/api';

class ApiClient {
  private getToken(): string | null {
    return localStorage.getItem('miragetea-token');
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
      localStorage.removeItem('miragetea-token');
      localStorage.removeItem('miragetea-user');
      window.location.href = '/login';
      throw new Error('登录已过期，请重新登录');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: '请求失败' }));
      throw new Error(error.error || `HTTP ${response.status}`);
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
      expertise: string[]; speakingStyle: string; background: string;
      modelProfileId?: string | null;
      isPreset: boolean; createdAt: number; updatedAt: number;
    }>>('GET', '/characters');
  }

  async createCharacter(data: {
    name: string; avatar?: string; personality: Record<string, number>;
    expertise: string[]; speakingStyle: string; background: string;
    modelProfileId?: string | null;
  }) {
    return this.request<Record<string, unknown>>('POST', '/characters', data);
  }

  async updateCharacter(id: string, data: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('PUT', `/characters/${id}`, data);
  }

  async deleteCharacter(id: string) {
    return this.request<{ success: boolean }>('DELETE', `/characters/${id}`);
  }

  async getChats() {
    return this.request<Array<{
      id: string; name: string; topic: string; style: string;
      memberIds: string[]; speed: number; isActive: boolean;
      allowIntervention: boolean; showRoleActions?: boolean; topicSeed: string;
      createdAt: number; updatedAt: number; lastMessageAt: number;
    }>>('GET', '/chats');
  }

  async createChat(data: {
    name: string; topic?: string; style?: string; memberIds: string[];
    speed?: number; isActive?: boolean; allowIntervention?: boolean; showRoleActions?: boolean; topicSeed?: string;
  }) {
    return this.request<Record<string, unknown>>('POST', '/chats', data);
  }

  async updateChat(id: string, data: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('PUT', `/chats/${id}`, data);
  }

  async deleteChat(id: string) {
    return this.request<{ success: boolean }>('DELETE', `/chats/${id}`);
  }

  async getMessages(chatId: string, options?: { limit?: number; before?: number }) {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.before) params.set('before', String(options.before));
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<Array<{
      id: string; chatId: string; type: string; senderId: string;
      senderName: string; content: string; emotion: number;
      timestamp: number; isDeleted: boolean;
    }>>('GET', `/chats/${chatId}/messages${query}`);
  }

  async createMessage(chatId: string, data: {
    type: string; senderId: string; senderName: string;
    content: string; emotion?: number;
  }) {
    return this.request<Record<string, unknown>>('POST', `/chats/${chatId}/messages`, data);
  }

  async deleteMessage(id: string) {
    return this.request<{ success: boolean }>('DELETE', `/messages/${id}`);
  }

  async getSettings() {
    return this.request<{
      api: { provider: string; apiKey: string; baseUrl: string; model: string };
      aiProfiles?: Array<{ id: string; name: string; provider: string; apiKey: string; baseUrl: string; model: string }>;
      theme: string; themeColor: string; language: string; defaultSpeed: number;
      chatDraftDefaults?: { style: string; showRoleActions: boolean };
    }>('GET', '/settings');
  }

  async updateSettings(data: Record<string, unknown>) {
    return this.request<Record<string, unknown>>('PUT', '/settings', data);
  }
}

export const api = new ApiClient();
