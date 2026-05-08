import { BUILT_IN_BUBBLE_STYLES, DEFAULT_AI_BUBBLE_STYLE_ID } from '../constants/bubbleStyles';
import type { BubbleStyleDefinition, BubbleStylePreview, BubbleStyleFormValues } from '../types/bubbleStyle';

export function chooseRandomBubbleStyleId(params: {
  allCharacters: Array<{ group?: string | null; bubbleStyleId?: string | null }>;
  generatedGroup: string | null;
  customStyleIds: string[];
}) {
  const usedOutsideGroup = new Set(
    params.allCharacters
      .filter((character) => (character.group || null) !== params.generatedGroup)
      .map((character) => character.bubbleStyleId || DEFAULT_AI_BUBBLE_STYLE_ID)
  );

  const allStyleIds = [...params.customStyleIds, ...BUILT_IN_BUBBLE_STYLES.map((style) => style.id)];
  const available = allStyleIds.filter((id) => !usedOutsideGroup.has(id));
  const pool = available.length ? available : allStyleIds;
  if (!pool.length) return DEFAULT_AI_BUBBLE_STYLE_ID;
  return pool[Math.floor(Math.random() * pool.length)] || DEFAULT_AI_BUBBLE_STYLE_ID;
}

export function resolveCharacterBubbleStyle(params: {
  bubbleStyle?: BubbleStyleDefinition | null;
  bubbleStyleId?: string | null;
  customStyles?: BubbleStyleDefinition[];
}) {
  if (params.bubbleStyle) {
    return { ...params.bubbleStyle, id: params.bubbleStyle.id || params.bubbleStyleId || DEFAULT_AI_BUBBLE_STYLE_ID };
  }
  return resolveBubbleStyle(params.bubbleStyleId, params.customStyles || []);
}

export function toBubbleStyleFormValues(style: BubbleStyleDefinition): BubbleStyleFormValues {
  return {
    name: style.name,
    backgroundColor: style.backgroundColor,
    textColor: style.textColor,
    borderColor: style.borderColor,
    borderWidth: style.borderWidth,
    borderStyle: style.borderStyle,
    radius: style.radius,
    shadow: style.shadow,
    gradientFrom: style.gradientFrom || '',
    gradientTo: style.gradientTo || '',
    gradientDirection: style.gradientDirection || '135deg',
  };
}

export function createCharacterBubbleStyleId() {
  return `character-bubble-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function cloneBubbleStyle(style: BubbleStyleDefinition | null | undefined) {
  return style ? { ...style } : null;
}

function shadowValue(shadow: BubbleStyleDefinition['shadow']) {
  switch (shadow) {
    case 'none':
      return 'none';
    case 'medium':
      return '0 4px 12px rgba(0,0,0,0.14)';
    case 'strong':
      return '0 8px 20px rgba(0,0,0,0.22)';
    case 'soft':
    default:
      return '0 1px 3px rgba(0,0,0,0.10)';
  }
}

export function buildBubbleBackground(style: BubbleStyleDefinition) {
  if (style.gradientFrom && style.gradientTo) {
    return `linear-gradient(${style.gradientDirection || '135deg'}, ${style.gradientFrom}, ${style.gradientTo})`;
  }
  return style.backgroundColor;
}

export function buildBubblePreview(style: BubbleStyleDefinition, isUser = false): BubbleStylePreview {
  return {
    background: buildBubbleBackground(style),
    color: style.textColor,
    border: `${style.borderWidth}px ${style.borderStyle} ${style.borderColor}`,
    borderRadius: isUser ? `${style.radius}px ${style.radius}px 6px ${style.radius}px` : `${style.radius}px ${style.radius}px ${style.radius}px 6px`,
    boxShadow: shadowValue(style.shadow),
  };
}

export function resolveBubbleStyle(styleId: string | null | undefined, customStyles: BubbleStyleDefinition[] = []) {
  const allStyles = [...customStyles, ...BUILT_IN_BUBBLE_STYLES];
  return allStyles.find((item) => item.id === styleId) || BUILT_IN_BUBBLE_STYLES.find((item) => item.id === DEFAULT_AI_BUBBLE_STYLE_ID)!;
}
