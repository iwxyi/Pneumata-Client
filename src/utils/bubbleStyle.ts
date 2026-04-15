import { BUILT_IN_BUBBLE_STYLES, DEFAULT_AI_BUBBLE_STYLE_ID } from '../constants/bubbleStyles';
import type { BubbleStyleDefinition, BubbleStylePreview } from '../types/bubbleStyle';

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
