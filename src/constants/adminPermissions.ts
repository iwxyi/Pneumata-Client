import type { AdminUser } from '../services/adminApi';

export const ADMIN_PERMISSION_CODES = {
  adminAll: 'admin.all',
  usersRead: 'users.read',
  usersManage: 'users.manage',
  sharesReview: 'shares.review',
  sharesModerate: 'shares.moderate',
  aiRead: 'ai.read',
  aiManage: 'ai.manage',
  billingRead: 'billing.read',
  billingManage: 'billing.manage',
  notificationsRead: 'notifications.read',
  notificationsManage: 'notifications.manage',
  riskRead: 'risk.read',
  riskManage: 'risk.manage',
  auditRead: 'audit.read',
} as const;

export function adminHasPermission(admin: AdminUser | null, permission: string) {
  const permissions = admin?.permissions || [];
  return permissions.includes(ADMIN_PERMISSION_CODES.adminAll) || permissions.includes(permission);
}

export function adminHasAnyPermission(admin: AdminUser | null, permissions: string[]) {
  return permissions.some((permission) => adminHasPermission(admin, permission));
}

export const ADMIN_DASHBOARD_PERMISSIONS = [
  ADMIN_PERMISSION_CODES.usersRead,
  ADMIN_PERMISSION_CODES.sharesReview,
  ADMIN_PERMISSION_CODES.aiRead,
  ADMIN_PERMISSION_CODES.billingRead,
  ADMIN_PERMISSION_CODES.notificationsRead,
  ADMIN_PERMISSION_CODES.riskRead,
  ADMIN_PERMISSION_CODES.auditRead,
];
