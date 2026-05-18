import type { AIModelType, AIProvider } from '../types/settings';

export interface ProviderTypeDefaults {
  baseUrl: string;
  model: string;
}

export interface AIProviderCatalogEntry {
  key: AIProvider;
  label: string;
  family: string;
  defaults: Partial<Record<AIModelType, ProviderTypeDefaults>>;
  popularModels: Partial<Record<AIModelType, string[]>>;
}

export const AI_PROVIDER_CATALOG: AIProviderCatalogEntry[] = [
  {
    key: 'openai',
    label: 'OpenAI (GPT)',
    family: 'GPT',
    defaults: {
      text: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-5-mini' },
      image: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-1' },
      audio: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-audio-mini' },
      document: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-5-mini' },
    },
    popularModels: {
      text: ['gpt-5-mini', 'gpt-5', 'gpt-4.1', 'gpt-4.1-mini'],
      image: ['gpt-image-1'],
      audio: ['gpt-audio-mini', 'gpt-audio', 'gpt-4o-transcribe'],
      document: ['gpt-5-mini', 'gpt-5', 'gpt-4.1', 'gpt-4.1-mini'],
    },
  },
  {
    key: 'anthropic',
    label: 'Anthropic (Claude)',
    family: 'Claude',
    defaults: {
      text: { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-0' },
      document: { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-0' },
    },
    popularModels: {
      text: ['claude-sonnet-4-0', 'claude-3-7-sonnet-latest', 'claude-3-5-haiku-latest'],
      document: ['claude-sonnet-4-0', 'claude-3-7-sonnet-latest'],
    },
  },
  {
    key: 'google',
    label: 'Google (Gemini)',
    family: 'Gemini',
    defaults: {
      text: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash' },
      image: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.0-flash-preview-image-generation' },
      audio: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash-preview-tts' },
      document: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash' },
    },
    popularModels: {
      text: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
      image: ['gemini-2.0-flash-preview-image-generation'],
      audio: ['gemini-2.5-flash-preview-tts', 'gemini-2.0-flash-live-001'],
      document: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-1.5-pro'],
    },
  },
  {
    key: 'xai',
    label: 'xAI (Grok)',
    family: 'Grok',
    defaults: {
      text: { baseUrl: 'https://api.x.ai/v1', model: 'grok-3-mini-beta' },
      image: { baseUrl: 'https://api.x.ai/v1', model: 'grok-2-image' },
      document: { baseUrl: 'https://api.x.ai/v1', model: 'grok-3-beta' },
    },
    popularModels: {
      text: ['grok-3-beta', 'grok-3-mini-beta', 'grok-2-latest'],
      image: ['grok-2-image'],
      document: ['grok-3-beta', 'grok-2-latest'],
    },
  },
  {
    key: 'deepseek',
    label: 'DeepSeek',
    family: 'DeepSeek',
    defaults: {
      text: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
      document: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    },
    popularModels: {
      text: ['deepseek-chat', 'deepseek-reasoner'],
      document: ['deepseek-chat', 'deepseek-reasoner'],
    },
  },
  {
    key: 'alibaba',
    label: 'Alibaba (Qwen)',
    family: 'Qwen',
    defaults: {
      text: { baseUrl: 'https://dashscope.aliyuncs.com/api/v1', model: 'qwen-plus' },
      image: { baseUrl: 'https://dashscope.aliyuncs.com/api/v1', model: 'wanx2.1-t2i-turbo' },
      audio: { baseUrl: 'https://dashscope.aliyuncs.com/api/v1', model: 'qwen-tts' },
      document: { baseUrl: 'https://dashscope.aliyuncs.com/api/v1', model: 'qwen-long' },
    },
    popularModels: {
      text: ['qwen-max', 'qwen-plus', 'qwen-turbo'],
      image: ['wanx2.1-t2i-plus', 'wanx2.1-t2i-turbo'],
      audio: ['qwen-tts'],
      document: ['qwen-long', 'qwen-plus'],
    },
  },
  {
    key: 'zhipu',
    label: 'Zhipu (GLM)',
    family: 'GLM',
    defaults: {
      text: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.5-air' },
      image: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'cogview-3-flash' },
      document: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.5-air' },
    },
    popularModels: {
      text: ['glm-4.5', 'glm-4.5-air', 'glm-4-plus'],
      image: ['cogview-3-flash', 'cogview-3-plus'],
      document: ['glm-4.5', 'glm-4.5-air', 'glm-4-plus'],
    },
  },
  {
    key: 'moonshot',
    label: 'Moonshot (Kimi)',
    family: 'Kimi',
    defaults: {
      text: { baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2.6' },
      document: { baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2.6' },
    },
    popularModels: {
      text: ['kimi-k2.6', 'kimi-k2', 'moonshot-v1-8k'],
      document: ['kimi-k2.6', 'kimi-k2', 'moonshot-v1-128k'],
    },
  },
  {
    key: 'minimax',
    label: 'MiniMax',
    family: 'MiniMax',
    defaults: {
      text: { baseUrl: 'https://api.minimax.chat/v1', model: 'MiniMax-Text-01' },
      audio: { baseUrl: 'https://api.minimax.chat/v1', model: 'speech-02-hd' },
      document: { baseUrl: 'https://api.minimax.chat/v1', model: 'MiniMax-Text-01' },
    },
    popularModels: {
      text: ['MiniMax-Text-01', 'abab6.5s-chat'],
      audio: ['speech-02-hd', 'speech-01-turbo'],
      document: ['MiniMax-Text-01', 'abab6.5s-chat'],
    },
  },
  {
    key: 'bytedance',
    label: 'ByteDance (Doubao)',
    family: 'Doubao',
    defaults: {
      text: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-pro-32k' },
      image: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seedream-3.0' },
      audio: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-voice' },
      document: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-pro-32k' },
    },
    popularModels: {
      text: ['doubao-pro-32k', 'doubao-lite-32k', 'doubao-1.5-pro-32k'],
      image: ['doubao-seedream-3.0'],
      audio: ['doubao-voice'],
      document: ['doubao-pro-32k', 'doubao-1.5-pro-32k'],
    },
  },
  {
    key: 'microsoft',
    label: 'Microsoft Azure Speech',
    family: 'Azure Speech',
    defaults: {
      audio: { baseUrl: 'https://eastasia.tts.speech.microsoft.com/cognitiveservices/v1', model: 'zh-CN-XiaoxiaoNeural' },
    },
    popularModels: {
      audio: ['zh-CN-XiaoxiaoNeural', 'zh-CN-YunxiNeural', 'zh-CN-YunjianNeural', 'zh-CN-XiaoyiNeural', 'en-US-JennyNeural', 'en-US-GuyNeural'],
    },
  },
  {
    key: 'custom',
    label: 'Custom',
    family: 'Custom',
    defaults: {
      text: { baseUrl: '', model: '' },
      image: { baseUrl: '', model: '' },
      audio: { baseUrl: '', model: '' },
      document: { baseUrl: '', model: '' },
    },
    popularModels: {
      text: [],
      image: [],
      audio: [],
      document: [],
    },
  },
];

export function getProviderCatalogEntry(provider: AIProvider) {
  return AI_PROVIDER_CATALOG.find((item) => item.key === provider) || AI_PROVIDER_CATALOG[0];
}

export function getProvidersForType(type: AIModelType) {
  return AI_PROVIDER_CATALOG.filter((item) => item.defaults[type]);
}

export function getProviderDefaults(provider: AIProvider, type: AIModelType) {
  const entry = getProviderCatalogEntry(provider);
  return entry.defaults[type] || { baseUrl: '', model: '' };
}

export function getPopularModels(provider: AIProvider, type: AIModelType) {
  const entry = getProviderCatalogEntry(provider);
  return entry.popularModels[type] || [];
}
