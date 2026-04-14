import OpenAI from 'openai';
import type { APIConfig } from '../types/settings';

let clientInstance: OpenAI | null = null;
let currentConfig: string = '';

export const getAIClient = (config: APIConfig): OpenAI => {
  const configKey = JSON.stringify(config);
  if (clientInstance && currentConfig === configKey) {
    return clientInstance;
  }

  clientInstance = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    dangerouslyAllowBrowser: true,
  });
  currentConfig = configKey;
  return clientInstance;
};

export const generateResponse = async (
  config: APIConfig,
  systemPrompt: string,
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[],
  onChunk?: (chunk: string) => void
): Promise<string> => {
  const client = getAIClient(config);

  if (onChunk) {
    // Streaming mode
    const stream = await client.chat.completions.create({
      model: config.model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      stream: true,
      max_tokens: 500,
      temperature: 0.8,
    });

    let fullResponse = '';
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      fullResponse += content;
      onChunk(fullResponse);
    }
    return fullResponse;
  } else {
    // Non-streaming mode
    const response = await client.chat.completions.create({
      model: config.model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      max_tokens: 500,
      temperature: 0.8,
    });
    return response.choices[0]?.message?.content || '';
  }
};

export const testConnection = async (config: APIConfig): Promise<boolean> => {
  try {
    const client = getAIClient(config);
    await client.chat.completions.create({
      model: config.model,
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 5,
    });
    return true;
  } catch {
    return false;
  }
};
