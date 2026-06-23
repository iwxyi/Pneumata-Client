import type { ChatStyle } from '../types/chat';

export interface ChatStyleDefinition {
  value: ChatStyle;
  icon: string;
  label: {
    zh: string;
    en: string;
  };
  description: {
    zh: string;
    en: string;
  };
  promptDescription: string;
}

export const CHAT_STYLE_DEFINITIONS: ChatStyleDefinition[] = [
  {
    value: 'free',
    icon: 'C',
    label: {
      zh: '轻松闲聊',
      en: 'Casual chat',
    },
    description: {
      zh: '自然接话，适合日常陪伴、轻话题和低压力交流。',
      en: 'Natural back-and-forth for everyday company and low-pressure topics.',
    },
    promptDescription:
      'Casual room: keep the conversation natural, warm, and easy to join. Use everyday phrasing, respond to the current emotional texture, and avoid over-structuring unless the user asks for it.',
  },
  {
    value: 'debate',
    icon: 'D',
    label: {
      zh: '深度讨论',
      en: 'Deep discussion',
    },
    description: {
      zh: '围绕问题推进观点、证据、反驳和取舍，不做空泛争吵。',
      en: 'Develop positions, evidence, counterpoints, and tradeoffs without empty arguing.',
    },
    promptDescription:
      'Deep discussion room: examine the topic through clear claims, reasons, evidence, counterpoints, and tradeoffs. Challenge weak assumptions respectfully, and move the discussion toward sharper understanding rather than performative conflict.',
  },
  {
    value: 'brainstorm',
    icon: 'I',
    label: {
      zh: '共创点子',
      en: 'Co-create ideas',
    },
    description: {
      zh: '快速发散、接力补强，再把可执行方向收拢出来。',
      en: 'Explore alternatives, build on them, then converge on usable directions.',
    },
    promptDescription:
      'Co-creation room: generate varied possibilities, build on other participants ideas, make unexpected but relevant connections, and periodically separate raw ideas from actionable next steps. Do not prematurely dismiss unusual ideas.',
  },
  {
    value: 'roleplay',
    icon: 'R',
    label: {
      zh: '沉浸演绎',
      en: 'Immersive roleplay',
    },
    description: {
      zh: '保持角色动机、关系和场景连续性，像真实场面一样推进。',
      en: 'Stay in character and advance the scene through motives, relationships, and consequences.',
    },
    promptDescription:
      'Immersive roleplay room: stay inside the character voice and situation. Drive the scene through motives, relationships, sensory details, and consequences while preserving continuity with prior events.',
  },
];

export const CHAT_STYLE_PROMPT_DESCRIPTIONS: Record<ChatStyle, string> = CHAT_STYLE_DEFINITIONS.reduce(
  (acc, definition) => {
    acc[definition.value] = definition.promptDescription;
    return acc;
  },
  {} as Record<ChatStyle, string>,
);

export function getChatStyleOption(style: ChatStyle) {
  return CHAT_STYLE_DEFINITIONS.find((definition) => definition.value === style) || CHAT_STYLE_DEFINITIONS[0];
}
