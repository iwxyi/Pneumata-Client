import { createTheme, type ThemeOptions } from '@mui/material/styles';

const baseTheme: ThemeOptions = {
  typography: {
    fontFamily: [
      '"Source Han Sans SC"',
      '"Noto Sans SC"',
      '"PingFang SC"',
      '"Microsoft YaHei"',
      '-apple-system',
      'BlinkMacSystemFont',
      '"Segoe UI"',
      'Roboto',
      '"Helvetica Neue"',
      'Arial',
      'sans-serif',
    ].join(','),
  },
  shape: {
    borderRadius: 8,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: 8,
          fontWeight: 500,
          boxShadow: 'none',
        },
        contained: {
          boxShadow: 'none',
        },
      },
    },
    MuiCard: {
      defaultProps: {
        elevation: 0,
      },
      styleOverrides: {
        root: {
          borderRadius: 8,
          transition: 'transform 180ms ease, box-shadow 180ms ease, background-color 180ms ease',
        },
      },
    },
    MuiFab: {
      styleOverrides: {
        root: {
          borderRadius: '50%',
          boxShadow: '0 6px 16px rgba(0,0,0,0.18)',
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 8,
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        variant: 'outlined',
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 8,
        },
      },
    },
    MuiToggleButtonGroup: {
      styleOverrides: {
        root: {
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
        },
        grouped: {
          margin: 0,
          border: 0,
          borderRadius: 999,
        },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          textTransform: 'none',
          paddingInline: 16,
          minHeight: 36,
          border: '1px solid',
          borderColor: 'rgba(0,0,0,0.12)',
          backgroundColor: 'transparent',
          '&.Mui-selected': {
            borderColor: 'rgba(0,0,0,0.16)',
          },
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        indicator: {
          height: 3,
          borderRadius: 999,
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          minHeight: 44,
        },
      },
    },
    MuiSnackbarContent: {
      styleOverrides: {
        root: {
          borderRadius: 8,
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 8,
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: ({ theme }) => ({
          borderRadius: 8,
          border: '1px solid',
          borderColor: theme.palette.mode === 'light' ? 'rgba(15, 23, 42, 0.10)' : 'rgba(226, 232, 240, 0.12)',
          backgroundColor: theme.palette.mode === 'light' ? 'rgba(255, 255, 255, 0.72)' : 'rgba(20, 22, 30, 0.76)',
          backdropFilter: 'blur(22px) saturate(1.18)',
          WebkitBackdropFilter: 'blur(22px) saturate(1.18)',
          boxShadow: theme.palette.mode === 'light' ? '0 18px 44px rgba(15, 23, 42, 0.16)' : '0 20px 52px rgba(0, 0, 0, 0.38)',
        }),
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          margin: 4,
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          transition: 'background-color 160ms ease, transform 160ms ease',
        },
      },
    },
    MuiAvatar: {
      styleOverrides: {
        root: {
          transition: 'transform 180ms ease, box-shadow 180ms ease',
        },
      },
    },
    MuiCardActionArea: {
      styleOverrides: {
        root: {
          borderRadius: 'inherit',
        },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: {
          opacity: 0.6,
        },
      },
    },
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundAttachment: 'fixed',
        },
        '::selection': {
          background: 'rgba(43, 92, 255, 0.18)',
        },
        '*': {
          scrollbarWidth: 'thin',
        },
      },
    },
    MuiCollapse: {
      styleOverrides: {
        root: {
          transitionDuration: '180ms',
        },
      },
    },
    MuiSlider: {
      styleOverrides: {
        root: {
          transition: 'transform 160ms ease',
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          transition: 'background-color 160ms ease, transform 160ms ease',
        },
      },
    },
    MuiBottomNavigationAction: {
      styleOverrides: {
        root: {
          transition: 'transform 160ms ease, color 160ms ease',
        },
      },
    },
    MuiTypography: {
      styleOverrides: {
        root: {
          transition: 'color 160ms ease',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          transition: 'box-shadow 180ms ease, background-color 180ms ease',
        },
      },
    },
    MuiSkeleton: {
      styleOverrides: {
        root: {
          borderRadius: 6,
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          borderRadius: 12,
        },
      },
    },
    MuiBadge: {
      styleOverrides: {
        badge: {
          borderRadius: 999,
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: ({ theme }) => ({
          borderRadius: 10,
          border: '1px solid',
          borderColor: theme.palette.mode === 'light' ? 'rgba(15, 23, 42, 0.10)' : 'rgba(226, 232, 240, 0.12)',
          backgroundColor: theme.palette.mode === 'light' ? 'rgba(255, 255, 255, 0.78)' : 'rgba(20, 22, 30, 0.82)',
          backdropFilter: 'blur(24px) saturate(1.18)',
          WebkitBackdropFilter: 'blur(24px) saturate(1.18)',
        }),
      },
    },
    MuiSelect: {
      defaultProps: {
        variant: 'outlined',
      },
    },
    MuiFormControl: {
      styleOverrides: {
        root: {
          transition: 'opacity 160ms ease',
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          transition: 'color 160ms ease, transform 160ms ease',
        },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: {
          borderRadius: 999,
        },
      },
    },
    MuiCircularProgress: {
      styleOverrides: {
        root: {
          transition: 'opacity 160ms ease',
        },
      },
    },
    MuiAccordion: {
      styleOverrides: {
        root: {
          borderRadius: 8,
        },
      },
    },
    MuiAccordionSummary: {
      styleOverrides: {
        root: {
          minHeight: 56,
        },
      },
    },
    MuiAccordionDetails: {
      styleOverrides: {
        root: {
          paddingTop: 0,
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          borderRadius: '10px 10px 0 0',
          backdropFilter: 'blur(24px) saturate(1.16)',
          WebkitBackdropFilter: 'blur(24px) saturate(1.16)',
        },
      },
    },
  },
};

export const createAppTheme = (mode: 'light' | 'dark', primaryColor: string = '#315A9C') => {
  return createTheme({
    ...baseTheme,
    palette: {
      mode,
      primary: {
        main: primaryColor,
      },
      secondary: {
        main: mode === 'light' ? '#334155' : '#CBD5E1',
      },
      background: {
        default: mode === 'light' ? '#F5F5F7' : '#0A0A0F',
        paper: mode === 'light' ? 'rgba(255,255,255,0.86)' : 'rgba(20, 22, 30, 0.82)',
      },
      ...(mode === 'light'
        ? {
            surface: {
              main: '#ffffff',
            },
          }
        : {
            surface: {
              main: '#1f1f1f',
            },
          }),
    },
  });
};

declare module '@mui/material/styles' {
  interface Palette {
    surface: Palette['primary'];
  }
  interface PaletteOptions {
    surface?: PaletteOptions['primary'];
  }
}
