import { Alert } from '@mui/material';
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
  const driftItems = PARAM_KEYS
    .map((key) => ({ key, value: Number(drift?.[key] || 0) }))
    .filter((item) => Math.abs(item.value) >= 6)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 3);

  return (
    <>
      {driftItems.length ? <Alert severity="warning" sx={{ mb: 1.25 }}>当前人格偏移：{driftItems.map((item) => `${t(`character.${item.key}`)} ${item.value > 0 ? '+' : ''}${item.value}`).join(' / ')}</Alert> : null}
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
    </>
  );
}
