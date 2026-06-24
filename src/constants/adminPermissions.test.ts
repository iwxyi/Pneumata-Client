import { describe, expect, it } from 'vitest';
import { ADMIN_DASHBOARD_PERMISSIONS, ADMIN_PERMISSION_CODES, adminHasAnyPermission, adminHasPermission } from './adminPermissions';
import type { AdminUser } from '../services/adminApi';

function adminWithPermissions(permissions: string[]): AdminUser {
  return {
    id: 'admin-1',
    email: 'admin@example.com',
    displayName: 'Admin',
    status: 'active',
    roleCodes: [],
    permissions,
  };
}

describe('admin permission helpers', () => {
  it('treats admin.all as access to every module', () => {
    const admin = adminWithPermissions([ADMIN_PERMISSION_CODES.adminAll]);

    expect(adminHasPermission(admin, ADMIN_PERMISSION_CODES.aiRead)).toBe(true);
    expect(adminHasAnyPermission(admin, [ADMIN_PERMISSION_CODES.billingRead])).toBe(true);
  });

  it('matches direct permissions and rejects missing permissions', () => {
    const admin = adminWithPermissions([ADMIN_PERMISSION_CODES.usersRead]);

    expect(adminHasPermission(admin, ADMIN_PERMISSION_CODES.usersRead)).toBe(true);
    expect(adminHasPermission(admin, ADMIN_PERMISSION_CODES.riskRead)).toBe(false);
    expect(adminHasAnyPermission(null, [ADMIN_PERMISSION_CODES.usersRead])).toBe(false);
  });

  it('keeps dashboard reachable for every read-only admin module', () => {
    expect(ADMIN_DASHBOARD_PERMISSIONS).toEqual(expect.arrayContaining([
      ADMIN_PERMISSION_CODES.usersRead,
      ADMIN_PERMISSION_CODES.sharesReview,
      ADMIN_PERMISSION_CODES.aiRead,
      ADMIN_PERMISSION_CODES.billingRead,
      ADMIN_PERMISSION_CODES.notificationsRead,
      ADMIN_PERMISSION_CODES.riskRead,
      ADMIN_PERMISSION_CODES.auditRead,
    ]));
  });
});
