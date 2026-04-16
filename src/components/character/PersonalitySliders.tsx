import { useTranslation } from 'react-i18next';
import type { PersonalityParams } from '../../types/character';
import NumericSliders from './NumericSliders';

interface PersonalitySlidersProps {
  values: PersonalityParams;
  onChange: (params: PersonalityParams) => void;
  disabled?: boolean;
  drift?: Partial<PersonalityParams>;
}

const PARAM_KEYS: (keyof PersonalityParams)[] = [
  'openness',
  'extroversion',
  'agreeableness',
  'neuroticism',
  'humor',
  'creativity',
  'assertiveness',
  'empathy',
];

export default function PersonalitySliders({ values, onChange, disabled, drift }: PersonalitySlidersProps) {
  const { t } = useTranslation();

  return (
    <NumericSliders
      values={values}
      onChange={onChange}
      disabled={disabled}
      drift={drift}
      items={PARAM_KEYS.map((key) => ({
        key,
        label: t(`character.${key}`),
        description: `基础设置值 ${values[key]}，括号中的偏移代表角色长期运行后的自然变化。`,
      }))}
    />
  );
}
