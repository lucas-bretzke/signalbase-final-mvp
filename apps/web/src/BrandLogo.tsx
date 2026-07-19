import './brand.css';
import { useId } from 'react';

interface BrandLogoProps {
  inverse?: boolean;
  compact?: boolean;
  className?: string;
}

export function BrandLogo({ inverse = false, compact = false, className = '' }: BrandLogoProps) {
  const gradientId = `econo-gradient-${useId().replace(/:/g, '')}`;
  return (
    <span className={`econo-brand ${inverse ? 'inverse' : ''} ${compact ? 'compact' : ''} ${className}`.trim()}>
      <svg className="econo-brand-mark" viewBox="0 0 44 44" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={gradientId} x1="5" y1="4" x2="38" y2="40" gradientUnits="userSpaceOnUse">
            <stop stopColor="#45dbff" />
            <stop offset="1" stopColor="#087bd3" />
          </linearGradient>
        </defs>
        <rect x="20" y="4" width="15" height="4.5" rx="2.25" fill={`url(#${gradientId})`} />
        <rect x="12" y="11.5" width="22" height="4.5" rx="2.25" fill={`url(#${gradientId})`} />
        <rect x="5" y="19" width="29" height="4.5" rx="2.25" fill={`url(#${gradientId})`} />
        <rect x="12" y="26.5" width="22" height="4.5" rx="2.25" fill={`url(#${gradientId})`} />
        <rect x="20" y="34" width="15" height="4.5" rx="2.25" fill={`url(#${gradientId})`} />
        <circle cx="37" cy="21.25" r="2.5" fill="#8eeeff" />
      </svg>
      {!compact && <span className="econo-brand-word">EconoSense</span>}
    </span>
  );
}
