import type { ReactNode } from 'react';

// A tiny thin-line icon set drawn for this app: 24px grid, 1.5px strokes,
// square ends, in the text colour. Icons are decoration next to a visible
// label, so they are hidden from screen readers.

export type IconName =
  | 'gavel' | 'timer' | 'undo' | 'pause' | 'check' | 'star' | 'fire' | 'note'
  | 'warning' | 'camera' | 'download' | 'upload' | 'clipboard' | 'close' | 'user' | 'monitor';

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
};

export function Icon({ name, filled = false }: { name: IconName; filled?: boolean }) {
  return (
    <svg className={`icon${filled ? ' filled' : ''}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}
