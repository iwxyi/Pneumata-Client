import type { AICharacter, CharacterVisualReferenceImage } from '../types/character';
import type { APIConfig, AIModelProfile } from '../types/settings';
import { normalizeImageCapabilities } from '../types/settings';
import {
  generateImage,
  generateJsonResponse,
  generateResponse,
  synthesizeSpeech,
  transcribeAudio,
  type AudioTranscriptionOptions,
  type AudioTranscriptionResult,
  type GeneratedImage,
  type ImageGenerationOptions,
  type SpeechSynthesisOptions,
  type SpeechSynthesisResult,
} from './aiClient';

type ChatRole = 'user' | 'assistant' | 'system';
type ChatMessage = { role: ChatRole; content: string };

export type GenerationIntent =
  | 'chat-text'
  | 'chat-json'
  | 'chat-image'
  | 'chat-audio'
  | 'character-reference'
  | 'avatar'
  | 'audio-transcription';

export interface ImageReferenceInput {
  url: string;
  mimeType?: string;
  characterId?: string;
  label?: string;
}

export interface ImageGenerationAdapterOptions {
  profile: AIModelProfile;
  prompt: string;
  intent: GenerationIntent;
  count?: number;
  size?: string;
  negativePrompt?: string;
  seed?: string | number | null;
  referenceImages?: ImageReferenceInput[];
  character?: AICharacter | null;
  characters?: AICharacter[];
  allowCharacterReferenceImages?: boolean;
  signal?: AbortSignal;
}

export interface TextGenerationAdapterOptions {
  profile: AIModelProfile | APIConfig;
  systemPrompt: string;
  messages: ChatMessage[];
  onChunk?: (chunk: string) => void;
  maxTokens?: number;
}

export interface SpeechGenerationAdapterOptions extends SpeechSynthesisOptions {
  profile: AIModelProfile | APIConfig;
  intent?: GenerationIntent;
}

export interface AudioTranscriptionAdapterOptions extends AudioTranscriptionOptions {
  profile: AIModelProfile | APIConfig;
  intent?: GenerationIntent;
}

function profileToApi(profile: AIModelProfile | APIConfig): APIConfig {
  return {
    provider: profile.provider,
    apiKey: profile.apiKey,
    baseUrl: profile.baseUrl,
    model: profile.model,
  };
}

function isAIModelProfile(profile: AIModelProfile | APIConfig): profile is AIModelProfile {
  return 'id' in profile && 'type' in profile;
}

function shouldUseCharacterReferenceImages(prompt: string, intent: GenerationIntent) {
  if (intent === 'character-reference' || intent === 'avatar') return false;
  const normalized = prompt.toLowerCase();
  return /自拍|照片|合照|集体照|出镜|露脸|半身|全身|穿着|表情|pose|selfie|portrait|photo|group photo|wearing|face|person/.test(normalized);
}

function sortReferenceImages(images: CharacterVisualReferenceImage[], primaryId?: string | null) {
  return [...images].sort((a, b) => {
    const aPrimary = a.id === primaryId || a.isPrimary;
    const bPrimary = b.id === primaryId || b.isPrimary;
    if (aPrimary === bPrimary) return (b.createdAt || 0) - (a.createdAt || 0);
    return aPrimary ? -1 : 1;
  });
}

function collectCharacterReferenceImages(params: ImageGenerationAdapterOptions): ImageReferenceInput[] {
  if (!params.allowCharacterReferenceImages) return [];
  const characters = [
    ...(params.character ? [params.character] : []),
    ...(params.characters || []),
  ];
  const uniqueCharacters = Array.from(new Map(characters.map((character) => [character.id, character])).values());
  const references: ImageReferenceInput[] = [];

  for (const character of uniqueCharacters) {
    const visualIdentity = character.visualIdentity;
    if (!visualIdentity?.defaults?.useReferenceImages) continue;
    const images = sortReferenceImages(visualIdentity.referenceImages || [], visualIdentity.primaryReferenceImageId);
    for (const image of images) {
      if (!image.url) continue;
      references.push({
        url: image.url,
        mimeType: image.mimeType,
        characterId: character.id,
        label: image.label || character.name,
      });
    }
  }

  return references;
}

function appendVisualIdentityText(prompt: string, params: ImageGenerationAdapterOptions) {
  const characters = [
    ...(params.character ? [params.character] : []),
    ...(params.characters || []),
  ];
  const uniqueCharacters = Array.from(new Map(characters.map((character) => [character.id, character])).values());
  const hints = uniqueCharacters
    .map((character) => {
      const visual = character.visualIdentity;
      const parts = [
        visual?.description?.trim() ? `${character.name} visual identity: ${visual.description.trim()}` : '',
        visual?.styleHint?.trim() ? `${character.name} visual style: ${visual.styleHint.trim()}` : '',
      ].filter(Boolean);
      return parts.join('\n');
    })
    .filter(Boolean);
  return hints.length ? `${prompt}\n\nCharacter visual anchors:\n${hints.join('\n')}` : prompt;
}

function normalizeReferenceImages(params: ImageGenerationAdapterOptions): ImageReferenceInput[] {
  const requested = [
    ...(params.referenceImages || []),
    ...(shouldUseCharacterReferenceImages(params.prompt, params.intent) ? collectCharacterReferenceImages(params) : []),
  ].filter((item) => item.url);

  const unique = Array.from(new Map(requested.map((item) => [item.url, item])).values());
  const capabilities = normalizeImageCapabilities(isAIModelProfile(params.profile) ? params.profile.imageCapabilities : undefined);
  if (!capabilities.referenceImage) return [];
  return capabilities.multiReferenceImage ? unique : unique.slice(0, 1);
}

export function resolveImageGenerationRequest(params: ImageGenerationAdapterOptions): ImageGenerationOptions {
  const capabilities = normalizeImageCapabilities(params.profile.imageCapabilities);
  const referenceImages = normalizeReferenceImages(params);
  const canUseReferences = capabilities.referenceImage && referenceImages.length > 0;
  const prompt = canUseReferences ? params.prompt : appendVisualIdentityText(params.prompt, params);

  return {
    prompt,
    count: params.count,
    size: params.size,
    signal: params.signal,
    referenceImages: canUseReferences ? referenceImages.map(({ url, mimeType }) => ({ url, mimeType })) : undefined,
    negativePrompt: capabilities.negativePrompt ? params.negativePrompt : undefined,
    seed: capabilities.seed ? params.seed : undefined,
  };
}

export async function generateImageWithAdapter(params: ImageGenerationAdapterOptions): Promise<GeneratedImage[]> {
  return generateImage(profileToApi(params.profile), resolveImageGenerationRequest(params));
}

export async function generateTextWithAdapter(params: TextGenerationAdapterOptions): Promise<string> {
  return generateResponse(
    profileToApi(params.profile),
    params.systemPrompt,
    params.messages,
    params.onChunk,
    params.maxTokens === undefined ? undefined : { maxTokens: params.maxTokens },
  );
}

export async function generateJsonWithAdapter(params: Omit<TextGenerationAdapterOptions, 'onChunk' | 'maxTokens'>): Promise<string> {
  return generateJsonResponse(profileToApi(params.profile), params.systemPrompt, params.messages);
}

export async function synthesizeSpeechWithAdapter(params: SpeechGenerationAdapterOptions): Promise<SpeechSynthesisResult> {
  return synthesizeSpeech(profileToApi(params.profile), params);
}

export async function transcribeAudioWithAdapter(params: AudioTranscriptionAdapterOptions): Promise<AudioTranscriptionResult> {
  return transcribeAudio(profileToApi(params.profile), params);
}
