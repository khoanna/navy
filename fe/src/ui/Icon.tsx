'use client';
import React from 'react';
import { colors } from './theme';

/**
 * Custom hand-drawn line-icon set (24×24, round caps). We draw our own rather
 * than pull in a vector-icons library — keeps the bundle dependency-free and the
 * strokes match the rest of the UI exactly.
 */
export type IconName =
  | 'home'
  | 'scan'
  | 'sprout'
  | 'clock'
  | 'copy'
  | 'check'
  | 'chevron'
  | 'send'
  | 'receive'
  | 'plus'
  | 'bolt'
  | 'logout'
  | 'wallet'
  | 'trend'
  | 'shield'
  | 'down'
  | 'arrowUpRight'
  | 'search'
  | 'settings'
  | 'mail'
  | 'key'
  | 'users'
  | 'store'
  | 'orders'
  | 'chart';

const PATHS: Record<IconName, string[]> = {
  home: ['M4 11.4 12 5l8 6.4', 'M6 10.2V19h12v-8.8', 'M10 19v-4.2h4V19'],
  scan: ['M4 8.5V6a2 2 0 0 1 2-2h2.5', 'M15.5 4H18a2 2 0 0 1 2 2v2.5', 'M20 15.5V18a2 2 0 0 1-2 2h-2.5', 'M8.5 20H6a2 2 0 0 1-2-2v-2.5', 'M4 12h16'],
  sprout: ['M12 21v-8', 'M12 13c0-4 3-7 7.5-7C19.5 10 16.5 13 12 13z', 'M12 13c0-3-2.5-5.5-6-5.5C6 10.5 8.5 13 12 13z'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7.5V12l3 2'],
  copy: ['M9.5 9.5h9v9h-9z', 'M5.5 14.5V5.5h9'],
  check: ['M5 12.5 10 17.5 19 7'],
  chevron: ['M9.5 6 15.5 12l-6 6'],
  send: ['M7 17 17 7', 'M8.5 7H17v8.5'],
  receive: ['M17 7 7 17', 'M15.5 17H7V8.5'],
  plus: ['M12 5v14', 'M5 12h14'],
  bolt: ['M13 3 5 13.5h6L10 21l8-10.5h-6L13 3z'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  wallet: ['M4 8.5A2 2 0 0 1 6 6.5h13v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z', 'M4 8.5V6a2 2 0 0 1 2-2h10', 'M16 12.5h3.5'],
  trend: ['M3.5 16.5 9.5 10.5l4 4L21 7', 'M15.5 7H21v5.5'],
  shield: ['M12 3.5 19 6v5c0 4.5-3 7.8-7 9.5-4-1.7-7-5-7-9.5V6l7-2.5z', 'M9 11.7l2 2 4-4.2'],
  down: ['M12 4.5v14', 'M6.5 13 12 18.5 17.5 13'],
  arrowUpRight: ['M6.5 17.5 17.5 6.5', 'M8.5 6.5h9v9'],
  search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M20 20l-3.5-3.5'],
  settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M12 3.5l1.3 2.2 2.5-.5.4 2.5 2.2 1.3-1.1 2.3 1.1 2.3-2.2 1.3-.4 2.5-2.5-.5L12 20.5l-1.3-2.2-2.5.5-.4-2.5-2.2-1.3 1.1-2.3-1.1-2.3 2.2-1.3.4-2.5 2.5.5L12 3.5z'],
  mail: ['M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5v9A1.5 1.5 0 0 1 18.5 18h-13A1.5 1.5 0 0 1 4 16.5z', 'M4.5 7.5 12 13l7.5-5.5'],
  key: ['M15 3a6 6 0 1 0 5.2 9L21 12l-1.5-1.5L21 9l-1.8-1.8A6 6 0 0 0 15 3z', 'M9.8 8.2 3 15v3h3l6.8-6.8', 'M15 8h.01'],
  users: ['M9 11.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z', 'M3.5 19c0-3 2.5-4.6 5.5-4.6S14.5 16 14.5 19', 'M16 6.2a3 3 0 0 1 0 5.6', 'M17.5 19c0-2.3-1-3.8-2.6-4.5'],
  store: ['M4 9.5 5.2 5h13.6L20 9.5', 'M4 9.5v9.5h16V9.5', 'M4 9.5a2.4 2.4 0 0 0 4 0 2.4 2.4 0 0 0 4 0 2.4 2.4 0 0 0 4 0 2.4 2.4 0 0 0 4 0', 'M9.5 19v-4.5h5V19'],
  orders: ['M5 5.5A2 2 0 0 1 7 3.5h10a2 2 0 0 1 2 2v15h-14z', 'M8.5 8h7', 'M8.5 12h7', 'M8.5 16h4'],
  chart: ['M4 4v16h16', 'M8 15l3-4 3 2 4-6'],
};

/** Icons that are closed glyphs better expressed as filled shapes. */
const FILLED: Partial<Record<IconName, true>> = { bolt: true };

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export function Icon({ name, size = 24, color = colors.text, strokeWidth = 1.8 }: IconProps) {
  const filled = FILLED[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ display: 'inline-block', flexShrink: 0 }}
    >
      <g
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={filled ? color : 'none'}
      >
        {PATHS[name].map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
    </svg>
  );
}
