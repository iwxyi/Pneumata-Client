import { Alert, Box, Button, LinearProgress, Stack, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { adminHasAnyPermission } from '../../constants/adminPermissions';
import { useAdminAuthStore } from '../../stores/useAdminAuthStore';

export default function AdminPermissionGate({
  permissions,
  children,
}: {
  permissions: string[];
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const admin = useAdminAuthStore((s) => s.admin);
  const isLoading = useAdminAuthStore((s) => s.isLoading);

  if (isLoading && !admin) {
    return (
      <Box sx={{ pt: 1 }}>
        <LinearProgress sx={{ borderRadius: 999 }} />
      </Box>
    );
  }

  if (!adminHasAnyPermission(admin, permissions)) {
    return (
      <Stack spacing={2}>
        <Alert severity="warning">当前管理员没有访问该模块的权限。</Alert>
        <Typography variant="body2" color="text.secondary">
          请切换具备对应权限的后台账号，或联系超级管理员调整角色。
        </Typography>
        <Box>
          <Button variant="outlined" onClick={() => navigate('/admin')}>返回总览</Button>
        </Box>
      </Stack>
    );
  }

  return <>{children}</>;
}
