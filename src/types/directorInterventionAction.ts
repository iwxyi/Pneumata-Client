import type { SessionActionField } from './sessionEngine';

export type DirectorInterventionPreset = 'conversation' | 'interview' | 'deduction';

const BASE_INTENT_OPTIONS = [
  { label: '指定回应', value: 'force_reply' },
  { label: '升级推进', value: 'escalate' },
  { label: '降温收束', value: 'cool_down' },
  { label: '转移焦点', value: 'redirect' },
  { label: '总结局势', value: 'summarize' },
];

const PRESET_EXTRA_OPTIONS: Record<DirectorInterventionPreset, Array<{ label: string; value: string }>> = {
  conversation: [],
  interview: [],
  deduction: [{ label: '揭示信息', value: 'reveal' }],
};

export function buildDirectorInterventionIntentOptions(preset: DirectorInterventionPreset = 'conversation') {
  const seen = new Set<string>();
  return [...BASE_INTENT_OPTIONS, ...(PRESET_EXTRA_OPTIONS[preset] || [])].filter((option) => {
    if (seen.has(option.value)) return false;
    seen.add(option.value);
    return true;
  });
}

export function buildDirectorInterventionFields(params: {
  preset?: DirectorInterventionPreset;
  targetLabel: string;
  targetOptions: Array<{ label: string; value: string }>;
  promptLabel?: string;
  promptPlaceholder: string;
}): SessionActionField[] {
  return [
    { key: 'intent', label: '干预意图', type: 'single_select', required: true, options: buildDirectorInterventionIntentOptions(params.preset) },
    { key: 'targetId', label: params.targetLabel, type: 'single_select', options: params.targetOptions, targetSource: 'participants' },
    { key: 'maxTurns', label: '影响轮数', type: 'number', placeholder: '1' },
    { key: 'prompt', label: params.promptLabel || '推进说明', type: 'textarea', required: true, placeholder: params.promptPlaceholder },
  ];
}
