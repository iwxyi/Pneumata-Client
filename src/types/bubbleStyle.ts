export type BubbleBorderStyle = 'solid' | 'dashed' | 'dotted';
export type BubbleShadowLevel = 'none' | 'soft' | 'medium' | 'strong';
export type BubbleGradientDirection = '135deg' | '160deg' | '180deg';

export interface BubbleStyleDefinition {
  id: string;
  name: string;
  backgroundColor: string;
  textColor: string;
  borderColor: string;
  borderWidth: number;
  borderStyle: BubbleBorderStyle;
  radius: number;
  shadow: BubbleShadowLevel;
  gradientFrom?: string;
  gradientTo?: string;
  gradientDirection?: BubbleGradientDirection;
  isBuiltIn?: boolean;
}

export interface BubbleStylePreview {
  background: string;
  color: string;
  border: string;
  borderRadius: string;
  boxShadow: string;
}

export interface BubbleStyleFormValues {
  name: string;
  backgroundColor: string;
  textColor: string;
  borderColor: string;
  borderWidth: number;
  borderStyle: BubbleBorderStyle;
  radius: number;
  shadow: BubbleShadowLevel;
  gradientFrom: string;
  gradientTo: string;
  gradientDirection: BubbleGradientDirection;
}

export const DEFAULT_BUBBLE_STYLE_FORM: BubbleStyleFormValues = {
  name: '',
  backgroundColor: '#ffffff',
  textColor: '#111111',
  borderColor: '#e4e7ec',
  borderWidth: 1,
  borderStyle: 'solid',
  radius: 18,
  shadow: 'soft',
  gradientFrom: '',
  gradientTo: '',
  gradientDirection: '135deg',
};
