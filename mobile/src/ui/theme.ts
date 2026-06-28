/**
 * Navy design tokens — a deep-ocean fintech aesthetic.
 *
 * Dark, near-black navy surfaces with a luminous blue→seafoam accent (the
 * product is literally "Navy", so we lean into the nautical palette). All UI
 * primitives in `src/ui/*` consume these tokens; screens never hardcode colors.
 *
 * No external UI deps: gradients/icons are drawn with react-native-svg (already
 * installed as a Privy peer), motion uses RN's built-in Animated.
 */

export const colors = {
  // Surfaces, deepest → most elevated.
  bg: '#060B17',
  bgElevated: '#0B1322',
  surface: '#111B2E',
  surfaceAlt: '#17233B',
  surfaceHi: '#1E2D49',

  // Hairlines.
  border: 'rgba(255,255,255,0.07)',
  borderStrong: 'rgba(255,255,255,0.13)',

  // Text, brightest → faintest.
  textHi: '#F3F7FF',
  text: '#CBD6EC',
  textDim: '#8B99B8',
  textMute: '#586788',

  // Brand accents.
  accent: '#4F8CFF', // electric ocean blue
  accentDeep: '#2F6BFF',
  aqua: '#2FE0C2', // seafoam
  aquaDeep: '#17C4A8',

  // Semantic.
  success: '#2FE0C2',
  danger: '#FF6B83',
  warning: '#FFC861',

  // On-accent text (for filled buttons / hero).
  onAccent: '#04111F',

  // Translucent overlays.
  scrim: 'rgba(4,8,16,0.6)',
  glassFill: 'rgba(255,255,255,0.04)',
} as const;

/** Gradient stop sets, consumed by <Gradient/>. */
export const gradients = {
  ocean: ['#3D74FF', '#2FE0C2'] as const, // hero balance card
  oceanDeep: ['#1E40C9', '#0B8FA6'] as const,
  aquaGlow: ['#2FE0C2', '#1E9BFF'] as const,
  night: ['#0B1322', '#060B17'] as const, // ambient screen wash
} as const;

/** 4-pt spacing scale. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 44,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  xxl: 32,
  pill: 999,
} as const;

/**
 * Type scale. No custom font is bundled (adding expo-font needs a native
 * dev-client rebuild — deferred), so character comes from weight, size and
 * tracking. Balances/amounts use tabular figures via the `num` style.
 */
export const type = {
  display: { fontSize: 44, fontWeight: '800', letterSpacing: -1.5, lineHeight: 48 },
  h1: { fontSize: 28, fontWeight: '700', letterSpacing: -0.6, lineHeight: 34 },
  h2: { fontSize: 22, fontWeight: '700', letterSpacing: -0.4, lineHeight: 28 },
  h3: { fontSize: 17, fontWeight: '600', letterSpacing: -0.2, lineHeight: 22 },
  body: { fontSize: 15, fontWeight: '500', letterSpacing: 0, lineHeight: 21 },
  bodyStrong: { fontSize: 15, fontWeight: '700', letterSpacing: 0, lineHeight: 21 },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 1.2, lineHeight: 16 }, // UPPERCASE eyebrows
  caption: { fontSize: 13, fontWeight: '500', letterSpacing: 0, lineHeight: 18 },
  mono: { fontSize: 13, fontWeight: '500', letterSpacing: 0, fontFamily: 'monospace' },
} as const;

/** Glow-style shadows tuned for a dark canvas. */
export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  accentGlow: {
    shadowColor: colors.accent,
    shadowOpacity: 0.5,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
} as const;

export const theme = { colors, gradients, space, radius, type, shadow };
export type Theme = typeof theme;
