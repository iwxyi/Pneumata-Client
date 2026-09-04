import { describe, expect, it } from 'vitest';
import { createLocalWorkspaceMutationPlan, isLocalWorkspaceMutationPlanValid } from './localWorkspaceService';

describe('workspace mutation plans', () => {
  it('creates expiring confirmation plans', () => {
    const plan = createLocalWorkspaceMutationPlan('a', [{ kind: 'delete', path: 'x.txt' }]);
    expect(plan.id).toContain('workspace-plan-');
    expect(isLocalWorkspaceMutationPlanValid(plan)).toBe(true);
  });
});
