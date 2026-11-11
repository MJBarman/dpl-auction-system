import type { ReactNode } from 'react';

// A tiny thin-line icon set drawn for this app: 24px grid, 1.5px strokes,
// square ends, in the text colour. Icons are decoration next to a visible
// label, so they are hidden from screen readers.

export type IconName =
  | 'gavel' | 'timer' | 'undo' | 'pause' | 'check' | 'star' | 'fire' | 'note'
  | 'warning' | 'camera' | 'download' | 'upload' | 'clipboard' | 'close' | 'user' | 'monitor' | 'send'
  | 'eye' | 'target' | 'share' | 'shield' | 'rows' | 'radio' | 'more' | 'volume' | 'mute' | 'vibrate'
  | 'install' | 'lock' | 'trophy' | 'chevron' | 'sun' | 'phone';

const PATHS: Record<IconName, ReactNode> = {
  gavel: <><path d="M14 3l7 7-3 3-7-7z" /><path d="M14.5 9.5L5 19" /><path d="M3 21.25h9" /></>,
  timer: <><circle cx="12" cy="13.5" r="7.5" /><path d="M12 13.5V9.5M10 2.5h4M12 2.5V6" /></>,
  undo: <><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>,
  pause: <path d="M9 5v14M15 5v14" />,
  check: <path d="M4.5 12.5l5 5L19.5 7" />,
  star: <path d="M12 3l2.35 6.26 6.69.3-5.24 4.18 1.78 6.45L12 16.5l-5.58 3.69 1.78-6.45-5.24-4.18 6.69-.3z" />,
  fire: <path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.4 2.4-5.3 3.8-8.3.5 2 1.6 3 2.8 3.5C12 7.5 13 5 15.5 3c-.3 3 1.8 4.8 2.7 6.6.6 1.2.8 2.4.8 3.6C19 17.6 16.4 21 12 21z" />,
  note: <><path d="M5 3.5h10l4 4v13H5z" /><path d="M8.5 11.5h7M8.5 15h7" /></>,
  warning: <><path d="M12 3.5L2.5 20.5h19z" /><path d="M12 10v4.5M12 16.75v1.5" /></>,
  camera: <><path d="M3 7.5h4.5l2-2.5h5l2 2.5H21v12H3z" /><circle cx="12" cy="13" r="3.5" /></>,
  download: <path d="M12 3.5v12M7 10.5l5 5 5-5M4 20.5h16" />,
  upload: <path d="M12 15.5v-12M7 8.5l5-5 5 5M4 20.5h16" />,
  clipboard: <><path d="M8 4.5H5.5v16h13v-16H16" /><path d="M8.5 3h7v3h-7zM8.5 11h7M8.5 15h5" /></>,
  close: <path d="M5 5l14 14M19 5L5 19" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c.8-4.3 4-6.5 8-6.5s7.2 2.2 8 6.5" /></>,
  monitor: <><path d="M2.5 4.5h19v12h-19z" /><path d="M8 20.5h8M12 16.5v4" /></>,
  send: <><path d="M21 3L3 10.5l7.5 3L14 21z" /><path d="M21 3L10.5 13.5" /></>,
  eye: <><path d="M2 12c2.5-4.4 6-6.5 10-6.5s7.5 2.1 10 6.5c-2.5 4.4-6 6.5-10 6.5S4.500 16.400 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  target: <><circle cx="12" cy="12" r="8.500" /><circle cx="12" cy="12" r="4.500" /><circle cx="12" cy="12" r=".75" /></>,
  share: <><path d="M12 15.500V3.500M7.500 8l4.500-4.500L16.500 8" /><path d="M5 11.500v9h14v-9" /></>,
  shield: <path d="M12 3l7.500 2.500v6c0 4.500-3 8-7.500 9.500-4.500-1.500-7.500-5-7.500-9.500v-6z" />,
  rows: <path d="M4 6.500h16M4 12h16M4 17.500h16" />,
  radio: <><circle cx="12" cy="12" r="2" /><path d="M7.800 7.800a6 6 0 0 0 0 8.400M16.200 7.800a6 6 0 0 1 0 8.400M4.900 4.900a10 10 0 0 0 0 14.200M19.100 4.900a10 10 0 0 1 0 14.200" /></>,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  volume: <><path d="M4 9.500h3.500l5-4.500v14l-5-4.500H4z" /><path d="M16 9a4.200 4.200 0 0 1 0 6M18.500 6.500a7.800 7.800 0 0 1 0 11" /></>,
  mute: <><path d="M4 9.500h3.500l5-4.500v14l-5-4.500H4z" /><path d="M16.500 9.500l5 5M21.500 9.500l-5 5" /></>,
  vibrate: <><path d="M8.500 4.500h7v15h-7z" /><path d="M5 9v6M2.500 10.500v3M19 9v6M21.500 10.500v3" /></>,
  install: <><path d="M4.500 4.500h15v15h-15z" /><path d="M12 8.500v7M8.500 12h7" /></>,
  lock: <><path d="M6 10.500h12V20H6z" /><path d="M8.500 10.500v-3a3.500 3.500 0 0 1 7 0v3" /></>,
  trophy: <><path d="M7.500 4h9v5a4.500 4.500 0 0 1-9 0z" /><path d="M7.500 5.500h-3V7a3 3 0 0 0 3 3M16.500 5.500h3V7a3 3 0 0 1-3 3M12 13.500v4M8.500 20h7" /></>,
  chevron: <path d="M9 5l7 7-7 7" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.500v3M12 18.500v3M2.500 12h3M18.500 12h3M5.300 5.300l2.100 2.100M16.600 16.600l2.100 2.100M5.300 18.700l2.100-2.100M16.600 7.400l2.100-2.100" /></>,
  phone: <><path d="M7.500 2.500h9v19h-9z" /><path d="M11 18.500h2" /></>,
};

export function Icon({ name, filled = false }: { name: IconName; filled?: boolean }) {
  return (
    <svg className={`icon${filled ? ' filled' : ''}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}
