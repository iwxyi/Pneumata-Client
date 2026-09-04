import { describe, expect, it } from 'vitest';
import { resolvePlatformCapabilities } from './platformCapabilities';

describe('office transform provider', () => {
  it('reports unsupported on web', () => {
    expect(resolvePlatformCapabilities('web').officeTransform).toBe(false);
  });
});
