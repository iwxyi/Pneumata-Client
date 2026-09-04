import { describe, expect, it } from 'vitest';
import { resolvePlatformCapabilities } from './platformCapabilities';

describe('platform capabilities', () => {
  it('disables native operations on web and mobile', () => {
    expect(resolvePlatformCapabilities('web').commandExecution).toBe(false);
    expect(resolvePlatformCapabilities('ios').workspaceRead).toBe(false);
  });
  it('exposes file and office support for electron', () => {
    const capabilities = resolvePlatformCapabilities('electron');
    expect(capabilities.workspaceWrite).toBe(true);
    expect(capabilities.officeTransform).toBe(true);
  });
});
