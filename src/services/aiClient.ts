import type { APIConfig, AIModelProfile } from '../types/settings';
import { storageKey } from '../constants/brand';
import { dispatchAuthSessionExpired } from './authSession';

type ChatRole = 'user' | 'assistant' | 'system';
export interface ChatMessageImageAttachment {
  url: string;
  mimeType?: string;
}

type ChatMessage = { role: ChatRole; content: string; attachments?: ChatMessageImageAttachment[] };
type MaybeTypedConfig = APIConfig & Partial<Pick<AIModelProfile, 'type'>>;
type JSONValue = string | number | boolean | null | JSONValue[] | { [key: string]: JSONValue };
export type AiUsageType =
  | 'direct_chat'
  | 'group_chat'
  | 'story_chat'
  | 'group_creation'
  | 'character_generation'
  | 'character_visual_identity'
  | 'relationship_analysis'
  | 'memory_distillation'
  | 'memory_refinement'
  | 'character_core_profile'
  | 'user_profile_memory'
  | 'companionship_assessment'
  | 'companionship_care'
  | 'companionship_phase'
  | 'companionship_ritual'
  | 'world_decision'
  | 'message_analysis'
  | 'interaction_analysis'
  | 'social_event_analysis'
  | 'chat_draft'
  | 'character_artifact'
  | 'moment_generation'
  | 'model_test'
  | 'other';

export type AiUsageMetadata = {
  type: AiUsageType;
  label?: string;
  scope?: string;
  resourceId?: string;
  relatedIds?: string[];
};

export type GenerateResponseOptions = {
  responseFormat?: 'text' | 'json';
  maxTokens?: number;
  signal?: AbortSignal;
  aiUsage?: AiUsageMetadata;
};

function isOfficialProvider(provider: APIConfig['provider']) {
  return provider === 'official' || provider === 'official-deepseek' || provider === 'official-gpt' || provider === 'official-moacode';
}

function resolveOfficialBackendProvider(provider: APIConfig['provider']) {
  if (provider === 'official-deepseek') return 'deepseek';
  if (provider === 'official') return 'moacode';
  if (provider === 'official-moacode') return 'moacode';
  return 'api2d';
}

export interface AvailableModelInfo {
  id: string;
  label: string;
  raw?: JSONValue;
}

export interface ImageGenerationOptions {
  prompt: string;
  size?: string;
  count?: number;
  negativePrompt?: string;
  seed?: string | number | null;
  referenceImages?: Array<{
    url: string;
    mimeType?: string;
  }>;
  signal?: AbortSignal;
}

export interface GeneratedImage {
  mimeType: string;
  dataUrl: string;
  revisedPrompt?: string;
  url?: string;
}

export interface SpeechSynthesisOptions {
  input: string;
  voice?: string;
  format?: 'mp3' | 'wav' | 'opus' | 'aac' | 'flac' | 'pcm';
}

export interface SpeechSynthesisResult {
  mimeType: string;
  blob: Blob;
  objectUrl: string;
}

export interface AudioTranscriptionOptions {
  file: Blob;
  fileName?: string;
  prompt?: string;
  language?: string;
}

export interface AudioTranscriptionResult {
  text: string;
  raw?: JSONValue;
}

function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/, '');
}

function joinUrl(baseUrl: string, path: string) {
  return `${trimTrailingSlashes(baseUrl)}/${path.replace(/^\/+/, '')}`;
}

function encodeDataUrl(mimeType: string, base64: string) {
  return `data:${mimeType};base64,${base64}`;
}

function guessAudioMimeType(format?: string) {
  switch (format) {
    case 'wav': return 'audio/wav';
    case 'opus': return 'audio/ogg';
    case 'aac': return 'audio/aac';
    case 'flac': return 'audio/flac';
    case 'pcm': return 'audio/pcm';
    default: return 'audio/mpeg';
  }
}

function createObjectUrl(blob: Blob) {
  return URL.createObjectURL(blob);
}

function splitSystemMessages(messages: ChatMessage[], systemPrompt: string) {
  const systemParts = [
    systemPrompt.trim(),
    ...messages.filter((message) => message.role === 'system').map((message) => message.content.trim()),
  ].filter(Boolean);

  const conversation = messages.filter((message) => message.role !== 'system');
  return {
    systemPrompt: systemParts.join('\n\n'),
    conversation: conversation.length > 0 ? conversation : [{ role: 'user' as const, content: 'Hello' }],
  };
}

function buildAnthropicUrl(baseUrl: string) {
  const normalized = trimTrailingSlashes(baseUrl);
  if (normalized.endsWith('/messages')) return normalized;
  if (normalized.endsWith('/v1')) return `${normalized}/messages`;
  return `${normalized}/v1/messages`;
}

function buildGeminiUrl(baseUrl: string, model: string, stream: boolean) {
  const normalized = trimTrailingSlashes(baseUrl);
  const method = stream ? 'streamGenerateContent' : 'generateContent';

  if (normalized.includes('/models/')) {
    if (normalized.endsWith(`:${method}`)) return normalized;
    if (normalized.endsWith(`:${stream ? 'generateContent' : 'streamGenerateContent'}`)) {
      return normalized.replace(/:(generateContent|streamGenerateContent)$/, `:${method}`);
    }
    return `${normalized}:${method}`;
  }

  return `${normalized}/models/${model}:${method}`;
}

function buildZhipuUrl(baseUrl: string) {
  const normalized = trimTrailingSlashes(baseUrl);
  if (normalized.endsWith('/chat/completions')) return normalized;
  return `${normalized}/chat/completions`;
}

function buildQwenUrl(baseUrl: string) {
  const normalized = trimTrailingSlashes(baseUrl);
  if (normalized.endsWith('/services/aigc/text-generation/generation')) return normalized;
  return `${normalized}/services/aigc/text-generation/generation`;
}

function buildOpenAICompatibleImageUrl(baseUrl: string) {
  const normalized = trimTrailingSlashes(baseUrl);
  if (normalized.endsWith('/images/generations')) return normalized;
  return `${normalized}/images/generations`;
}

function buildOpenAICompatibleImageEditUrl(baseUrl: string) {
  const normalized = trimTrailingSlashes(baseUrl);
  if (normalized.endsWith('/images/edits')) return normalized;
  if (normalized.endsWith('/images/generations')) return normalized.replace(/\/images\/generations$/, '/images/edits');
  return `${normalized}/images/edits`;
}

function buildOpenAICompatibleSpeechUrl(baseUrl: string) {
  const normalized = trimTrailingSlashes(baseUrl);
  if (normalized.endsWith('/audio/speech')) return normalized;
  return `${normalized}/audio/speech`;
}

function buildMicrosoftSpeechUrl(config: APIConfig) {
  const normalized = trimTrailingSlashes(config.baseUrl);
  if (normalized.includes('/cognitiveservices/v1')) return normalized;
  return `${normalized}/cognitiveservices/v1`;
}

function buildOpenAICompatibleTranscriptionUrl(baseUrl: string) {
  const normalized = trimTrailingSlashes(baseUrl);
  if (normalized.endsWith('/audio/transcriptions')) return normalized;
  return `${normalized}/audio/transcriptions`;
}

function buildOpenAICompatibleChatUrl(baseUrl: string) {
  const normalized = trimTrailingSlashes(baseUrl);
  if (normalized.endsWith('/chat/completions')) return normalized;
  return `${normalized}/chat/completions`;
}

function splitDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

function buildOpenAICompatibleContent(message: ChatMessage) {
  const attachments = (message.attachments || []).filter((attachment) => attachment.url);
  if (!attachments.length) return message.content;
  return [
    ...(message.content ? [{ type: 'text', text: message.content }] : []),
    ...attachments.map((attachment) => ({
      type: 'image_url',
      image_url: { url: attachment.url },
    })),
  ];
}

function buildAnthropicContent(message: ChatMessage) {
  const textParts = message.content ? [{ type: 'text', text: message.content }] : [];
  const imageParts = (message.attachments || []).flatMap((attachment) => {
    const data = splitDataUrl(attachment.url);
    if (!data) return [];
    return [{
      type: 'image',
      source: {
        type: 'base64',
        media_type: attachment.mimeType || data.mimeType,
        data: data.base64,
      },
    }];
  });
  const content = [...textParts, ...imageParts];
  return content.length ? content : [{ type: 'text', text: '' }];
}

function buildGeminiParts(message: ChatMessage) {
  const textParts = message.content ? [{ text: message.content }] : [];
  const imageParts = (message.attachments || []).flatMap((attachment) => {
    const data = splitDataUrl(attachment.url);
    if (!data) return [];
    return [{
      inlineData: {
        mimeType: attachment.mimeType || data.mimeType,
        data: data.base64,
      },
    }];
  });
  const parts = [...textParts, ...imageParts];
  return parts.length ? parts : [{ text: '' }];
}

function buildQwenContent(message: ChatMessage) {
  const imageParts = (message.attachments || [])
    .filter((attachment) => attachment.url)
    .map((attachment) => ({ image: attachment.url }));
  if (!imageParts.length) return message.content;
  return [
    ...(message.content ? [{ text: message.content }] : []),
    ...imageParts,
  ];
}

function buildQwenMessages(messages: ChatMessage[], systemPrompt: string) {
  return [
    { role: 'system' as const, content: systemPrompt },
    ...messages.map((message) => ({
      role: message.role,
      content: buildQwenContent(message),
    })),
  ];
}

function buildOpenAICompatibleMessages(messages: ChatMessage[], systemPrompt: string) {
  return [
    { role: 'system' as const, content: systemPrompt },
    ...messages.map((message) => ({
      role: message.role,
      content: buildOpenAICompatibleContent(message),
    })),
  ];
}

function getAuthHeaders(): Record<string, string> {
  const token = typeof localStorage === 'undefined' ? null : localStorage.getItem(storageKey('token'));
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function buildOfficialMessages(messages: ChatMessage[], systemPrompt: string) {
  return buildOpenAICompatibleMessages(messages, systemPrompt);
}

async function parseOfficialProxyResponse(response: Response) {
  const result = await parseJsonResponse<{
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  } & Record<string, JSONValue>>(response, 'Official AI request failed');
  const content = result.choices?.[0]?.message?.content;
  return Array.isArray(content) ? content.map((item) => item.text || '').join('') : (content || '');
}

function isOpenAICompatibleEndpoint(config: APIConfig) {
  const baseUrl = config.baseUrl.toLowerCase();
  if (config.provider === 'google') return baseUrl.includes('/openai');
  if (config.provider === 'alibaba') return baseUrl.includes('compatible-mode');
  return false;
}

function usesOpenAICompatibleChatApi(config: APIConfig) {
  if (isOpenAICompatibleEndpoint(config)) return true;
  return ['openai', 'xai', 'deepseek', 'moonshot', 'minimax', 'bytedance', 'custom'].includes(config.provider);
}

async function parseSSEStream(
  response: Response,
  onData: (parsed: Record<string, unknown>) => void,
) {
  if (!response.ok || !response.body) {
    const errorText = await response.text().catch(() => '');
    throw new Error(errorText || `Streaming request failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        const lines = part.split('\n').map((line) => line.trim()).filter(Boolean);
        const dataLines = lines.filter((line) => line.startsWith('data:'));

        for (const line of dataLines) {
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          onData(JSON.parse(data) as Record<string, unknown>);
        }
      }
    }
  } finally {
    decoder.decode();
    reader.releaseLock();
  }
}

async function parseJsonResponse<T>(response: Response, fallbackPrefix: string): Promise<T> {
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(errorText || `${fallbackPrefix}: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function urlToBlob(value: string, fallbackMimeType = 'image/png') {
  const response = await fetch(value);
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(errorText || `Failed to load reference image: ${response.status}`);
  }
  const blob = await response.blob();
  return blob.type ? blob : new Blob([blob], { type: fallbackMimeType });
}

async function blobToBase64(blob: Blob) {
  const buffer = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function getBlobExtension(mimeType: string) {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('gif')) return 'gif';
  return 'png';
}

async function generateAnthropicResponse(
  config: APIConfig,
  systemPrompt: string,
  messages: ChatMessage[],
  onChunk?: (chunk: string) => void,
  options: GenerateResponseOptions = {},
) {
  const payload = splitSystemMessages(messages, systemPrompt);
  const endpoint = buildAnthropicUrl(config.baseUrl);
  const maxTokensConfig = options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens };

  if (onChunk) {
    let fullResponse = '';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.model,
        system: payload.systemPrompt || undefined,
        messages: payload.conversation.map((message) => ({
          role: message.role,
          content: buildAnthropicContent(message),
        })),
        ...maxTokensConfig,
        temperature: 0.8,
        stream: true,
      }),
      signal: options.signal,
    });

    await parseSSEStream(response, (parsed) => {
      const delta = parsed.delta as { text?: string } | undefined;
      if (parsed.type === 'content_block_delta' && delta?.text) {
        fullResponse += delta.text;
        onChunk(fullResponse);
      }
    });
    return fullResponse;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
      body: JSON.stringify({
        model: config.model,
        system: payload.systemPrompt || undefined,
        messages: payload.conversation.map((message) => ({
          role: message.role,
          content: buildAnthropicContent(message),
        })),
        ...maxTokensConfig,
        temperature: 0.8,
      }),
      signal: options.signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(errorText || `Anthropic request failed: ${response.status}`);
  }

  const result = await response.json() as { content?: Array<{ type?: string; text?: string }> };
  return result.content?.filter((item) => item.type === 'text').map((item) => item.text || '').join('') || '';
}

async function generateGeminiResponse(
  config: APIConfig,
  systemPrompt: string,
  messages: ChatMessage[],
  onChunk?: (chunk: string) => void,
  options: GenerateResponseOptions = {},
) {
  const payload = splitSystemMessages(messages, systemPrompt);
  const query = `key=${encodeURIComponent(config.apiKey)}${onChunk ? '&alt=sse' : ''}`;
  const endpoint = `${buildGeminiUrl(config.baseUrl, config.model, Boolean(onChunk))}?${query}`;
  const maxOutputTokens = options.maxTokens === undefined ? undefined : options.maxTokens;
  const requestBody = {
    systemInstruction: payload.systemPrompt
      ? { parts: [{ text: payload.systemPrompt }] }
      : undefined,
    contents: payload.conversation.map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: buildGeminiParts(message),
    })),
    generationConfig: {
      temperature: 0.8,
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
      responseMimeType: options.responseFormat === 'json' ? 'application/json' : undefined,
    },
  };

  if (onChunk) {
    let fullResponse = '';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: options.signal,
    });

    await parseSSEStream(response, (parsed) => {
      const candidates = parsed.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
      const text = candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
      if (text) {
        fullResponse += text;
        onChunk(fullResponse);
      }
    });
    return fullResponse;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
    signal: options.signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(errorText || `Gemini request failed: ${response.status}`);
  }

  const result = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return result.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
}

async function generateZhipuResponse(
  config: APIConfig,
  systemPrompt: string,
  messages: ChatMessage[],
  onChunk?: (chunk: string) => void,
  options: GenerateResponseOptions = {},
) {
  const endpoint = buildZhipuUrl(config.baseUrl);
  const maxTokensConfig = options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens };
  const requestBody = {
    model: config.model,
    messages: buildOpenAICompatibleMessages(messages, systemPrompt),
    temperature: 0.8,
    ...maxTokensConfig,
    stream: Boolean(onChunk),
    response_format: options.responseFormat === 'json' ? { type: 'json_object' } : undefined,
  };

  if (onChunk) {
    let fullResponse = '';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: options.signal,
    });

    await parseSSEStream(response, (parsed) => {
      const choices = parsed.choices as Array<{ delta?: { content?: string } }> | undefined;
      const content = choices?.[0]?.delta?.content || '';
      if (content) {
        fullResponse += content;
        onChunk(fullResponse);
      }
    });
    return fullResponse;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal: options.signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(errorText || `Zhipu request failed: ${response.status}`);
  }

  const result = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return result.choices?.[0]?.message?.content || '';
}

async function generateQwenResponse(
  config: APIConfig,
  systemPrompt: string,
  messages: ChatMessage[],
  onChunk?: (chunk: string) => void,
  options: GenerateResponseOptions = {},
) {
  const endpoint = buildQwenUrl(config.baseUrl);
  const maxTokensConfig = options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens };
  const requestBody = {
    model: config.model,
    input: {
      messages: buildQwenMessages(messages, systemPrompt),
    },
    parameters: {
      temperature: 0.8,
      ...maxTokensConfig,
      incremental_output: Boolean(onChunk),
      result_format: 'message',
      response_format: options.responseFormat === 'json' ? { type: 'json_object' } : undefined,
    },
  };

  if (onChunk) {
    let fullResponse = '';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
        'X-DashScope-SSE': 'enable',
      },
      body: JSON.stringify(requestBody),
      signal: options.signal,
    });

    await parseSSEStream(response, (parsed) => {
      const output = parsed.output as {
        choices?: Array<{ message?: { content?: Array<{ text?: string }> | string } }>;
      } | undefined;
      const content = output?.choices?.[0]?.message?.content;
      const text = Array.isArray(content)
        ? content.map((item) => item.text || '').join('')
        : (typeof content === 'string' ? content : '');
      if (text) {
        fullResponse = text;
        onChunk(fullResponse);
      }
    });
    return fullResponse;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal: options.signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(errorText || `Qwen request failed: ${response.status}`);
  }

  const result = await response.json() as {
    output?: { choices?: Array<{ message?: { content?: Array<{ text?: string }> | string } }> };
  };
  const content = result.output?.choices?.[0]?.message?.content;
  return Array.isArray(content) ? content.map((item) => item.text || '').join('') : (typeof content === 'string' ? content : '');
}

async function generateOpenAICompatibleResponse(
  config: APIConfig,
  systemPrompt: string,
  messages: ChatMessage[],
  onChunk?: (chunk: string) => void,
  options: GenerateResponseOptions = {},
) {
  const endpoint = buildOpenAICompatibleChatUrl(config.baseUrl);
  const maxTokensConfig = options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens };
  const requestBody = {
    model: config.model,
    messages: buildOpenAICompatibleMessages(messages, systemPrompt),
    stream: Boolean(onChunk),
    ...maxTokensConfig,
    temperature: 0.8,
    response_format: options.responseFormat === 'json' ? { type: 'json_object' } : undefined,
  };

  if (onChunk) {
    let fullResponse = '';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    await parseSSEStream(response, (parsed) => {
      const choices = parsed.choices as Array<{ delta?: { content?: string } }> | undefined;
      const content = choices?.[0]?.delta?.content || '';
      if (content) {
        fullResponse += content;
        onChunk(fullResponse);
      }
    });
    return fullResponse;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  const result = await parseJsonResponse<{
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  } & Record<string, JSONValue>>(response, 'OpenAI-compatible request failed');
  const content = result.choices?.[0]?.message?.content;
  return Array.isArray(content) ? content.map((item) => item.text || '').join('') : (content || '');
}

async function generateOfficialResponse(
  config: APIConfig,
  systemPrompt: string,
  messages: ChatMessage[],
  onChunk?: (chunk: string) => void,
  options: GenerateResponseOptions = {},
) {
  const requestBody = {
    provider: resolveOfficialBackendProvider(config.provider),
    model: config.model,
    messages: buildOfficialMessages(messages, systemPrompt),
    stream: Boolean(onChunk),
    max_tokens: options.maxTokens,
    response_format: options.responseFormat === 'json' ? { type: 'json_object' } : undefined,
    metadata: options.aiUsage ? { aiUsage: options.aiUsage } : undefined,
  };
  const response = await fetch('/api/ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify(requestBody),
    signal: options.signal,
  });

  if (response.status === 401) {
    dispatchAuthSessionExpired({ status: response.status, path: '/api/ai/v1/chat/completions' });
  }

  if (onChunk) {
    let fullResponse = '';
    await parseSSEStream(response, (parsed) => {
      const choices = parsed.choices as Array<{ delta?: { content?: string } }> | undefined;
      const content = choices?.[0]?.delta?.content || '';
      if (content) {
        fullResponse += content;
        onChunk(fullResponse);
      }
    });
    return fullResponse;
  }

  return parseOfficialProxyResponse(response);
}

const providerHandlers: Partial<Record<APIConfig['provider'], typeof generateOpenAICompatibleResponse>> = {
  official: generateOfficialResponse,
  'official-deepseek': generateOfficialResponse,
  'official-gpt': generateOfficialResponse,
  'official-moacode': generateOfficialResponse,
  openai: generateOpenAICompatibleResponse,
  anthropic: generateAnthropicResponse,
  google: generateGeminiResponse,
  xai: generateOpenAICompatibleResponse,
  deepseek: generateOpenAICompatibleResponse,
  alibaba: generateQwenResponse,
  zhipu: generateZhipuResponse,
  moonshot: generateOpenAICompatibleResponse,
  minimax: generateOpenAICompatibleResponse,
  bytedance: generateOpenAICompatibleResponse,
  custom: generateOpenAICompatibleResponse,
};

async function listOpenAICompatibleModels(config: APIConfig) {
  const normalizedBase = trimTrailingSlashes(config.baseUrl);
  const modelUrl = normalizedBase.endsWith('/models')
    ? normalizedBase
    : normalizedBase.endsWith('/chat/completions')
      ? normalizedBase.replace(/\/chat\/completions$/, '/models')
      : joinUrl(normalizedBase, '/models');
  const response = await fetch(modelUrl, {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
  });
  const result = await parseJsonResponse<{ data?: Array<{ id?: string }> }>(response, 'Model list request failed');
  return (result.data || [])
    .map((item) => item.id)
    .filter((id): id is string => Boolean(id))
    .map((id) => ({ id, label: id }));
}

async function listOfficialModels(config: APIConfig): Promise<AvailableModelInfo[]> {
  const provider = resolveOfficialBackendProvider(config.provider);
  const response = await fetch(`/api/ai/models?provider=${encodeURIComponent(provider)}`, {
    headers: getAuthHeaders(),
  });
  if (response.status === 401) {
    dispatchAuthSessionExpired({ status: response.status, path: '/api/ai/models' });
  }
  const result = await parseJsonResponse<{ items?: Array<{ id?: string; label?: string; metadata?: JSONValue }> }>(response, 'Official model list request failed');
  return (result.items || [])
    .filter((item): item is { id: string; label?: string; metadata?: JSONValue } => Boolean(item.id))
    .map((item) => ({ id: item.id, label: item.label || item.id, raw: item.metadata }));
}

async function listAnthropicModels(config: APIConfig) {
  const response = await fetch(joinUrl(config.baseUrl, '/models'), {
    headers: {
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
  });
  const result = await parseJsonResponse<{ data?: Array<{ id?: string; display_name?: string }> }>(response, 'Anthropic model list request failed');
  return (result.data || [])
    .filter((item): item is { id: string; display_name?: string } => Boolean(item.id))
    .map((item) => ({ id: item.id, label: item.display_name || item.id }));
}

async function listGeminiModels(config: APIConfig) {
  const response = await fetch(`${joinUrl(config.baseUrl, '/models')}?key=${encodeURIComponent(config.apiKey)}`);
  const result = await parseJsonResponse<{ models?: Array<{ name?: string; displayName?: string }> }>(response, 'Gemini model list request failed');
  return (result.models || [])
    .filter((item): item is { name: string; displayName?: string } => Boolean(item.name))
    .map((item) => {
      const id = item.name.replace(/^models\//, '');
      return { id, label: item.displayName || id };
    });
}

async function listQwenModels(config: APIConfig) {
  return listOpenAICompatibleModels({
    ...config,
    baseUrl: config.baseUrl.includes('compatible-mode') ? config.baseUrl : joinUrl(config.baseUrl, '/compatible-mode/v1'),
  });
}

export async function listAvailableModels(config: APIConfig): Promise<AvailableModelInfo[]> {
  if (isOfficialProvider(config.provider)) {
    return listOfficialModels(config);
  }
  if (config.provider === 'microsoft') {
    return [
      { id: 'zh-CN-XiaoxiaoNeural', label: 'zh-CN-XiaoxiaoNeural' },
      { id: 'zh-CN-YunxiNeural', label: 'zh-CN-YunxiNeural' },
      { id: 'zh-CN-YunjianNeural', label: 'zh-CN-YunjianNeural' },
      { id: 'zh-CN-XiaoyiNeural', label: 'zh-CN-XiaoyiNeural' },
      { id: 'en-US-JennyNeural', label: 'en-US-JennyNeural' },
      { id: 'en-US-GuyNeural', label: 'en-US-GuyNeural' },
    ];
  }
  if (isOpenAICompatibleEndpoint(config)) {
    return listOpenAICompatibleModels(config);
  }

  switch (config.provider) {
    case 'anthropic':
      return listAnthropicModels(config);
    case 'google':
      return listGeminiModels(config);
    case 'alibaba':
      return listQwenModels(config);
    default:
      return listOpenAICompatibleModels(config);
  }
}

async function generateOpenAICompatibleImage(config: APIConfig, options: ImageGenerationOptions): Promise<GeneratedImage[]> {
  if (options.referenceImages?.length) {
    const formData = new FormData();
    formData.append('model', config.model);
    formData.append('prompt', options.prompt);
    formData.append('n', String(options.count || 1));
    formData.append('size', options.size || '1024x1024');
    formData.append('response_format', 'b64_json');

    for (const [index, reference] of options.referenceImages.entries()) {
      const blob = await urlToBlob(reference.url, reference.mimeType || 'image/png');
      formData.append('image[]', blob, `reference-${index + 1}.${getBlobExtension(reference.mimeType || blob.type || 'image/png')}`);
    }

    const response = await fetch(buildOpenAICompatibleImageEditUrl(config.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
      signal: options.signal,
      body: formData,
    });

    const result = await parseJsonResponse<{
      data?: Array<{ b64_json?: string; revised_prompt?: string; url?: string }>;
    }>(response, 'Image edit request failed');

    const images: GeneratedImage[] = [];
    for (const item of result.data || []) {
      if (item.b64_json) {
        images.push({
          mimeType: 'image/png',
          dataUrl: encodeDataUrl('image/png', item.b64_json),
          revisedPrompt: item.revised_prompt,
          url: item.url,
        });
        continue;
      }

      if (item.url) {
        images.push({
          mimeType: 'image/png',
          dataUrl: item.url,
          revisedPrompt: item.revised_prompt,
          url: item.url,
        });
      }
    }
    return images;
  }

  const response = await fetch(buildOpenAICompatibleImageUrl(config.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    signal: options.signal,
    body: JSON.stringify({
      model: config.model,
      prompt: options.prompt,
      n: options.count || 1,
      size: options.size || '1024x1024',
      response_format: 'b64_json',
      negative_prompt: options.negativePrompt || undefined,
      seed: options.seed ?? undefined,
    }),
  });

  const result = await parseJsonResponse<{
    data?: Array<{ b64_json?: string; revised_prompt?: string; url?: string }>;
  }>(response, 'Image generation request failed');

  const images: GeneratedImage[] = [];
  for (const item of result.data || []) {
    if (item.b64_json) {
      images.push({
        mimeType: 'image/png',
        dataUrl: encodeDataUrl('image/png', item.b64_json),
        revisedPrompt: item.revised_prompt,
        url: item.url,
      });
      continue;
    }

    if (item.url) {
      images.push({
        mimeType: 'image/png',
        dataUrl: item.url,
        revisedPrompt: item.revised_prompt,
        url: item.url,
      });
    }
  }
  return images;
}

async function generateGeminiImage(config: APIConfig, options: ImageGenerationOptions): Promise<GeneratedImage[]> {
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [{ text: options.prompt }];
  for (const reference of options.referenceImages || []) {
    const dataUrl = reference.url.startsWith('data:')
      ? reference.url
      : encodeDataUrl(reference.mimeType || 'image/png', await blobToBase64(await urlToBlob(reference.url, reference.mimeType || 'image/png')));
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
    }
  }

  const response = await fetch(`${buildGeminiUrl(config.baseUrl, config.model, false)}?key=${encodeURIComponent(config.apiKey)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    signal: options.signal,
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    }),
  });

  const result = await parseJsonResponse<{
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }>;
  }>(response, 'Gemini image generation request failed');

  const images: GeneratedImage[] = [];
  for (const candidate of result.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      const mimeType = part.inlineData?.mimeType;
      const data = part.inlineData?.data;
      if (mimeType && data) {
        images.push({
          mimeType,
          dataUrl: encodeDataUrl(mimeType, data),
        });
      }
    }
  }
  return images;
}

export async function generateImage(config: APIConfig, options: ImageGenerationOptions): Promise<GeneratedImage[]> {
  if (isOpenAICompatibleEndpoint(config)) {
    return generateOpenAICompatibleImage(config, options);
  }

  switch (config.provider) {
    case 'google':
      return generateGeminiImage(config, options);
    default:
      return generateOpenAICompatibleImage(config, options);
  }
}

async function synthesizeOpenAICompatibleSpeech(config: APIConfig, options: SpeechSynthesisOptions): Promise<SpeechSynthesisResult> {
  const response = await fetch(buildOpenAICompatibleSpeechUrl(config.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      input: options.input,
      voice: options.voice || 'alloy',
      response_format: options.format || 'mp3',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(errorText || `Speech synthesis request failed: ${response.status}`);
  }

  const blob = await response.blob();
  return {
    mimeType: blob.type || guessAudioMimeType(options.format),
    blob,
    objectUrl: createObjectUrl(blob),
  };
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function synthesizeMicrosoftSpeech(config: APIConfig, options: SpeechSynthesisOptions): Promise<SpeechSynthesisResult> {
  const voice = options.voice || config.model || 'zh-CN-XiaoxiaoNeural';
  const ssml = `<speak version="1.0" xml:lang="zh-CN"><voice name="${escapeXml(voice)}">${escapeXml(options.input)}</voice></speak>`;
  const response = await fetch(buildMicrosoftSpeechUrl(config), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/ssml+xml',
      'Ocp-Apim-Subscription-Key': config.apiKey,
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'Pneumata',
    },
    body: ssml,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(errorText || `Microsoft speech request failed: ${response.status}`);
  }

  const blob = await response.blob();
  return {
    mimeType: blob.type || 'audio/mpeg',
    blob,
    objectUrl: createObjectUrl(blob),
  };
}

async function synthesizeGeminiSpeech(config: APIConfig, options: SpeechSynthesisOptions): Promise<SpeechSynthesisResult> {
  const response = await fetch(`${buildGeminiUrl(config.baseUrl, config.model, false)}?key=${encodeURIComponent(config.apiKey)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: options.input }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: options.voice ? { voiceConfig: { prebuiltVoiceConfig: { voiceName: options.voice } } } : undefined,
      },
    }),
  });

  const result = await parseJsonResponse<{
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }>;
  }>(response, 'Gemini speech request failed');

  const audioPart = result.candidates?.flatMap((candidate) => candidate.content?.parts || []).find((part) => part.inlineData?.data);
  const mimeType = audioPart?.inlineData?.mimeType || guessAudioMimeType(options.format);
  const base64 = audioPart?.inlineData?.data;
  if (!base64) {
    throw new Error('Gemini speech request returned no audio data');
  }

  const blob = await fetch(encodeDataUrl(mimeType, base64)).then((res) => res.blob());
  return {
    mimeType,
    blob,
    objectUrl: createObjectUrl(blob),
  };
}

export async function synthesizeSpeech(config: APIConfig, options: SpeechSynthesisOptions): Promise<SpeechSynthesisResult> {
  if (config.provider === 'microsoft') {
    return synthesizeMicrosoftSpeech(config, options);
  }
  if (isOpenAICompatibleEndpoint(config)) {
    return synthesizeOpenAICompatibleSpeech(config, options);
  }

  switch (config.provider) {
    case 'google':
      return synthesizeGeminiSpeech(config, options);
    default:
      return synthesizeOpenAICompatibleSpeech(config, options);
  }
}

export async function transcribeAudio(config: APIConfig, options: AudioTranscriptionOptions): Promise<AudioTranscriptionResult> {
  const formData = new FormData();
  formData.append('model', config.model);
  formData.append('file', options.file, options.fileName || 'audio.webm');
  if (options.prompt) formData.append('prompt', options.prompt);
  if (options.language) formData.append('language', options.language);

  const response = await fetch(buildOpenAICompatibleTranscriptionUrl(config.baseUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: formData,
  });

  const result = await parseJsonResponse<{ text?: string } & Record<string, JSONValue>>(response, 'Audio transcription request failed');
  return {
    text: result.text || '',
    raw: result,
  };
}

export const generateResponse = async (
  config: APIConfig,
  systemPrompt: string,
  messages: ChatMessage[],
  onChunk?: (chunk: string) => void,
  options: GenerateResponseOptions = {},
): Promise<string> => {
  if (isOfficialProvider(config.provider)) {
    return generateOfficialResponse(config, systemPrompt, messages, onChunk, options);
  }
  if (isOpenAICompatibleEndpoint(config)) {
    return generateOpenAICompatibleResponse(config, systemPrompt, messages, onChunk, options);
  }
  const handler = providerHandlers[config.provider] || generateOpenAICompatibleResponse;
  return handler(config, systemPrompt, messages, onChunk, options);
};

export const generateJsonResponse = async (
  config: APIConfig,
  systemPrompt: string,
  messages: ChatMessage[],
  options: GenerateResponseOptions = {},
): Promise<string> => {
  const jsonPrompt = `${systemPrompt}\n\nThe response must be exactly one valid JSON object. Do not wrap it in markdown.`;
  const jsonOptions: GenerateResponseOptions = { ...options, responseFormat: 'json' };

  try {
    if (isOfficialProvider(config.provider)) {
      return await generateOfficialResponse(config, jsonPrompt, messages, undefined, jsonOptions);
    }

    if (usesOpenAICompatibleChatApi(config)) {
      return await generateOpenAICompatibleResponse(config, jsonPrompt, messages, undefined, jsonOptions);
    }

    if (config.provider === 'zhipu') {
      return await generateZhipuResponse(config, jsonPrompt, messages, undefined, jsonOptions);
    }

    if (config.provider === 'alibaba') {
      return await generateQwenResponse(config, jsonPrompt, messages, undefined, jsonOptions);
    }

    if (config.provider === 'google') {
      return await generateGeminiResponse(config, jsonPrompt, messages, undefined, jsonOptions);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/response_format|json_object|json/i.test(message)) throw error;
  }

  const handler = providerHandlers[config.provider] || generateOpenAICompatibleResponse;
  return handler(config, jsonPrompt, messages, undefined, options);
};

async function testTextLikeConnection(config: APIConfig) {
  await generateResponse(config, 'You are a connection test.', [{ role: 'user', content: 'Hello' }], undefined, {
    aiUsage: { type: 'model_test', label: '测试连接' },
  });
}

async function testMetadataConnection(config: APIConfig) {
  await listAvailableModels(config);
}

export interface AIConnectionTestResult {
  success: boolean;
  error?: unknown;
}

export const testConnection = async (config: MaybeTypedConfig): Promise<AIConnectionTestResult> => {
  try {
    if (config.provider === 'microsoft') {
      await synthesizeMicrosoftSpeech(config, { input: 'connection test', voice: config.model });
      return { success: true };
    }
    if (config.type === 'image' || config.type === 'audio') {
      await testMetadataConnection(config);
    } else {
      await testTextLikeConnection(config);
    }
    return { success: true };
  } catch (error) {
    console.error('AI connection test failed:', error);
    return { success: false, error };
  }
};

export function isLikelyBrowserCorsError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /failed to fetch/i.test(message) || /cors/i.test(message);
}
