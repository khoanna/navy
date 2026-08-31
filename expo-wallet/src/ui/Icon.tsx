import React from 'react';
import { Feather } from '@expo/vector-icons';
import { colors } from './theme';

/**
 * Navy icon set — all 21 semantic names from the web UI plus extras needed for
 * the tab bar (home, scan, download, clock, trendingUp, settings already
 * covered). Backed by Feather icons (bundled with Expo SDK).
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
  | 'download'
  | 'trendingUp'
  | 'x'
  | 'close'
  | 'refresh'
  | 'alert'
  | 'info';

/** Mapping from Navy semantic icon names to the closest Feather glyph. */
const FEATHER_MAP: Record<IconName, keyof typeof Feather.glyphMap> = {
  home: 'home',
  scan: 'maximize', // corner-frame scan metaphor
  sprout: 'trending-up', // no sprout in Feather; rising trend is the closest farming metaphor
  clock: 'clock',
  copy: 'copy',
  check: 'check',
  chevron: 'chevron-right',
  send: 'send',
  receive: 'download', // incoming arrow
  plus: 'plus',
  bolt: 'zap',
  logout: 'log-out',
  wallet: 'credit-card',
  trend: 'trending-up',
  shield: 'shield',
  down: 'arrow-down',
  arrowUpRight: 'arrow-up-right',
  search: 'search',
  settings: 'settings',
  mail: 'mail',
  key: 'key',
  download: 'download',
  trendingUp: 'trending-up',
  x: 'x',
  close: 'x',
  refresh: 'refresh-cw',
  alert: 'alert-circle',
  info: 'info',
};

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  /**
   * Accepted for API compatibility with the web SVG icon (which supports per-path
   * strokeWidth). Feather's glyph map doesn't expose per-icon stroke width, so
   * this prop is accepted but not forwarded.
   */
  strokeWidth?: number;
}

export function Icon({ name, size = 24, color = colors.text, strokeWidth: _strokeWidth }: IconProps) {
  return <Feather name={FEATHER_MAP[name]} size={size} color={color} />;
}
