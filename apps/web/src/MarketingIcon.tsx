import { ReactNode } from 'react';

export type MarketingIconName =
  | 'arrow' | 'check' | 'spark' | 'database' | 'linkedin' | 'globe' | 'shield'
  | 'target' | 'layers' | 'search' | 'user' | 'building' | 'mail' | 'phone'
  | 'filter' | 'download' | 'chart' | 'refresh' | 'eye' | 'eye-off' | 'lock'
  | 'menu' | 'close' | 'chevron' | 'star' | 'briefcase' | 'users';

const paths: Record<MarketingIconName, ReactNode> = {
  arrow: <><path d="M5 12h14" /><path d="m14 7 5 5-5 5" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  spark: <><path d="m12 3-1.35 4.15a5.5 5.5 0 0 1-3.5 3.5L3 12l4.15 1.35a5.5 5.5 0 0 1 3.5 3.5L12 21l1.35-4.15a5.5 5.5 0 0 1 3.5-3.5L21 12l-4.15-1.35a5.5 5.5 0 0 1-3.5-3.5L12 3Z" /><path d="M19 3v4M21 5h-4" /></>,
  database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" /><path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" /></>,
  linkedin: <><rect x="4" y="9" width="4" height="11" rx="1" /><path d="M6 4.5v.01M12 20V9h4v2c1-2.2 5-2.4 5 2v7" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.47 3.84 5.48 3.84 9S14.5 18.53 12 21c-2.5-2.47-3.84-5.48-3.84-9S9.5 5.47 12 3Z" /></>,
  shield: <><path d="M12 3 4.5 6v5.5c0 4.5 3 7.7 7.5 9.5 4.5-1.8 7.5-5 7.5-9.5V6L12 3Z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21c.6-4.1 3-6 7.5-6s6.9 1.9 7.5 6" /></>,
  building: <><path d="M4 21V5l10-2v18M14 9h6v12M8 8h2M8 12h2M8 16h2M17 13h1M17 17h1M2 21h20" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
  phone: <path d="M8.2 3.8 5.5 5.1c-1.2.6-1.7 2-1.2 3.3 2 5.1 6.2 9.3 11.3 11.3 1.3.5 2.7 0 3.3-1.2l1.3-2.7-4.4-2-1.4 2.1a13.2 13.2 0 0 1-6.3-6.3l2.1-1.4-2-4.4Z" />,
  filter: <><path d="M4 5h16l-6.2 7.1V19l-3.6 2v-8.9L4 5Z" /></>,
  download: <><path d="M12 3v12M7 10l5 5 5-5M4 21h16" /></>,
  chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  refresh: <><path d="M20 7v5h-5" /><path d="M18.4 16a8 8 0 1 1 .8-7L20 12" /></>,
  eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
  'eye-off': <><path d="m3 3 18 18" /><path d="M10.6 6.1A9.7 9.7 0 0 1 12 6c6 0 9.5 6 9.5 6a16.6 16.6 0 0 1-2.1 2.9M6.2 6.2C3.8 7.8 2.5 12 2.5 12s3.5 6 9.5 6c1 0 2-.17 2.8-.48M9.9 9.9A3 3 0 0 0 14.1 14" /></>,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  close: <><path d="m5 5 14 14M19 5 5 19" /></>,
  chevron: <path d="m8 10 4 4 4-4" />,
  star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" />,
  briefcase: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V4h6v3M3 12h18M10 12v2h4v-2" /></>,
  users: <><circle cx="9" cy="9" r="3" /><circle cx="17" cy="8" r="2.5" /><path d="M3 20c.5-4 2.3-6 6-6s5.5 2 6 6M15 13c3.6 0 5.5 1.8 6 5" /></>,
};

export function MarketingIcon({ name, size = 20, className = '' }: { name: MarketingIconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

