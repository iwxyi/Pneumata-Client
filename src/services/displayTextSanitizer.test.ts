import { describe, expect, it } from 'vitest';
import { sanitizeUserFacingText } from './displayTextSanitizer';

describe('sanitizeUserFacingText', () => {
  it('removes runtime json, ids, and common English reasons', () => {
    const text = sanitizeUserFacingText(
      'relationship:a->b · Relationship ledger has become salient · {"eventType":"room_state_snapshot_v2","summary":"heat"} · e055aa1d-88d4-4e96-abd2-1b35a3d56f67 · salience 74%',
      [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }],
    );

    expect(text).toContain('线索');
    expect(text).toContain('关系账本中的变化已经足够显著');
    expect(text).toContain('系统事件');
    expect(text).not.toContain('eventType');
    expect(text).not.toContain('e055aa1d');
    expect(text).not.toContain('salience');
  });

  it('localizes internal memory labels', () => {
    expect(sanitizeUserFacingText('episodic / status_shift / memory_candidate')).toBe('片段记忆 / 状态变化 / 记忆候选');
  });

  it('replaces long member ids without leaking replace offsets', () => {
    const text = sanitizeUserFacingText(
      '3c78729f-e52d-4dde-b27f-01a949960bb8b 提到了 8b3d7266-c0c7-4ceb-8dc2-45126f3f2321',
      [
        { id: '3c78729f-e52d-4dde-b27f-01a949960bb8b', name: '喜羊羊' },
        { id: '8b3d7266-c0c7-4ceb-8dc2-45126f3f2321', name: '沸羊羊' },
      ],
    );

    expect(text).toBe('喜羊羊 提到了 沸羊羊');
  });
});
