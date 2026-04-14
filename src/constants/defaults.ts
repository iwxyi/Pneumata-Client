import type { ChatStyle } from '../types/chat';

export const CHAT_STYLE_OPTIONS: { value: ChatStyle; icon: string }[] = [
  { value: 'free', icon: '💬' },
  { value: 'debate', icon: '⚔️' },
  { value: 'brainstorm', icon: '💡' },
  { value: 'roleplay', icon: '🎭' },
];

export const MIN_MEMBERS = 2;
export const MAX_MEMBERS = 10;

export const SPEED_MIN = 0.5;
export const SPEED_MAX = 2.0;
export const SPEED_STEP = 0.1;
export const SPEED_DEFAULT = 1.0;

export const BASE_COOLDOWN_MS = 3000;
export const MAX_HISTORY_FOR_PROMPT = 20;
export const EMOTION_MIN = -1;
export const EMOTION_MAX = 1;

export const BREAKPOINTS = {
  mobile: 600,
  tablet: 1024,
} as const;
