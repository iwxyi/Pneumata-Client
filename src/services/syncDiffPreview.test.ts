import { describe, expect, it } from 'vitest';
import { buildOperationsDiffPreview, buildPatchDiffPreview } from './syncDiffPreview';

describe('syncDiffPreview', () => {
  it('builds compact field previews and hides metadata fields', () => {
    expect(buildPatchDiffPreview({
      name: '新的角色名字',
      updatedAt: 123,
      fieldVersions: { name: 123 },
      background: '很长很长的背景说明'.repeat(20),
      deletedAt: null,
    }, { maxValueLength: 24 })).toEqual([
      { field: 'name', value: '新的角色名字' },
      { field: 'background', value: expect.stringContaining('...') },
      { field: 'deletedAt', value: 'null' },
    ]);
  });

  it('uses the latest pending operation for the same field', () => {
    expect(buildOperationsDiffPreview([
      { patch: { name: '第一次修改', topic: '主题' } },
      { patch: { name: '第二次修改' } },
    ])).toEqual([
      { field: 'name', value: '第二次修改' },
      { field: 'topic', value: '主题' },
    ]);
  });
});

