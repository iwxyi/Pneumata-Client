import { Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

export type AnimatedNavIconKind =
  | 'home'
  | 'chats'
  | 'characters'
  | 'moments'
  | 'calendar'
  | 'letters'
  | 'models'
  | 'settings'
  | 'intro';

interface AnimatedNavIconProps {
  kind: AnimatedNavIconKind;
  active?: boolean;
  size?: number;
}

const iconSx: SxProps<Theme> = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'inherit',
  '--nav-icon-accent': (theme) => theme.palette.primary.main,
  '& svg': {
    display: 'block',
    overflow: 'visible',
  },
  '& path, & line, & circle, & rect, & polyline, & g': {
    vectorEffect: 'non-scaling-stroke',
    transformBox: 'fill-box',
    transformOrigin: 'center',
    transition: 'transform 320ms cubic-bezier(.16,1,.3,1), opacity 260ms ease, stroke-dashoffset 420ms cubic-bezier(.16,1,.3,1), stroke-width 260ms ease',
  },
  '& .accent-line': {
    color: 'var(--nav-icon-accent)',
    stroke: 'currentColor',
    opacity: 0.72,
  },
  '&.is-active .accent-line, .PneumataNavButton:hover & .accent-line': {
    opacity: 1,
  },
  '@keyframes navChatWave': {
    '0%, 100%': { transform: 'translateY(0)' },
    '45%': { transform: 'translateY(-2.7px)' },
  },
  '@keyframes navHomeDoor': {
    '0%, 100%': { transform: 'scale(1)' },
    '50%': { transform: 'scale(1.18)' },
  },
  '@keyframes navPeopleGather': {
    '0%, 100%': { transform: 'translate(-0.7px, 0)' },
    '50%': { transform: 'translate(-1.8px, -0.45px)' },
  },
  '@keyframes navEyeFocus': {
    '0%, 100%': { transform: 'scale(1)' },
    '50%': { transform: 'scale(1.22)' },
  },
  '@keyframes navCalendarTick': {
    '0%, 100%': { transform: 'translateY(0)' },
    '45%': { transform: 'translateY(-2px)' },
  },
  '@keyframes navLetterOpen': {
    '0%, 100%': { transform: 'translateY(-1.5px)' },
    '45%, 60%': { transform: 'translateY(-3.6px)' },
  },
  '@keyframes navModelSignal': {
    '0%, 100%': { strokeDashoffset: 7, opacity: 0.56 },
    '50%': { strokeDashoffset: 0, opacity: 1 },
  },
  '@keyframes navModelGather': {
    '0%, 100%': { transform: 'scale(1)' },
    '50%': { transform: 'scale(1.16)' },
  },
  '@keyframes navGearTurn': {
    '0%': { transform: 'rotate(0deg)' },
    '100%': { transform: 'rotate(360deg)' },
  },
  '@keyframes navSparkPulse': {
    '0%, 100%': { transform: 'scale(1)' },
    '50%': { transform: 'scale(1.2)' },
  },
  '@keyframes navIntroRotate': {
    '0%': { transform: 'rotate(0deg)' },
    '100%': { transform: 'rotate(360deg)' },
  },
  '@media (prefers-reduced-motion: reduce)': {
    '& path, & line, & circle, & rect, & polyline, & g': {
      transition: 'none',
      animation: 'none !important',
    },
  },
  '.PneumataNavButton:hover & .home-door': { animation: 'navHomeDoor 1.45s ease-in-out infinite' },
  '&.is-active .home-door': { transform: 'scale(1.12)' },
  '.PneumataNavButton:hover & .chat-dot-a': { animation: 'navChatWave 980ms ease-in-out infinite' },
  '.PneumataNavButton:hover & .chat-dot-b': { animation: 'navChatWave 980ms ease-in-out 120ms infinite' },
  '.PneumataNavButton:hover & .chat-dot-c': { animation: 'navChatWave 980ms ease-in-out 240ms infinite' },
  '.PneumataNavButton:hover & .character-back': { animation: 'navPeopleGather 1.45s ease-in-out infinite' },
  '.PneumataNavButton:hover & .character-front, &.is-active .character-front': { transform: 'translate(-1.1px, 0.45px)' },
  '.PneumataNavButton:hover & .moment-eye, &.is-active .moment-eye': { transform: 'scale(1.13)' },
  '.PneumataNavButton:hover & .moment-iris': { animation: 'navEyeFocus 1.35s ease-in-out infinite' },
  '.PneumataNavButton:hover & .calendar-top': { animation: 'navCalendarTick 1.35s ease-in-out infinite' },
  '.PneumataNavButton:hover & .calendar-mark, &.is-active .calendar-mark': { strokeWidth: 2.45, transform: 'translateY(-0.8px)' },
  '& .letter-flap-open': {
    opacity: 0,
    transform: 'translateY(1px)',
  },
  '.PneumataNavButton:hover & .letter-flap-open, &.is-active .letter-flap-open': { opacity: 1 },
  '.PneumataNavButton:hover & .letter-flap-open': { animation: 'navLetterOpen 1.35s ease-in-out infinite' },
  '.PneumataNavButton:hover & .letter-fold, &.is-active .letter-fold': { transform: 'translateY(0.55px)', opacity: 0.84 },
  '.PneumataNavButton:hover & .model-node-core, &.is-active .model-node-core': { animation: 'navModelGather 1.45s ease-in-out infinite' },
  '.PneumataNavButton:hover & .model-link': { animation: 'navModelSignal 1.3s ease-in-out infinite' },
  '.PneumataNavButton:hover & .settings-gear': { animation: 'navGearTurn 1.9s linear infinite' },
  '.PneumataNavButton:active & .settings-core': { transform: 'scale(0.7)' },
  '.PneumataNavButton:hover & .intro-spark-a': {
    animation: 'navIntroRotate 4.8s linear infinite',
    transformBox: 'view-box',
    transformOrigin: '12px 12px',
  },
  '.PneumataNavButton:hover & .intro-spark-b, &.is-active .intro-spark-b': { transform: 'scale(1.12)' },
  '.PneumataNavButton:active & svg': { transform: 'scale(0.88)' },
  '.PneumataNavButton:active & .chat-dot-a, .PneumataNavButton:active & .chat-dot-b, .PneumataNavButton:active & .chat-dot-c': {
    animation: 'none',
    transform: 'translateY(1.8px)',
  },
  '.PneumataNavButton:active & .letter-flap-open': {
    animation: 'none',
    transform: 'translateY(-4px)',
  },
} as const;

function iconPaths(kind: AnimatedNavIconKind) {
  switch (kind) {
    case 'home':
      return (
        <>
          <path className="home-roof" d="M4.9 11.1c2.2-1.9 4.4-3.8 6.6-5.6a.8.8 0 0 1 1 0c2.2 1.8 4.4 3.7 6.6 5.6" />
          <path d="M6.8 10.5v7.3c0 .7.5 1.2 1.2 1.2h8c.7 0 1.2-.5 1.2-1.2v-7.3" />
          <path className="home-door accent-line" d="M10.1 18.8v-4.1c0-.4.3-.7.7-.7h2.4c.4 0 .7.3.7.7v4.1" />
        </>
      );
    case 'chats':
      return (
        <>
          <path d="M5.2 7.3c0-.9.7-1.6 1.6-1.6h10.4c.9 0 1.6.7 1.6 1.6v6.6c0 .9-.7 1.6-1.6 1.6H9.4L5.3 18.7l.9-3.5a1.6 1.6 0 0 1-1-1.5Z" />
          <circle className="chat-dot-a" cx="8.6" cy="10.8" r="0.56" />
          <circle className="chat-dot-b accent-line" cx="12" cy="10.8" r="0.56" />
          <circle className="chat-dot-c" cx="15.4" cy="10.8" r="0.56" />
        </>
      );
    case 'characters':
      return (
        <>
          <circle className="character-back" cx="8.4" cy="9.1" r="2.55" opacity={0.72} />
          <path className="character-back" d="M4.9 18.4c.6-2.4 1.8-3.6 3.6-3.6 1.4 0 2.5.8 3.2 2.3" opacity={0.72} />
          <circle className="character-front" cx="15.1" cy="8.5" r="2.85" />
          <path className="character-front accent-line" d="M10.6 18.4c.8-2.8 2.3-4.2 4.5-4.2s3.7 1.4 4.5 4.2" />
        </>
      );
    case 'moments':
      return (
        <>
          <path className="moment-eye" d="M4.6 12s2.6-4.9 7.4-4.9 7.4 4.9 7.4 4.9-2.6 4.9-7.4 4.9S4.6 12 4.6 12Z" />
          <circle className="moment-iris accent-line" cx="12" cy="12" r="2.45" />
          <path d="M8.2 5.5c1.1-.5 2.4-.8 3.8-.8s2.7.3 3.8.8M8.2 18.5c1.1.5 2.4.8 3.8.8s2.7-.3 3.8-.8" opacity={0.42} />
        </>
      );
    case 'calendar':
      return (
        <>
          <rect x="5.1" y="6.6" width="13.8" height="12" rx="2.1" />
          <path className="calendar-top accent-line" d="M8.2 4.9v3M15.8 4.9v3M5.2 10.1h13.6" />
          <path className="calendar-mark" d="M9.2 13.8h5.6M9.2 16h3.4" />
        </>
      );
    case 'letters':
      return (
        <>
          <rect x="4.9" y="7.1" width="14.2" height="10.4" rx="1.9" />
          <path className="letter-flap-open accent-line" d="M5.8 8.3 12 4.9l6.2 3.4" />
          <path className="letter-fold accent-line" d="M5.8 8.4 12 12.9l6.2-4.5" />
          <path className="letter-fold" d="m5.9 16.5 4.2-3.3M18.1 16.5l-4.2-3.3" opacity={0.52} />
        </>
      );
    case 'models':
      return (
        <>
          <path className="model-link" d="M8.2 8.1 12 12l3.9-3.9M12 12v5.2" strokeDasharray="7" strokeDashoffset="7" />
          <circle cx="8.2" cy="8.1" r="2.25" />
          <circle cx="15.9" cy="8.1" r="2.25" />
          <circle className="model-node-core accent-line" cx="12" cy="17.2" r="2.25" />
          <circle cx="12" cy="12" r="1.35" opacity={0.62} />
        </>
      );
    case 'settings':
      return (
        <>
          <g className="settings-gear">
            <path d="M12.22 2.9h-.44c-.55 0-1 .45-1 1v.3c0 .72-.45 1.36-1.1 1.65l-.22.1a1.8 1.8 0 0 1-1.95-.34l-.21-.21a1 1 0 0 0-1.42 0l-.31.31a1 1 0 0 0 0 1.42l.21.21c.51.51.64 1.28.35 1.94l-.1.23c-.29.66-.93 1.09-1.65 1.09h-.3c-.55 0-1 .45-1 1v.44c0 .55.45 1 1 1h.3c.72 0 1.36.43 1.65 1.09l.1.23c.29.66.16 1.43-.35 1.94l-.21.21a1 1 0 0 0 0 1.42l.31.31a1 1 0 0 0 1.42 0l.21-.21c.51-.51 1.29-.64 1.95-.34l.22.1c.65.29 1.1.93 1.1 1.65v.3c0 .55.45 1 1 1h.44c.55 0 1-.45 1-1v-.3c0-.72.45-1.36 1.1-1.65l.22-.1c.66-.3 1.44-.17 1.95.34l.21.21a1 1 0 0 0 1.42 0l.31-.31a1 1 0 0 0 0-1.42l-.21-.21c-.51-.51-.64-1.28-.35-1.94l.1-.23c.29-.66.93-1.09 1.65-1.09h.3c.55 0 1-.45 1-1v-.44c0-.55-.45-1-1-1h-.3c-.72 0-1.36-.43-1.65-1.09l-.1-.23c-.29-.66-.16-1.43.35-1.94l.21-.21a1 1 0 0 0 0-1.42l-.31-.31a1 1 0 0 0-1.42 0l-.21.21c-.51.51-1.29.64-1.95.34l-.22-.1c-.65-.29-1.1-.93-1.1-1.65v-.3c0-.55-.45-1-1-1Z" />
          </g>
          <circle className="settings-core accent-line" cx="12" cy="12" r="2.35" />
        </>
      );
    case 'intro':
      return (
        <>
          <path className="intro-spark-a accent-line" d="M12 4.7v3.9M12 15.4v3.9M4.7 12h3.9M15.4 12h3.9" />
          <path className="intro-spark-b" d="m6.9 6.9 2.8 2.8M14.3 14.3l2.8 2.8M17.1 6.9l-2.8 2.8M9.7 14.3l-2.8 2.8" opacity={0.58} />
        </>
      );
    default:
      return null;
  }
}

export default function AnimatedNavIcon({ kind, active = false, size = 28 }: AnimatedNavIconProps) {
  return (
    <Box className={`PneumataNavIcon PneumataNavIcon-${kind}${active ? ' is-active' : ''}`} sx={iconSx}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {iconPaths(kind)}
      </svg>
    </Box>
  );
}
