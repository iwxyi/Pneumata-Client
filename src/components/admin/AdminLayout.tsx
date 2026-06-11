import { useState } from 'react';
import { AppBar, Box, Button, Drawer, IconButton, List, ListItemButton, ListItemText, Toolbar, Typography } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAdminAuthStore } from '../../stores/useAdminAuthStore';

const drawerWidth = 248;

const navItems = [
  { path: '/admin', label: '总览' },
  { path: '/admin/users', label: '用户' },
  { path: '/admin/ai', label: 'AI平台' },
  { path: '/admin/billing', label: '计费订单' },
  { path: '/admin/moderation', label: '分享审核' },
  { path: '/admin/notifications', label: '通知中心' },
  { path: '/admin/risk', label: '风控限制' },
  { path: '/admin/audit', label: '审计日志' },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const admin = useAdminAuthStore((s) => s.admin);
  const logout = useAdminAuthStore((s) => s.logout);
  const [mobileOpen, setMobileOpen] = useState(false);
  const currentTitle = navItems.find((item) => (item.path === '/admin' ? location.pathname === '/admin' : location.pathname.startsWith(item.path)))?.label || '后台';

  const navList = (
    <>
      <Toolbar>
        <Typography sx={{ fontWeight: 900 }}>后台模块</Typography>
      </Toolbar>
      <List sx={{ px: 1.25 }}>
        {navItems.map((item) => {
          const selected = item.path === '/admin' ? location.pathname === '/admin' : location.pathname.startsWith(item.path);
          return (
            <ListItemButton
              key={item.path}
              selected={selected}
              onClick={() => {
                navigate(item.path);
                setMobileOpen(false);
              }}
              sx={{ borderRadius: 2, mb: 0.5 }}
            >
              <ListItemText primary={item.label} />
            </ListItemButton>
          );
        })}
      </List>
    </>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100dvh', bgcolor: 'background.default' }}>
      <AppBar
        position="fixed"
        color="inherit"
        elevation={0}
        sx={{
          width: { lg: `calc(100% - ${drawerWidth}px)` },
          ml: { lg: `${drawerWidth}px` },
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Toolbar sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5, px: { xs: 2, sm: 3 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0, flex: 1 }}>
            <IconButton sx={{ display: { lg: 'none' } }} onClick={() => setMobileOpen(true)}>
              <MenuIcon />
            </IconButton>
            <Typography variant="subtitle1" sx={{ fontWeight: 800 }} noWrap>{currentTitle}</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0, flexShrink: 0 }}>
            <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: { xs: 120, sm: 220, md: 320 } }}>
              {admin?.displayName || admin?.email || 'Admin'}
            </Typography>
            <Button onClick={() => { logout(); navigate('/admin/login', { replace: true }); }}>退出</Button>
          </Box>
        </Toolbar>
      </AppBar>

      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{ display: { xs: 'block', lg: 'none' }, '& .MuiDrawer-paper': { width: drawerWidth, boxSizing: 'border-box' } }}
      >
        {navList}
      </Drawer>

      <Drawer
        variant="permanent"
        sx={{ display: { xs: 'none', lg: 'block' }, width: drawerWidth, flexShrink: 0, '& .MuiDrawer-paper': { width: drawerWidth, boxSizing: 'border-box' } }}
      >
        {navList}
      </Drawer>

      <Box component="main" sx={{ flex: 1, minWidth: 0, p: { xs: 2, sm: 3 }, pt: { xs: 2, sm: 3 } }}>
        <Toolbar />
        <Outlet />
      </Box>
    </Box>
  );
}
