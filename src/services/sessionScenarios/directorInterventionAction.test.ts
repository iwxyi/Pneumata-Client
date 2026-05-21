import { describe, expect, it } from 'vitest';
import { buildDirectorInterventionFields, buildDirectorInterventionIntentOptions } from './directorInterventionAction';

describe('directorInterventionAction', () => {
  it('builds shared director intervention fields', () => {
    const fields = buildDirectorInterventionFields({
      preset: 'interview',
      targetLabel: '影响对象',
      targetOptions: [{ label: '候选人 1', value: 'candidate-a' }],
      promptPlaceholder: '进入追问轮次',
    });
    expect(fields.map((field) => field.key)).toEqual(['intent', 'targetId', 'maxTurns', 'prompt']);
    expect(fields.find((field) => field.key === 'targetId')?.label).toBe('影响对象');
    expect(fields.find((field) => field.key === 'targetId')?.options?.[0]?.value).toBe('candidate-a');
    expect(fields.find((field) => field.key === 'prompt')?.placeholder).toBe('进入追问轮次');
  });

  it('keeps reveal only for deduction-style interventions', () => {
    expect(buildDirectorInterventionIntentOptions('interview').map((option) => option.value)).not.toContain('reveal');
    expect(buildDirectorInterventionIntentOptions('deduction').map((option) => option.value)).toContain('reveal');
  });
});
