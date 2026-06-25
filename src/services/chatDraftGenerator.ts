import { generateResponse } from './aiClient';
import type { APIConfig } from '../types/settings';
import type { AICharacter } from '../types/character';
import type { ChatStyle } from '../types/chat';
import { CHAT_STYLE_OPTIONS, MAX_MEMBERS } from '../constants/defaults';
import {
  ROOM_TEMPLATES,
  getRoomTemplateKernel,
  getRoomTemplatePresetDescription,
  getRoomTemplatePresetLabel,
  type RoomTemplateKey,
} from './roomTemplates';
const VALID_TEMPLATE_KEYS = new Set<RoomTemplateKey>(ROOM_TEMPLATES.map((item) => item.key));
const TEMPLATE_SUMMARY = ROOM_TEMPLATES.map((item) => {
  const kernel = getRoomTemplateKernel(item);
  return {
    key: item.key,
    label: getRoomTemplatePresetLabel(item),
    description: getRoomTemplatePresetDescription(item),
    gameplay: kernel.label,
    category: kernel.categoryLabel,
    kind: item.parentTemplateKey ? 'preset' : 'custom',
  };
});

const VALID_STYLES = new Set<ChatStyle>(CHAT_STYLE_OPTIONS.map((item) => item.value));

export interface GeneratedChatDraftSuggestion {
  suggestedName?: string;
  suggestedTopic?: string;
  suggestedStyle?: ChatStyle;
  suggestedMemberIds?: string[];
  suggestedShowRoleActions?: boolean;
  suggestedRoomTemplate?: RoomTemplateKey;
}

interface RawGeneratedChatDraftSuggestion {
  suggestedName?: unknown;
  suggestedTopic?: unknown;
  suggestedStyle?: unknown;
  suggestedMemberIds?: unknown;
  suggestedShowRoleActions?: unknown;
  suggestedRoomTemplate?: unknown;
}

interface GenerateChatDraftParams {
  config: APIConfig;
  language: 'zh' | 'en';
  draft: {
    name: string;
    topic: string;
    selectedMemberIds: string[];
    showRoleActions: boolean;
  };
  characters: AICharacter[];
}

const CHAT_DRAFT_SYSTEM_PROMPT = `You complete a group chat draft from partial user input.
Return strict JSON only in this shape:
{
  "suggestedName": "string",
  "suggestedTopic": "string",
  "suggestedStyle": "free|debate|brainstorm|roleplay",
  "suggestedMemberIds": ["character-id-1", "character-id-2"],
  "suggestedShowRoleActions": true,
  "suggestedRoomTemplate": "open_chat"
}
Rules:
- Use only character ids from the provided roster.
- Keep user-provided information aligned; fill the missing parts instead of contradicting the input.
- Choose a topic and member combination that would produce an interesting conversation.
- Choose suggestedRoomTemplate from validRoomTemplates. Items with kind="custom" mean the user will write their own setup for that gameplay type; choose a concrete preset only when the user's intent clearly matches that preset.
- Keep the title and topic concise and usable.
- Never invent ids, fields, or explanations.
- Output valid JSON only.`;

function trimString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function extractJsonObject(content: string) {
  const cleaned = content.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

function parseGeneratedSuggestion(content: string) {
  return JSON.parse(extractJsonObject(content)) as RawGeneratedChatDraftSuggestion;
}

function normalizeGeneratedSuggestion(raw: RawGeneratedChatDraftSuggestion, characters: AICharacter[]): GeneratedChatDraftSuggestion {
  const validCharacterIds = new Set(characters.map((character) => character.id));
  const suggestedName = trimString(raw.suggestedName);
  const suggestedTopic = trimString(raw.suggestedTopic);
  const suggestedStyle = trimString(raw.suggestedStyle) as ChatStyle;
  const suggestedMemberIds = Array.isArray(raw.suggestedMemberIds)
    ? [...new Set(raw.suggestedMemberIds.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter((item) => validCharacterIds.has(item)))].slice(0, MAX_MEMBERS)
    : [];

  const suggestedRoomTemplate = trimString(raw.suggestedRoomTemplate) as RoomTemplateKey;
  return {
    suggestedName: suggestedName || undefined,
    suggestedTopic: suggestedTopic || undefined,
    suggestedStyle: VALID_STYLES.has(suggestedStyle) ? suggestedStyle : undefined,
    suggestedMemberIds: suggestedMemberIds.length ? suggestedMemberIds : undefined,
    suggestedShowRoleActions: typeof raw.suggestedShowRoleActions === 'boolean' ? raw.suggestedShowRoleActions : undefined,
    suggestedRoomTemplate: VALID_TEMPLATE_KEYS.has(suggestedRoomTemplate) ? suggestedRoomTemplate : undefined,
  };
}

function buildCharacterRoster(characters: AICharacter[]) {
  return characters.map((character) => ({
    id: character.id,
    name: character.name,
    speakingStyle: character.speakingStyle,
    background: character.background,
    expertise: character.expertise,
    isPreset: character.isPreset,
  }));
}

function buildUserPrompt(params: GenerateChatDraftParams) {
  const { draft, language, characters } = params;
  const payload = {
    language,
    constraints: {
      maxMembers: MAX_MEMBERS,
      validStyles: Array.from(VALID_STYLES),
      validRoomTemplates: TEMPLATE_SUMMARY,
    },
    currentDraft: {
      name: draft.name.trim() || null,
      topic: draft.topic.trim() || null,
      selectedMemberIds: draft.selectedMemberIds,
      showRoleActions: draft.showRoleActions,
    },
    roster: buildCharacterRoster(characters),
  };

  return language === 'zh'
    ? `请根据当前群聊草稿补全缺失字段。保留用户已提供的信息，不要乱改。只返回合法 JSON。\n${JSON.stringify(payload, null, 2)}`
    : `Complete the missing group chat draft fields while preserving user-provided intent. Return valid JSON only.\n${JSON.stringify(payload, null, 2)}`;
}

export async function generateChatDraftSuggestion(params: GenerateChatDraftParams) {
  const response = await generateResponse(
    params.config,
    `${CHAT_DRAFT_SYSTEM_PROMPT}\nOutput exactly one valid JSON object. Do not add markdown fences or explanations.`,
    [{ role: 'user', content: buildUserPrompt(params) }],
    undefined,
    { aiUsage: { type: 'chat_draft', label: '生成群聊草稿', scope: 'chat' } },
  );

  return normalizeGeneratedSuggestion(parseGeneratedSuggestion(response), params.characters);
}
