import { Box } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import type { SystemStyleObject } from '@mui/system';

export type AnimatedNavIconKind =
  | 'home'
  | 'chats'
  | 'files'
  | 'characters'
  | 'moments'
  | 'market'
  | 'calendar'
  | 'letters'
  | 'models'
  | 'proxy'
  | 'membership'
  | 'settings'
  | 'intro';

interface AnimatedNavIconProps {
  kind: AnimatedNavIconKind;
  active?: boolean;
  size?: number;
}

const iconSx: SystemStyleObject<Theme> = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 'var(--nav-icon-size)',
  height: 'var(--nav-icon-size)',
  color: 'inherit',
  pointerEvents: 'none',
  '--nav-icon-accent': (theme) => theme.palette.primary.main,
  '& svg': {
    display: 'block',
    overflow: 'visible',
    pointerEvents: 'none',
    transition: 'transform 160ms cubic-bezier(.2,0,0,1)',
  },
  '& path, & line, & circle, & rect, & polyline, & g': {
    pointerEvents: 'none',
    vectorEffect: 'non-scaling-stroke',
    transformBox: 'fill-box',
    transformOrigin: 'center',
    transition: [
      'fill-opacity 240ms ease',
      'opacity 240ms ease',
      'stroke-dashoffset 420ms cubic-bezier(.16,1,.3,1)',
      'transform 320ms cubic-bezier(.16,1,.3,1)',
    ].join(', '),
  },
  '& .surface, & .secondary-surface, & .detail-fill': {
    fill: 'none',
    fillOpacity: 0,
    stroke: 'currentColor',
    strokeWidth: 1.15,
    opacity: 0.32,
  },
  '& .accent-surface': {
    fill: 'none',
    fillOpacity: 0,
    stroke: 'var(--nav-icon-accent)',
    strokeWidth: 1.15,
    opacity: 0.28,
  },
  '& .accent': {
    stroke: 'var(--nav-icon-accent)',
    opacity: 0.84,
  },
  '& .nav-dot': {
    fill: 'currentColor',
    stroke: 'none',
  },
  '& .accent.nav-dot': {
    fill: 'var(--nav-icon-accent)',
  },
  '& .muted.nav-dot': {
    fill: 'currentColor',
    opacity: 0.58,
  },
  '& .model-node-ring': {
    strokeWidth: 1.22,
    opacity: 0.58,
  },
  '& .accent.model-node-ring': {
    opacity: 0.72,
  },
  '& .muted': {
    opacity: 0.58,
  },
  '& .secondary': {
    opacity: 0.72,
  },
  '& .muted.market-guide': {
    strokeWidth: 1.32,
    opacity: 0.78,
  },
  '&.is-active .accent, .PneumataNavButton:hover & .accent': {
    opacity: 1,
  },
  '&.is-active .muted, .PneumataNavButton:hover & .muted': {
    opacity: 0.78,
  },
  '&.is-active .secondary, .PneumataNavButton:hover & .secondary': {
    opacity: 0.86,
  },
  '&.is-active .model-node-ring, .PneumataNavButton:hover & .model-node-ring': {
    opacity: 0.78,
  },
  '&.is-active .accent.model-node-ring, .PneumataNavButton:hover & .accent.model-node-ring': {
    opacity: 0.88,
  },
  '&.is-active .muted.market-guide, .PneumataNavButton:hover & .muted.market-guide': {
    opacity: 0.9,
  },
  '@keyframes navHomeRoof': {
    '0%, 100%': { transform: 'translateY(0)' },
    '48%': { transform: 'translateY(-1.7px)' },
  },
  '@keyframes navHomeOrbit': {
    '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
    '50%': { transform: 'translate(0.8px, -1.2px) scale(1.06)' },
  },
  '@keyframes navHomeDoor': {
    '0%, 100%': { transform: 'scaleX(1)' },
    '48%': { transform: 'scaleX(0.76)' },
  },
  '@keyframes navTypingDot': {
    '0%, 100%': { transform: 'translateY(0)', opacity: 0.64 },
    '42%': { transform: 'translateY(-2px)', opacity: 1 },
  },
  '@keyframes navPersonStep': {
    '0%, 100%': { transform: 'translate(0, 0)' },
    '52%': { transform: 'translate(-1px, -0.7px)' },
  },
  '@keyframes navFocus': {
    '0%, 100%': { transform: 'scale(1)' },
    '50%': { transform: 'scale(1.16)' },
  },
  '@keyframes navMomentMountain': {
    '0%, 100%': { transform: 'translateY(0) scaleY(1)', strokeDashoffset: 0 },
    '45%': { transform: 'translateY(-0.9px) scaleY(1.05)', strokeDashoffset: -3.2 },
    '72%': { transform: 'translateY(-0.25px) scaleY(1.02)', strokeDashoffset: -4.8 },
  },
  '@keyframes navChatTailLeft': {
    '0%, 12%': { opacity: 1, transform: 'translateX(0) scale(1)' },
    '28%, 42%': { opacity: 0.18, transform: 'translate(0.8px, -0.3px) scale(0.82)' },
    '54%, 68%': { opacity: 1, transform: 'translateX(0) scale(1)' },
    '84%, 100%': { opacity: 0.18, transform: 'translate(0.8px, -0.3px) scale(0.82)' },
  },
  '@keyframes navChatTailRight': {
    '0%, 28%': { opacity: 0.05, transform: 'translate(-1px, -0.3px) scale(0.82)' },
    '42%, 56%': { opacity: 1, transform: 'translateX(0) scale(1)' },
    '70%, 84%': { opacity: 0.05, transform: 'translate(-1px, -0.3px) scale(0.82)' },
    '100%': { opacity: 0.05, transform: 'translate(-1px, -0.3px) scale(0.82)' },
  },
  '@keyframes navAwning': {
    '0%, 100%': { transform: 'translateY(0)' },
    '50%': { transform: 'translateY(-1.4px)' },
  },
  '@keyframes navCardLift': {
    '0%, 100%': { transform: 'translateY(0) scale(1)' },
    '48%': { transform: 'translateY(-1.2px) scale(1.03)' },
  },
  '@keyframes navStackShift': {
    '0%, 100%': { transform: 'translate(0, 0)' },
    '50%': { transform: 'translate(1px, -1px)' },
  },
  '@keyframes navStackNear': {
    '0%, 100%': { transform: 'translate(0, 0)' },
    '50%': { transform: 'translate(0.95px, -0.2px)' },
  },
  '@keyframes navStackMid': {
    '0%, 100%': { transform: 'translate(0, 0)' },
    '50%': { transform: 'translate(-0.75px, 0)' },
  },
  '@keyframes navStackFar': {
    '0%, 100%': { transform: 'translate(0, 0)' },
    '50%': { transform: 'translate(0.55px, 0.2px)' },
  },
  '@keyframes navFilesLift': {
    '0%, 100%': { transform: 'translateY(0)' },
    '48%': { transform: 'translateY(-1px)' },
  },
  '@keyframes navFilesTab': {
    '0%, 100%': { transform: 'translateX(0)', opacity: 0.72 },
    '50%': { transform: 'translateX(0.8px)', opacity: 1 },
  },
  '@keyframes navFilesLine': {
    '0%, 100%': { strokeDashoffset: 0, opacity: 0.72 },
    '45%': { strokeDashoffset: -2.5, opacity: 1 },
  },
  '@keyframes navMarketHandle': {
    '0%, 100%': { transform: 'translateY(0)' },
    '45%': { transform: 'translateY(-1px)' },
  },
  '@keyframes navMarkDraw': {
    '0%, 100%': { strokeDashoffset: 8, opacity: 0.5 },
    '45%, 70%': { strokeDashoffset: 0, opacity: 1 },
  },
  '@keyframes navEnvelopeOpen': {
    '0%, 100%': { transform: 'translateY(0) rotate(0deg)' },
    '45%, 62%': { transform: 'translateY(-2px) rotate(-5deg)' },
  },
  '@keyframes navModelFlow': {
    '0%, 100%': { strokeDashoffset: 9, opacity: 0.48 },
    '52%': { strokeDashoffset: 0, opacity: 1 },
  },
  '@keyframes navCorePulse': {
    '0%, 100%': { transform: 'scale(1)' },
    '50%': { transform: 'scale(1.13)' },
  },
  '@keyframes navNodeShift': {
    '0%, 100%': { transform: 'translateY(0)' },
    '50%': { transform: 'translateY(-1.1px)' },
  },
  '@keyframes navProxyFlow': {
    '0%, 100%': { strokeDashoffset: 10, opacity: 0.48 },
    '50%': { strokeDashoffset: 0, opacity: 1 },
  },
  '@keyframes navGatewayPulse': {
    '0%, 100%': { transform: 'scale(1)', opacity: 0.62 },
    '48%': { transform: 'scale(1.12)', opacity: 1 },
  },
  '@keyframes navGatewayLeft': {
    '0%, 100%': { transform: 'translateX(0)' },
    '50%': { transform: 'translateX(-0.75px)' },
  },
  '@keyframes navGatewayRight': {
    '0%, 100%': { transform: 'translateX(0)' },
    '50%': { transform: 'translateX(0.75px)' },
  },
  '@keyframes navPortPulse': {
    '0%, 100%': { transform: 'scale(1)', opacity: 0.62 },
    '50%': { transform: 'scale(1.12)', opacity: 1 },
  },
  '@keyframes navCrownShine': {
    '0%, 100%': { transform: 'translateY(0)', opacity: 0.72 },
    '52%': { transform: 'translateY(-1.4px)', opacity: 1 },
  },
  '@keyframes navCrownLift': {
    '0%, 100%': { transform: 'translateY(0) scale(1)' },
    '48%': { transform: 'translateY(-1.8px) scale(1.04)' },
  },
  '@keyframes navGemPulse': {
    '0%, 100%': { transform: 'scale(1)', opacity: 0.78 },
    '45%, 68%': { transform: 'scale(1.22)', opacity: 1 },
  },
  '@keyframes navBadgeGlow': {
    '0%, 100%': { transform: 'scale(1)', opacity: 0.72 },
    '52%': { transform: 'scale(1.08)', opacity: 1 },
  },
  '@keyframes navBadgeSweep': {
    '0%, 100%': { transform: 'translateX(0)', opacity: 0.56 },
    '50%': { transform: 'translateX(1.4px)', opacity: 1 },
  },
  '@keyframes navSliderA': {
    '0%, 100%': { transform: 'translateX(0)' },
    '36%': { transform: 'translateX(2.1px)' },
    '72%': { transform: 'translateX(-0.8px)' },
  },
  '@keyframes navSliderB': {
    '0%, 100%': { transform: 'translateX(0)' },
    '40%': { transform: 'translateX(-2.1px)' },
    '76%': { transform: 'translateX(1px)' },
  },
  '@keyframes navSliderC': {
    '0%, 100%': { transform: 'translateX(0)' },
    '38%': { transform: 'translateX(1.4px)' },
    '74%': { transform: 'translateX(-2.2px)' },
  },
  '@keyframes navSettingTrack': {
    '0%, 100%': { opacity: 0.48 },
    '50%': { opacity: 0.76 },
  },
  '@keyframes navNeedle': {
    '0%, 100%': { transform: 'translate(0, 0) scale(1)', opacity: 0.78 },
    '38%': { transform: 'translate(1.2px, -1.2px) scale(1.16)', opacity: 1 },
    '70%': { transform: 'translate(-0.4px, 0.5px) scale(0.96)', opacity: 0.86 },
  },
  '@keyframes navIntroPath': {
    '0%, 100%': { strokeDashoffset: 10, opacity: 0.5 },
    '42%, 72%': { strokeDashoffset: 0, opacity: 1 },
  },
  '& .home-roof': {
    animation: 'navHomeRoof 1.8s ease-in-out infinite',
  },
  '& .home-door': {
    animation: 'navHomeDoor 1.8s ease-in-out infinite',
  },
  '& .home-orbit': {
    animation: 'navHomeOrbit 1.8s ease-in-out infinite',
  },
  '& .typing-a': { animation: 'navTypingDot 960ms ease-in-out infinite' },
  '& .typing-b': { animation: 'navTypingDot 960ms ease-in-out 120ms infinite' },
  '& .typing-c': { animation: 'navTypingDot 960ms ease-in-out 240ms infinite' },
  '& .person-step': {
    animation: 'navPersonStep 1.55s ease-in-out infinite',
  },
  '& .focus-core': {
    animation: 'navFocus 1.45s ease-in-out infinite',
  },
  '& .moment-figure': {
    transformBox: 'view-box',
    transformOrigin: '12px 12px',
  },
  '& .moment-mountain': {
    transformBox: 'fill-box',
    transformOrigin: 'center bottom',
    strokeDasharray: 22,
    strokeDashoffset: 0,
    animation: 'navMomentMountain 1.7s cubic-bezier(.37,0,.2,1) infinite',
  },
  '& .awning': {
    animation: 'navAwning 1.55s ease-in-out infinite',
  },
  '& .market-card': {
    animation: 'navCardLift 1.45s ease-in-out infinite',
  },
  '& .market-stack': {
    animation: 'navStackShift 1.45s ease-in-out infinite',
  },
  '& .market-stack-near': {
    animation: 'navStackNear 1.45s ease-in-out infinite',
  },
  '& .market-stack-mid': {
    animation: 'navStackMid 1.55s ease-in-out infinite',
  },
  '& .market-stack-far': {
    animation: 'navStackFar 1.65s ease-in-out infinite',
  },
  '& .market-handle': {
    animation: 'navMarketHandle 1.45s ease-in-out infinite',
  },
  '& .files-folder': {
    transformBox: 'view-box',
    transformOrigin: '12px 13px',
    animation: 'navFilesLift 1.6s ease-in-out infinite',
  },
  '& .files-tab': {
    animation: 'navFilesTab 1.6s ease-in-out infinite',
  },
  '& .files-line': {
    strokeDasharray: 12,
    animation: 'navFilesLine 1.6s ease-in-out infinite',
  },
  '& .mark-draw': {
    animation: 'navMarkDraw 1.45s ease-in-out infinite',
  },
  '& .letter-flap': {
    animation: 'navEnvelopeOpen 1.55s ease-in-out infinite',
  },
  '& .model-flow': {
    animation: 'navModelFlow 1.35s ease-in-out infinite',
  },
  '& .core-pulse': {
    animation: 'navCorePulse 1.45s ease-in-out infinite',
  },
  '& .model-node-a, & .model-node-b': {
    animation: 'navNodeShift 1.45s ease-in-out infinite',
  },
  '& .model-node-b': {
    animationDelay: '120ms',
  },
  '& .proxy-flow': {
    animation: 'navProxyFlow 1.25s ease-in-out infinite',
  },
  '& .gateway-pulse': {
    animation: 'navGatewayPulse 1.35s ease-in-out infinite',
  },
  '& .gateway-left': {
    animation: 'navGatewayLeft 1.35s ease-in-out infinite',
  },
  '& .gateway-right': {
    animation: 'navGatewayRight 1.35s ease-in-out infinite',
  },
  '& .port-pulse': {
    animation: 'navPortPulse 1.35s ease-in-out infinite',
  },
  '& .badge-glow': {
    animation: 'navBadgeGlow 1.35s ease-in-out infinite',
  },
  '& .badge-sweep': {
    animation: 'navBadgeSweep 1.35s ease-in-out infinite',
  },
  '& .badge-lift': {
    animation: 'navCrownLift 1.45s ease-in-out infinite',
  },
  '& .crown-shine': {
    animation: 'navCrownShine 1.55s ease-in-out infinite',
  },
  '& .crown-lift': {
    animation: 'navCrownLift 1.45s ease-in-out infinite',
  },
  '& .gem-pulse': {
    animation: 'navGemPulse 1.2s ease-in-out infinite',
  },
  '& .setting-track': {
    animation: 'navSettingTrack 1.45s ease-in-out infinite',
  },
  '& .setting-a': {
    animation: 'navSliderA 1.35s cubic-bezier(.37,0,.2,1) infinite',
  },
  '& .setting-b': {
    animation: 'navSliderB 1.45s cubic-bezier(.37,0,.2,1) infinite',
  },
  '& .setting-c': {
    animation: 'navSliderC 1.55s cubic-bezier(.37,0,.2,1) infinite',
  },
  '& .intro-needle': {
    animation: 'navNeedle 1.6s ease-in-out infinite',
  },
  '& .intro-path': {
    animation: 'navIntroPath 1.6s ease-in-out infinite',
  },
  '& [class]': {
    animationPlayState: 'paused',
  },
  '.PneumataNavButton:hover & [class]': {
    animationPlayState: 'running',
  },
  '.PneumataNavButton:active & svg': {
    transform: 'scale(0.92)',
  },
  '.PneumataNavButton:active &.PneumataNavIcon-settings svg': {
    transform: 'scale(0.88) rotate(-4deg)',
  },
  '.PneumataNavButton:active &.PneumataNavIcon-settings .setting-a': {
    transform: 'translateX(2.6px) scale(0.9)',
  },
  '.PneumataNavButton:active &.PneumataNavIcon-settings .setting-b': {
    transform: 'translateX(-2.6px) scale(0.9)',
  },
  '.PneumataNavButton:active &.PneumataNavIcon-settings .setting-c': {
    transform: 'translateX(1.8px) scale(0.9)',
  },
  '@media (prefers-reduced-motion: reduce)': {
    '& path, & line, & circle, & rect, & polyline, & g, & svg': {
      animation: 'none !important',
      transition: 'none',
    },
  },
};

function iconPaths(kind: AnimatedNavIconKind) {
  switch (kind) {
    case 'home':
      return (
        <>
          <path className="surface" d="M6.5 11.2 12 6.4l5.5 4.8v6.4c0 .9-.6 1.5-1.5 1.5H8c-.9 0-1.5-.6-1.5-1.5Z" />
          <path className="home-roof" d="M4.8 11 12 5l7.2 6" />
          <path d="M6.7 10.8v6.8c0 .8.6 1.4 1.4 1.4h7.8c.8 0 1.4-.6 1.4-1.4v-6.8" />
          <path className="accent home-door" d="M10.1 19v-4.3c0-.4.3-.7.7-.7h2.4c.4 0 .7.3.7.7V19" />
          <circle className="accent nav-dot home-orbit" cx="16.8" cy="7.8" r="0.62" />
        </>
      );
    case 'chats':
      return (
        <>
          <path className="surface" d="M5.2 8.2c0-1.3 1-2.3 2.3-2.3h9c1.3 0 2.3 1 2.3 2.3v4.7c0 1.3-1 2.3-2.3 2.3h-6.1l-4.3 3 1-3.2c-1.1-.2-1.9-1.1-1.9-2.2Z" />
          <path d="M5.2 8.2c0-1.3 1-2.3 2.3-2.3h9c1.3 0 2.3 1 2.3 2.3v4.7c0 1.3-1 2.3-2.3 2.3h-6.1l-4.3 3 1-3.2c-1.1-.2-1.9-1.1-1.9-2.2Z" />
          <circle className="nav-dot typing-a" cx="8.7" cy="10.8" r="0.68" />
          <circle className="accent nav-dot typing-b" cx="12" cy="10.8" r="0.68" />
          <circle className="nav-dot typing-c" cx="15.3" cy="10.8" r="0.68" />
        </>
      );
    case 'files':
      return (
        <>
          <g className="files-folder">
            <path className="surface" d="M4.8 8.3c0-1 .8-1.8 1.8-1.8h4l1.5 1.8h5.3c1 0 1.8.8 1.8 1.8v6.4c0 1-.8 1.8-1.8 1.8H6.6c-1 0-1.8-.8-1.8-1.8Z" />
            <path className="accent files-tab" d="M4.8 9.2h14.4" />
            <path className="muted files-line" d="M8.2 12.4h7.3M8.2 15.1h5.1" />
          </g>
        </>
      );
    case 'characters':
      return (
        <>
          <circle className="secondary-surface" cx="8.1" cy="9.3" r="2.45" />
          <circle className="secondary" cx="8.1" cy="9.3" r="2.45" />
          <path className="secondary" d="M4.7 18.4c.6-2.4 1.8-3.6 3.6-3.6 1.2 0 2.3.6 3 1.8" />
          <circle className="accent-surface" cx="15.1" cy="8.5" r="2.9" />
          <circle className="person-step" cx="15.1" cy="8.5" r="2.9" />
          <path className="accent person-step" d="M10.3 18.4c.8-2.9 2.4-4.3 4.8-4.3s4 1.4 4.8 4.3" />
        </>
      );
    case 'moments':
      return (
        <>
          <g className="moment-figure">
            <circle className="surface" cx="12" cy="12" r="7.3" />
            <circle className="secondary" cx="12" cy="12" r="7.3" />
            <path className="accent moment-mountain" d="M7.4 15.5 10.2 11.7l2.1 2.3 2.7-3.7 1.8 5.2Z" />
          </g>
        </>
      );
    case 'market':
      return (
        <>
          <g className="market-stack-far">
            <path className="muted market-guide" d="m6.2 15.1 5.8 2.9 5.8-2.9" />
            <path className="muted market-guide" d="M12 15.1v2.8" />
          </g>
          <g className="market-stack-mid">
            <path className="surface" d="m6.2 12.2 5.8 2.9 5.8-2.9" />
            <path className="accent" d="M12 12.2v2.9" />
          </g>
          <g className="market-stack-near">
            <path className="surface" d="m6.2 9.3 5.8-2.9 5.8 2.9-5.8 2.9Z" />
            <path className="accent" d="m6.2 9.3 5.8 2.9 5.8-2.9" />
            <circle className="accent nav-dot market-handle" cx="12" cy="9.3" r="0.78" />
          </g>
        </>
      );
    case 'calendar':
      return (
        <>
          <rect className="surface" x="5.1" y="6.5" width="13.8" height="12.2" rx="2.2" />
          <rect x="5.1" y="6.5" width="13.8" height="12.2" rx="2.2" />
          <path className="accent" d="M8.3 4.8v3M15.7 4.8v3M5.3 10h13.4" />
          <rect className="accent-surface" x="8.1" y="12.5" width="3.2" height="3.2" rx="0.75" />
          <path className="mark-draw accent" d="M8.8 14.1 9.6 14.9 11 13.4" strokeDasharray="8" strokeDashoffset="8" />
          <path className="muted" d="M13.2 13.1h3.2M13.2 16h2.2" />
        </>
      );
    case 'letters':
      return (
        <>
          <rect className="surface" x="4.9" y="7.1" width="14.2" height="10.6" rx="2" />
          <rect x="4.9" y="7.1" width="14.2" height="10.6" rx="2" />
          <path className="accent letter-flap" d="M5.9 8.4 12 12.9l6.1-4.5" />
          <path className="muted" d="m5.9 16.7 4.2-3.3M18.1 16.7l-4.2-3.3" />
        </>
      );
    case 'models':
      return (
        <>
          <path className="accent model-flow" d="M8.6 8.8 12 12.1l3.4-3.3M12 12.1v4.2" strokeDasharray="9" strokeDashoffset="9" />
          <circle className="surface model-node-a" cx="8.6" cy="8.8" r="2.35" />
          <circle className="secondary model-node-ring model-node-a" cx="8.6" cy="8.8" r="2.35" />
          <circle className="surface model-node-b" cx="15.4" cy="8.8" r="2.35" />
          <circle className="secondary model-node-ring model-node-b" cx="15.4" cy="8.8" r="2.35" />
          <circle className="accent-surface core-pulse" cx="12" cy="16.9" r="2.55" />
          <circle className="accent model-node-ring core-pulse" cx="12" cy="16.9" r="2.55" />
          <circle className="muted nav-dot" cx="12" cy="12.1" r="0.58" />
        </>
      );
    case 'proxy':
      return (
        <>
          <g className="gateway-left">
            <rect className="surface" x="5.1" y="7.1" width="4.1" height="9.8" rx="1.9" />
            <rect x="5.1" y="7.1" width="4.1" height="9.8" rx="1.9" />
            <circle className="accent nav-dot port-pulse" cx="7.15" cy="12" r="0.72" />
          </g>
          <g className="gateway-right">
            <rect className="surface" x="14.8" y="7.1" width="4.1" height="9.8" rx="1.9" />
            <rect x="14.8" y="7.1" width="4.1" height="9.8" rx="1.9" />
            <circle className="secondary nav-dot port-pulse" cx="16.85" cy="12" r="0.72" />
          </g>
          <path className="accent proxy-flow" d="M9.8 10.2h4.4l-1.3-1.3M14.2 13.8H9.8l1.3 1.3" strokeDasharray="10" strokeDashoffset="10" />
        </>
      );
    case 'membership':
      return (
        <>
          <path className="accent-surface badge-lift" d="M12 5.5 18.2 8v4.4c0 3.2-2.2 5.3-6.2 6.3-4-1-6.2-3.1-6.2-6.3V8Z" />
          <path className="badge-lift" d="M12 5.5 18.2 8v4.4c0 3.2-2.2 5.3-6.2 6.3-4-1-6.2-3.1-6.2-6.3V8Z" />
          <path className="muted" d="M9.2 11.2h5.6M9.9 13.7h4.2" />
          <circle className="accent-surface badge-glow" cx="16.8" cy="7.2" r="1.25" />
          <path className="accent badge-sweep" d="m16.8 6.5.3.6.7.1-.5.5.1.7-.6-.3-.6.3.1-.7-.5-.5.7-.1Z" />
        </>
      );
    case 'settings':
      return (
        <>
          <path className="muted setting-track" d="M5.6 7.3h12.8M5.6 12h12.8M5.6 16.7h12.8" />
          <circle className="accent-surface setting-a" cx="9.1" cy="7.3" r="1.7" />
          <circle className="accent setting-a" cx="9.1" cy="7.3" r="1.7" />
          <circle className="surface setting-b" cx="14.9" cy="12" r="1.7" />
          <circle className="setting-b" cx="14.9" cy="12" r="1.7" />
          <circle className="accent-surface setting-c" cx="11.3" cy="16.7" r="1.7" />
          <circle className="accent setting-c" cx="11.3" cy="16.7" r="1.7" />
        </>
      );
    case 'intro':
      return (
        <>
          <path className="surface" d="M6.2 7.3c0-.9.7-1.6 1.6-1.6h8.4c.9 0 1.6.7 1.6 1.6v9.4c0 .9-.7 1.6-1.6 1.6H7.8c-.9 0-1.6-.7-1.6-1.6Z" />
          <path d="M6.2 7.3c0-.9.7-1.6 1.6-1.6h8.4c.9 0 1.6.7 1.6 1.6v9.4c0 .9-.7 1.6-1.6 1.6H7.8c-.9 0-1.6-.7-1.6-1.6Z" />
          <path className="accent intro-path" d="M8.9 13.5c1.8-3.1 4.1-3.7 6.4-2" strokeDasharray="10" strokeDashoffset="10" />
          <circle className="accent-surface intro-needle" cx="15.3" cy="11.5" r="1.45" />
          <circle className="accent nav-dot intro-needle" cx="15.3" cy="11.5" r="0.6" />
          <path className="muted" d="M9 8.7h4.7M9 16h3.2" />
        </>
      );
    default:
      return null;
  }
}

export default function AnimatedNavIcon({ kind, active = false, size = 24 }: AnimatedNavIconProps) {
  return (
    <Box
      className={`PneumataNavIcon PneumataNavIcon-${kind}${active ? ' is-active' : ''}`}
      sx={{ ...iconSx, '--nav-icon-size': `${size}px` }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {iconPaths(kind)}
      </svg>
    </Box>
  );
}
