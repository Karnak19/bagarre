// The game's own line icons (24 x 24, 2 px stroke), as SVG components for
// Astryx's <Icon icon={...} />, which sizes and colours them. The generic ones
// (close, copy, check) come from the theme's icon registry by name.

import type { SVGProps } from "react";

function line(paths: React.ReactNode) {
  return function LineIcon(props: SVGProps<SVGSVGElement>) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        {paths}
      </svg>
    );
  };
}

export const LockIcon = line(
  <>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </>,
);

export const UsersIcon = line(
  <>
    <circle cx="9" cy="9" r="3.5" />
    <path d="M2.5 19.5c.6-3.3 3.2-5 6.5-5s5.9 1.7 6.5 5" />
    <circle cx="17" cy="8" r="2.5" />
    <path d="M17.5 13.5c2.3.3 3.7 1.8 4 4" />
  </>,
);

export const KeyboardIcon = line(
  <>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7 14h10" />
  </>,
);

export function PersonIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <circle cx="12" cy="8.5" r="4" />
      <path d="M4 20.5c.8-4 4-6 8-6s7.2 2 8 6" />
    </svg>
  );
}
