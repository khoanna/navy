# Navy Landing Page "The Voyage" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `fe/`'s bare auth-chooser root with a scroll-driven marketing landing page whose single 3D vessel ("The Voyage") transforms through the payment story, with a branded loading screen and graceful degradation.

**Architecture:** A thin server `page.tsx` composes section components. Scenes 1–4 share one pinned react-three-fiber `<canvas>`; GSAP ScrollTrigger scrubs camera + vessel between four keyframes defined in a unit-tested plain-TS module (`scenes.ts`). All non-UI logic (scene interpolation, CTA link resolution, capability detection) lives in plain-TS `src/lib` per the repo convention; screens are thin and verified by `tsc` + `next build`.

**Tech Stack:** Next.js 16 (App Router), React 19, `gsap` + `@gsap/react`, `three` + `@react-three/fiber` + `@react-three/drei`, `@gltf-transform/cli` (asset prep only). Existing design tokens in `src/ui/theme.ts`.

---

## File Structure

**Create:**
- `src/lib/landing/scenes.ts` — scene keyframe table + `interpolateScene(progress)` + math helpers (plain-TS, tested)
- `src/lib/landing/scenes.test.ts`
- `src/lib/landing/links.ts` — CTA link resolution from env (plain-TS, tested)
- `src/lib/landing/links.test.ts`
- `src/lib/landing/copy.ts` — static section copy data (plain-TS)
- `src/components/landing/useCapableDevice.ts` — client hook: WebGL + viewport + reduced-motion gate
- `src/components/landing/LoadingScreen.tsx` — branded first-load loader (drei `useProgress`)
- `src/components/landing/Vessel.tsx` — GLB loader + green→navy material retint + emissive sail
- `src/components/landing/VoyageCanvas.tsx` — r3f `<Canvas>` + pinned ScrollTrigger scrub loop
- `src/components/landing/Nav.tsx` — logo + top CTAs
- `src/components/landing/Hero.tsx` — scene-1 copy overlay + scroll hint
- `src/components/landing/SceneCopy.tsx` — the 4 parallax copy panels
- `src/components/landing/FeatureGrid.tsx` — scene-5 batch-reveal cards
- `src/components/landing/FinalCta.tsx` — scene-6 CTA
- `src/components/landing/Footer.tsx` — links incl. demoted Admin
- `src/components/landing/LandingClient.tsx` — client wrapper choosing full vs static path
- `public/navy-poster.webp` — static fallback hero image (exported still)

**Modify:**
- `src/app/page.tsx` — replace auth chooser with the landing composition
- `src/app/layout.tsx` — fix metadata title/description
- `package.json` — add deps
- `.gitignore` — ignore the raw 79 MB `public/navy.glb`
- `.env.local` / `.env.example` (if present) — add `NEXT_PUBLIC_WEB_WALLET_ORIGIN`

---

## Task 1: Dependencies + GLB optimization

**Files:**
- Modify: `fe/package.json`
- Modify: `fe/.gitignore`
- Create: `fe/public/navy-opt.glb` (build artifact, committed)

- [ ] **Step 1: Install runtime deps**

Run in `fe/`:
```bash
pnpm add gsap @gsap/react three @react-three/fiber @react-three/drei
pnpm add -D @gltf-transform/cli @types/three
```
Expected: installs succeed; `package.json` gains the deps. (`three` has no native postinstall — no `pnpm.onlyBuiltDependencies` change needed.)

- [ ] **Step 2: Verify installed API surface (SDK drift check per `fe/AGENTS.md`)**

Run:
```bash
node -e "const d=require('@react-three/drei/package.json');console.log('drei',d.version); const f=require('@react-three/fiber/package.json');console.log('fiber',f.version); const t=require('three/package.json');console.log('three',t.version)"
```
Confirm `useGLTF`, `useProgress`, `Environment` exist:
```bash
grep -rl "useProgress" node_modules/@react-three/drei/index.d.ts && grep -rl "useGLTF" node_modules/@react-three/drei/index.d.ts
```
Expected: both grep hits print a path. If the drei export path differs, adjust imports in later tasks to match the installed `.d.ts`.

- [ ] **Step 3: Optimize the GLB (quality-first, ~40–50 MB)**

Run in `fe/`:
```bash
pnpm exec gltf-transform optimize public/navy.glb public/navy-opt.glb \
  --compress meshopt --texture-compress false --simplify false
pnpm exec gltf-transform dedupe public/navy-opt.glb public/navy-opt.glb
pnpm exec gltf-transform prune public/navy-opt.glb public/navy-opt.glb
ls -lh public/navy-opt.glb
```
Expected: `navy-opt.glb` is materially smaller than 79 MB but still large (~40–50 MB target — quality preserved, textures NOT downscaled). If it lands well under 40 MB and textures look soft, re-run without `--compress` and only `dedupe`/`prune`. Do not pursue a smaller size at the cost of visible quality.

- [ ] **Step 4: Keep the raw asset out of the shipped payload**

Add to `fe/.gitignore`:
```
# Raw uncompressed 3D source (ship the optimized navy-opt.glb instead)
public/navy.glb
```

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml .gitignore public/navy-opt.glb
git commit -m "chore(fe): add 3D/scroll deps + optimized voyage GLB"
```

---

## Task 2: Scene keyframes + interpolation (plain-TS, TDD)

**Files:**
- Create: `fe/src/lib/landing/scenes.ts`
- Test: `fe/src/lib/landing/scenes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `fe/src/lib/landing/scenes.test.ts`:
```ts
import { SCENES, interpolateScene, lerp, clamp } from './scenes';

describe('math helpers', () => {
  it('clamps to range', () => {
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(2, 0, 1)).toBe(1);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
  it('lerps endpoints', () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.5)).toBe(5);
  });
});

describe('SCENES', () => {
  it('has four ordered beats', () => {
    expect(SCENES).toHaveLength(4);
    expect(SCENES.map((s) => s.id)).toEqual(['sail', 'port', 'sea', 'treasure']);
  });
});

describe('interpolateScene', () => {
  it('returns the first keyframe at progress 0', () => {
    const f = interpolateScene(0);
    expect(f.camPos).toEqual(SCENES[0].camPos);
    expect(f.vesselRotY).toBeCloseTo(SCENES[0].vesselRotY);
  });
  it('returns the last keyframe at progress 1', () => {
    const f = interpolateScene(1);
    expect(f.camPos).toEqual(SCENES[3].camPos);
  });
  it('clamps out-of-range progress', () => {
    expect(interpolateScene(-5).camPos).toEqual(SCENES[0].camPos);
    expect(interpolateScene(9).camPos).toEqual(SCENES[3].camPos);
  });
  it('lands exactly on an interior keyframe at its boundary', () => {
    // 4 scenes -> 3 segments; segment boundaries at 1/3 and 2/3
    const f = interpolateScene(1 / 3);
    expect(f.camPos[0]).toBeCloseTo(SCENES[1].camPos[0]);
    expect(f.camPos[1]).toBeCloseTo(SCENES[1].camPos[1]);
    expect(f.camPos[2]).toBeCloseTo(SCENES[1].camPos[2]);
  });
  it('produces an intermediate value between keyframes', () => {
    const f = interpolateScene(1 / 6); // halfway through segment 0
    const lo = Math.min(SCENES[0].camPos[2], SCENES[1].camPos[2]);
    const hi = Math.max(SCENES[0].camPos[2], SCENES[1].camPos[2]);
    expect(f.camPos[2]).toBeGreaterThanOrEqual(lo);
    expect(f.camPos[2]).toBeLessThanOrEqual(hi);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test scenes`
Expected: FAIL — `Cannot find module './scenes'`.

- [ ] **Step 3: Write the implementation**

Create `fe/src/lib/landing/scenes.ts`:
```ts
/** Scroll storyboard geometry for the landing "Voyage" 3D hero. Plain-TS, no
 *  three/React imports so it stays unit-testable (repo convention). Units are
 *  three.js world units; angles in radians. Consumed by VoyageCanvas. */

export type Vec3 = readonly [number, number, number];

export interface SceneKeyframe {
  id: 'sail' | 'port' | 'sea' | 'treasure';
  camPos: Vec3;
  camTarget: Vec3;
  vesselPos: Vec3;
  vesselRotY: number;
}

export interface VoyageFrame {
  camPos: Vec3;
  camTarget: Vec3;
  vesselPos: Vec3;
  vesselRotY: number;
}

/** The four pinned beats. Tuned so the vessel reframes: front hero -> dolly to
 *  starboard -> side profile travelling -> crane down onto the harbour. */
export const SCENES: readonly SceneKeyframe[] = [
  { id: 'sail',     camPos: [0, 1.2, 6.5],  camTarget: [0, 0.6, 0],  vesselPos: [0, 0, 0],      vesselRotY: 0.4 },
  { id: 'port',     camPos: [3.2, 1.0, 4.2], camTarget: [0.4, 0.4, 0], vesselPos: [-0.3, 0, 0],  vesselRotY: 1.2 },
  { id: 'sea',      camPos: [6.0, 0.8, 0.5], camTarget: [0, 0.4, 0],  vesselPos: [0, -0.1, 0],   vesselRotY: 1.9 },
  { id: 'treasure', camPos: [1.5, 3.4, 4.0], camTarget: [0, -0.2, 0], vesselPos: [0, -0.3, 0.4], vesselRotY: 2.6 },
] as const;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** Smoothstep easing for a calmer camera than raw linear scrub. */
function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Map global scroll progress (0..1) across the SCENES segments to a frame. */
export function interpolateScene(progress: number): VoyageFrame {
  const p = clamp(progress, 0, 1);
  const segments = SCENES.length - 1; // 3
  const scaled = p * segments;
  const i = Math.min(Math.floor(scaled), segments - 1);
  const t = easeInOut(scaled - i);
  const a = SCENES[i];
  const b = SCENES[i + 1];
  return {
    camPos: lerpVec3(a.camPos, b.camPos, t),
    camTarget: lerpVec3(a.camTarget, b.camTarget, t),
    vesselPos: lerpVec3(a.vesselPos, b.vesselPos, t),
    vesselRotY: lerp(a.vesselRotY, b.vesselRotY, t),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test scenes`
Expected: PASS (all cases). Note: at `progress = 1/3` the eased `t` is 0 at the boundary, so `camPos` equals `SCENES[1]` exactly — the boundary test holds.

- [ ] **Step 5: Commit**

```bash
git add src/lib/landing/scenes.ts src/lib/landing/scenes.test.ts
git commit -m "feat(fe): landing scene keyframes + scroll interpolation"
```

---

## Task 3: CTA link resolution (plain-TS, TDD)

**Files:**
- Create: `fe/src/lib/landing/links.ts`
- Test: `fe/src/lib/landing/links.test.ts`

- [ ] **Step 1: Write the failing test**

Create `fe/src/lib/landing/links.test.ts`:
```ts
import { resolveLinks, DEFAULT_WALLET_ORIGIN } from './links';

describe('resolveLinks', () => {
  it('falls back to the local wallet origin when env is missing', () => {
    const l = resolveLinks({});
    expect(l.wallet).toBe(DEFAULT_WALLET_ORIGIN);
    expect(l.merchant).toBe('/merchant/login');
    expect(l.adminLogin).toBe('/admin/login');
  });
  it('uses the provided wallet origin', () => {
    const l = resolveLinks({ walletOrigin: 'https://wallet.navy' });
    expect(l.wallet).toBe('https://wallet.navy');
  });
  it('trims a trailing slash from the wallet origin', () => {
    const l = resolveLinks({ walletOrigin: 'https://wallet.navy/' });
    expect(l.wallet).toBe('https://wallet.navy');
  });
  it('ignores an empty-string env value', () => {
    const l = resolveLinks({ walletOrigin: '' });
    expect(l.wallet).toBe(DEFAULT_WALLET_ORIGIN);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test links`
Expected: FAIL — `Cannot find module './links'`.

- [ ] **Step 3: Write the implementation**

Create `fe/src/lib/landing/links.ts`:
```ts
/** Resolves the landing page's CTA targets. Plain-TS + injected env so it is
 *  unit-testable; the screen passes `process.env.NEXT_PUBLIC_WEB_WALLET_ORIGIN`. */

export const DEFAULT_WALLET_ORIGIN = 'http://localhost:3001';

export interface CtaLinks {
  wallet: string;
  merchant: string;
  adminLogin: string;
}

export function resolveLinks(env: { walletOrigin?: string }): CtaLinks {
  const origin = env.walletOrigin && env.walletOrigin.trim().length > 0
    ? env.walletOrigin.replace(/\/+$/, '')
    : DEFAULT_WALLET_ORIGIN;
  return {
    wallet: origin,
    merchant: '/merchant/login',
    adminLogin: '/admin/login',
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test links`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/landing/links.ts src/lib/landing/links.test.ts
git commit -m "feat(fe): landing CTA link resolution"
```

---

## Task 4: Section copy data (plain-TS)

**Files:**
- Create: `fe/src/lib/landing/copy.ts`

- [ ] **Step 1: Write the copy module**

Create `fe/src/lib/landing/copy.ts`:
```ts
/** Static landing copy. Keeping it here (not JSX) makes the section components
 *  thin and lets us reorder beats without touching layout code. */

export interface SceneCopyItem {
  id: 'sail' | 'port' | 'sea' | 'treasure';
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
}

export const SCENE_COPY: readonly SceneCopyItem[] = [
  {
    id: 'sail',
    eyebrow: 'Set sail',
    title: 'Payments, set to sea.',
    body: 'A Solana payment ecosystem — the gateway, the wallet, and yield, in one voyage.',
    points: [],
  },
  {
    id: 'port',
    eyebrow: 'Port of trade · Merchants',
    title: 'Get paid in seconds.',
    body: 'Accept digital dollars with a gasless, replay-proof checkout.',
    points: ['USDC on Solana', '1% flat fee', 'Gasless for payers', 'Instant settlement + webhook'],
  },
  {
    id: 'sea',
    eyebrow: 'Open sea · Solana',
    title: 'Settled on-chain, fast.',
    body: 'Every order settles only after its on-chain payment event is confirmed.',
    points: ['Sub-second finality', 'On-chain proof', 'Amount + payer reconciled'],
  },
  {
    id: 'treasure',
    eyebrow: 'Treasure · Farming',
    title: 'Idle balance, put to work.',
    body: 'Opt in and your balance earns through a policy-guarded, non-custodial subwallet.',
    points: ['Non-custodial', 'Policy-guarded signing', 'Keys never touch the agent'],
  },
] as const;

export interface Feature {
  title: string;
  body: string;
}

export const FEATURES: readonly Feature[] = [
  { title: 'The Wallet', body: 'Scan-to-pay, balances, and farming in a mobile-first web wallet.' },
  { title: 'The Gateway', body: 'Server-built invoices, two-signer gasless pay, HMAC webhooks.' },
  { title: 'Farming', body: 'Put idle balance to work with guarded, non-custodial yield.' },
  { title: 'Security', body: 'Envelope-encrypted keys, authoritative on-chain policy checks.' },
] as const;
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/landing/copy.ts
git commit -m "feat(fe): landing section copy data"
```

---

## Task 5: Capability gate hook

**Files:**
- Create: `fe/src/components/landing/useCapableDevice.ts`

- [ ] **Step 1: Write the hook**

Create `fe/src/components/landing/useCapableDevice.ts`:
```ts
'use client';
import { useEffect, useState } from 'react';

/** Returns true only when the device should run the full 3D/scroll experience:
 *  a wide-enough viewport, no reduced-motion preference, and working WebGL.
 *  Returns false during SSR/first paint so the static path renders first, then
 *  upgrades on the client if capable (avoids shipping the heavy canvas to
 *  phones / reduced-motion users). */
export function useCapableDevice(): boolean {
  const [capable, setCapable] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const wide = window.matchMedia('(min-width: 900px)').matches;
    let webgl = false;
    try {
      const c = document.createElement('canvas');
      webgl = !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
      webgl = false;
    }
    setCapable(wide && !reduced && webgl);
  }, []);

  return capable;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/landing/useCapableDevice.ts
git commit -m "feat(fe): device-capability gate for the 3D landing path"
```

---

## Task 6: Branded loading screen

**Files:**
- Create: `fe/src/components/landing/LoadingScreen.tsx`

- [ ] **Step 1: Write the component**

Create `fe/src/components/landing/LoadingScreen.tsx`:
```tsx
'use client';
import { useProgress } from '@react-three/drei';
import { colors } from '@/ui/theme';

/** Full-viewport branded loader shown while the GLB downloads/decodes. Wired to
 *  drei useProgress() so the bar reflects real asset load. Rendered as the
 *  <Suspense> fallback inside VoyageCanvas; unmounts when the model resolves. */
export function LoadingScreen() {
  const { progress } = useProgress();
  const pct = Math.round(progress);
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        background:
          'radial-gradient(120% 80% at 80% -10%, rgba(47,224,194,0.18), transparent 55%),' +
          'radial-gradient(100% 90% at 10% 110%, rgba(79,140,255,0.22), transparent 55%),' +
          colors.bg,
        color: colors.textHi,
      }}
    >
      <svg width="96" height="76" viewBox="0 0 150 120" style={{ filter: 'drop-shadow(0 8px 24px rgba(47,224,194,0.5))' }}>
        <path d="M20 78 L130 78 L112 100 L38 100 Z" fill="#123a5f" stroke={colors.aqua} strokeWidth="1.5" />
        <rect x="70" y="28" width="4" height="52" fill="#8fd8ff" />
        <path d="M74 30 L114 62 L74 68 Z" fill={colors.aqua} />
        <path d="M72 30 L34 60 L72 66 Z" fill={colors.accent} />
        <animateTransform attributeName="transform" type="rotate" from="-2 75 90" to="2 75 90" dur="2.4s" repeatCount="indefinite" additive="sum" />
      </svg>
      <div style={{ marginTop: 22, fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase', color: colors.aqua }}>
        Charting your voyage
      </div>
      <div style={{ marginTop: 14, width: 200, height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.10)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: `linear-gradient(90deg, ${colors.accent}, ${colors.aqua})`, transition: 'width 200ms ease' }} />
      </div>
      <div style={{ marginTop: 10, fontSize: 12, color: colors.textDim }}>{pct}%</div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors. If drei's `useProgress` import path errors, correct it to the path found in Task 1 Step 2.

- [ ] **Step 3: Commit**

```bash
git add src/components/landing/LoadingScreen.tsx
git commit -m "feat(fe): branded 3D loading screen wired to real load progress"
```

---

## Task 7: Vessel (GLB load + material fix)

**Files:**
- Create: `fe/src/components/landing/Vessel.tsx`

- [ ] **Step 1: Write the component**

Create `fe/src/components/landing/Vessel.tsx`:
```tsx
'use client';
import { forwardRef, useLayoutEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';

const MODEL_URL = '/navy-opt.glb';

/** Loads the optimized voyage GLB and applies in-engine fixes (Path A):
 *  - retint the off-brand lime-green hull material to deep navy + aqua
 *  - give the sail a subtle aqua emissive so its glow holds at every angle.
 *  Exposes a group ref the canvas drives (position + rotation.y). */
export const Vessel = forwardRef<THREE.Group>(function Vessel(_props, ref) {
  const { scene } = useGLTF(MODEL_URL);

  const cloned = useMemo(() => scene.clone(true), [scene]);

  useLayoutEffect(() => {
    cloned.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const mat = obj.material as THREE.MeshStandardMaterial;
      if (!mat || !mat.color) return;
      const c = mat.color;
      // Green-dominant material = the off-brand under-hull -> deep navy.
      if (c.g > c.r * 1.25 && c.g > c.b * 1.1) {
        mat.color.set('#0B1B33');
        mat.emissive = new THREE.Color('#123a5f');
        mat.emissiveIntensity = 0.15;
      }
      // Large dark near-flat material = the sail -> subtle aqua emissive glow.
      const isDark = c.r < 0.15 && c.g < 0.2 && c.b < 0.4;
      if (isDark) {
        mat.emissive = new THREE.Color('#2FE0C2');
        mat.emissiveIntensity = 0.25;
      }
      mat.needsUpdate = true;
    });
  }, [cloned]);

  return (
    <group ref={ref} dispose={null}>
      <primitive object={cloned} />
    </group>
  );
});

useGLTF.preload(MODEL_URL);
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/landing/Vessel.tsx
git commit -m "feat(fe): voyage vessel loader with in-engine hull retint + emissive sail"
```

---

## Task 8: VoyageCanvas (pinned scroll scrub)

**Files:**
- Create: `fe/src/components/landing/VoyageCanvas.tsx`

- [ ] **Step 1: Write the component**

Create `fe/src/components/landing/VoyageCanvas.tsx`:
```tsx
'use client';
import { Suspense, useRef } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import * as THREE from 'three';
import { Vessel } from './Vessel';
import { LoadingScreen } from './LoadingScreen';
import { interpolateScene } from '@/lib/landing/scenes';

gsap.registerPlugin(ScrollTrigger, useGSAP);

/** Drives the camera + vessel from a shared scroll-progress ref each frame. */
function Rig({ progress }: { progress: React.MutableRefObject<number> }) {
  const vessel = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const target = useRef(new THREE.Vector3());

  useFrame(() => {
    const f = interpolateScene(progress.current);
    // Idle bob layered on the scene position.
    const bob = Math.sin(performance.now() / 900) * 0.04;
    camera.position.set(f.camPos[0], f.camPos[1], f.camPos[2]);
    target.current.set(f.camTarget[0], f.camTarget[1], f.camTarget[2]);
    camera.lookAt(target.current);
    if (vessel.current) {
      vessel.current.position.set(f.vesselPos[0], f.vesselPos[1] + bob, f.vesselPos[2]);
      vessel.current.rotation.y = f.vesselRotY;
    }
  });

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 6, 4]} intensity={1.4} color="#dff0ff" />
      <directionalLight position={[-4, 2, -3]} intensity={0.6} color="#2FE0C2" />
      <Suspense fallback={null}>
        <Vessel ref={vessel} />
        <Environment preset="night" />
      </Suspense>
    </>
  );
}

/** Pins section 1–4 wrapper (#voyage-pin, height = 400vh) and maps scroll to a
 *  0..1 progress ref that the Rig reads. One canvas for all four beats. */
export function VoyageCanvas() {
  const progress = useRef(0);
  const container = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const st = ScrollTrigger.create({
        trigger: '#voyage-pin',
        start: 'top top',
        end: 'bottom bottom',
        scrub: 1,
        onUpdate: (self) => {
          progress.current = self.progress;
        },
      });
      // Recompute once the (heavy) model + fonts settle.
      const id = window.setTimeout(() => ScrollTrigger.refresh(), 300);
      return () => {
        st.kill();
        window.clearTimeout(id);
      };
    },
    { scope: container },
  );

  return (
    <div ref={container} style={{ position: 'fixed', inset: 0, zIndex: 0 }}>
      <Canvas dpr={[1, 1.5]} camera={{ fov: 42, position: [0, 1.2, 6.5] }} gl={{ antialias: true }}>
        <Suspense fallback={null}>
          <Rig progress={progress} />
        </Suspense>
      </Canvas>
      <Suspense fallback={null}>
        {/* LoadingScreen reads useProgress; must live under a Canvas-independent
            tree so it can overlay while the model streams. */}
      </Suspense>
    </div>
  );
}
```

Note: `LoadingScreen` uses `useProgress`, a drei hook that works outside `<Canvas>`. It is rendered by `LandingClient` (Task 12) as a sibling overlay, not here — keeping the canvas tree clean.

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors. If `useGSAP` is not a valid `registerPlugin` arg in the installed version, drop it from the `registerPlugin` call (only `ScrollTrigger` is required there).

- [ ] **Step 3: Commit**

```bash
git add src/components/landing/VoyageCanvas.tsx
git commit -m "feat(fe): pinned scroll-scrub canvas driving camera + vessel"
```

---

## Task 9: Nav, Hero, and scene copy panels

**Files:**
- Create: `fe/src/components/landing/Nav.tsx`
- Create: `fe/src/components/landing/Hero.tsx`
- Create: `fe/src/components/landing/SceneCopy.tsx`

- [ ] **Step 1: Write `Nav.tsx`**

```tsx
'use client';
import { colors } from '@/ui/theme';
import type { CtaLinks } from '@/lib/landing/links';

export function Nav({ links }: { links: CtaLinks }) {
  return (
    <nav style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 40, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 28px' }}>
      <span style={{ fontWeight: 800, letterSpacing: '0.05em', color: colors.textHi }}>NAVY</span>
      <div style={{ display: 'flex', gap: 10 }}>
        <a href={links.merchant} style={{ fontSize: 13, color: colors.text, border: `1px solid ${colors.borderStrong}`, padding: '8px 14px', borderRadius: 10 }}>For merchants</a>
        <a href={links.wallet} style={{ fontSize: 13, fontWeight: 700, color: colors.onAccent, background: `linear-gradient(90deg, ${colors.accent}, ${colors.aqua})`, padding: '8px 14px', borderRadius: 10 }}>Get the wallet</a>
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: Write `Hero.tsx`**

```tsx
'use client';
import { colors } from '@/ui/theme';
import { SCENE_COPY } from '@/lib/landing/copy';
import type { CtaLinks } from '@/lib/landing/links';

export function Hero({ links }: { links: CtaLinks }) {
  const c = SCENE_COPY[0];
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 28px', maxWidth: 620 }}>
      <span style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: colors.aqua }}>{c.eyebrow}</span>
      <h1 style={{ margin: '10px 0 14px', fontSize: 'clamp(38px, 6vw, 68px)', lineHeight: 1.02, letterSpacing: '-0.02em', color: colors.textHi }}>{c.title}</h1>
      <p style={{ fontSize: 17, lineHeight: 1.5, color: colors.text, maxWidth: 440 }}>{c.body}</p>
      <div style={{ display: 'flex', gap: 12, marginTop: 26 }}>
        <a href={links.wallet} style={{ fontWeight: 700, color: colors.onAccent, background: `linear-gradient(90deg, ${colors.accent}, ${colors.aqua})`, padding: '13px 22px', borderRadius: 12 }}>Get the wallet</a>
        <a href={links.merchant} style={{ color: colors.text, border: `1px solid ${colors.borderStrong}`, padding: '13px 22px', borderRadius: 12 }}>For merchants</a>
      </div>
      <div style={{ marginTop: 44, fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: colors.textDim }}>Scroll to set sail ↓</div>
    </div>
  );
}
```

- [ ] **Step 3: Write `SceneCopy.tsx`** (beats 2–4, each a full-height parallax panel with its own reveal trigger)

```tsx
'use client';
import { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { colors } from '@/ui/theme';
import { SCENE_COPY } from '@/lib/landing/copy';

gsap.registerPlugin(ScrollTrigger);

/** Renders beats 2..4 (index 1..3). Each panel is full-height and aligned so the
 *  pinned canvas behind it shows the matching camera framing. Copy fades/rises in. */
export function SceneCopy() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const panels = gsap.utils.toArray<HTMLElement>('.voyage-panel');
      panels.forEach((panel) => {
        gsap.from(panel.querySelectorAll('.reveal'), {
          y: 40, opacity: 0, duration: 0.7, stagger: 0.08, ease: 'power2.out',
          scrollTrigger: { trigger: panel, start: 'top 65%', toggleActions: 'play none none reverse' },
        });
      });
    },
    { scope: root },
  );

  return (
    <div ref={root}>
      {SCENE_COPY.slice(1).map((c, i) => (
        <section
          key={c.id}
          className="voyage-panel"
          style={{
            minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center',
            padding: '0 28px', maxWidth: 560,
            marginLeft: i % 2 === 1 ? 'auto' : undefined, // alternate sides for rhythm
            textAlign: i % 2 === 1 ? 'right' : 'left',
          }}
        >
          <span className="reveal" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: colors.aqua }}>{c.eyebrow}</span>
          <h2 className="reveal" style={{ margin: '10px 0 12px', fontSize: 'clamp(30px, 4.5vw, 50px)', lineHeight: 1.05, letterSpacing: '-0.02em', color: colors.textHi }}>{c.title}</h2>
          <p className="reveal" style={{ fontSize: 16, lineHeight: 1.5, color: colors.text, alignSelf: i % 2 === 1 ? 'flex-end' : 'flex-start', maxWidth: 420 }}>{c.body}</p>
          {c.points.length > 0 && (
            <ul className="reveal" style={{ listStyle: 'none', padding: 0, margin: '16px 0 0', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: i % 2 === 1 ? 'flex-end' : 'flex-start' }}>
              {c.points.map((p) => (
                <li key={p} style={{ fontSize: 12.5, color: colors.text, border: `1px solid ${colors.borderStrong}`, background: colors.glassFill, padding: '6px 11px', borderRadius: 999 }}>{p}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/landing/Nav.tsx src/components/landing/Hero.tsx src/components/landing/SceneCopy.tsx
git commit -m "feat(fe): landing nav, hero, and scene copy panels"
```

---

## Task 10: FeatureGrid + FinalCta + Footer

**Files:**
- Create: `fe/src/components/landing/FeatureGrid.tsx`
- Create: `fe/src/components/landing/FinalCta.tsx`
- Create: `fe/src/components/landing/Footer.tsx`

- [ ] **Step 1: Write `FeatureGrid.tsx`** (scene 5, batch reveal)

```tsx
'use client';
import { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { colors } from '@/ui/theme';
import { FEATURES } from '@/lib/landing/copy';

gsap.registerPlugin(ScrollTrigger);

export function FeatureGrid() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      ScrollTrigger.batch('.feature-card', {
        start: 'top 85%',
        onEnter: (els) => gsap.to(els, { opacity: 1, y: 0, stagger: 0.12, duration: 0.6, ease: 'power2.out', overwrite: true }),
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} style={{ position: 'relative', zIndex: 1, background: colors.bg, padding: '110px 28px' }}>
      <span style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: colors.aqua }}>One ecosystem</span>
      <h2 style={{ margin: '10px 0 40px', fontSize: 'clamp(28px, 4vw, 44px)', color: colors.textHi, letterSpacing: '-0.02em' }}>Everything on board.</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 16, maxWidth: 1040 }}>
        {FEATURES.map((f) => (
          <div key={f.title} className="feature-card" style={{ opacity: 0, transform: 'translateY(40px)', border: `1px solid ${colors.border}`, background: colors.glassFill, borderRadius: 16, padding: '22px 20px' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 17, color: colors.textHi }}>{f.title}</h3>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: colors.textDim }}>{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Write `FinalCta.tsx`**

```tsx
'use client';
import { colors } from '@/ui/theme';
import type { CtaLinks } from '@/lib/landing/links';

export function FinalCta({ links }: { links: CtaLinks }) {
  return (
    <section style={{ position: 'relative', zIndex: 1, background: `radial-gradient(120% 90% at 50% 120%, rgba(47,224,194,0.20), transparent 60%), ${colors.bg}`, padding: '130px 28px', textAlign: 'center' }}>
      <h2 style={{ margin: '0 0 22px', fontSize: 'clamp(32px, 5vw, 56px)', color: colors.textHi, letterSpacing: '-0.02em' }}>Set sail with Navy.</h2>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        <a href={links.wallet} style={{ fontWeight: 700, color: colors.onAccent, background: `linear-gradient(90deg, ${colors.accent}, ${colors.aqua})`, padding: '14px 26px', borderRadius: 12 }}>Get the wallet</a>
        <a href={links.merchant} style={{ color: colors.text, border: `1px solid ${colors.borderStrong}`, padding: '14px 26px', borderRadius: 12 }}>For merchants</a>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Write `Footer.tsx`** (Admin demoted here)

```tsx
'use client';
import { colors } from '@/ui/theme';
import type { CtaLinks } from '@/lib/landing/links';

export function Footer({ links }: { links: CtaLinks }) {
  return (
    <footer style={{ position: 'relative', zIndex: 1, background: colors.bg, borderTop: `1px solid ${colors.border}`, padding: '30px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
      <span style={{ fontSize: 13, color: colors.textMute }}>© Navy · Solana devnet</span>
      <div style={{ display: 'flex', gap: 18, fontSize: 13 }}>
        <a href={links.wallet} style={{ color: colors.textDim }}>Wallet</a>
        <a href={links.merchant} style={{ color: colors.textDim }}>Merchants</a>
        <a href={links.adminLogin} style={{ color: colors.textMute }}>Admin</a>
      </div>
    </footer>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/landing/FeatureGrid.tsx src/components/landing/FinalCta.tsx src/components/landing/Footer.tsx
git commit -m "feat(fe): feature grid, final CTA, and footer (admin demoted)"
```

---

## Task 11: LandingClient wrapper (full vs static path)

**Files:**
- Create: `fe/src/components/landing/LandingClient.tsx`

- [ ] **Step 1: Write the wrapper**

Create `fe/src/components/landing/LandingClient.tsx`:
```tsx
'use client';
import dynamic from 'next/dynamic';
import { colors } from '@/ui/theme';
import { resolveLinks } from '@/lib/landing/links';
import { useCapableDevice } from './useCapableDevice';
import { Nav } from './Nav';
import { Hero } from './Hero';
import { SceneCopy } from './SceneCopy';
import { FeatureGrid } from './FeatureGrid';
import { FinalCta } from './FinalCta';
import { Footer } from './Footer';
import { LoadingScreen } from './LoadingScreen';

// Canvas is client-only + code-split so the heavy 3D bundle never ships to the
// static path (mobile / reduced-motion / no-WebGL).
const VoyageCanvas = dynamic(() => import('./VoyageCanvas').then((m) => m.VoyageCanvas), { ssr: false });

export function LandingClient() {
  const capable = useCapableDevice();
  const links = resolveLinks({ walletOrigin: process.env.NEXT_PUBLIC_WEB_WALLET_ORIGIN });

  if (!capable) {
    // Static path: poster hero + plain stacked sections, no canvas/scroll rig.
    return (
      <main>
        <Nav links={links} />
        <div
          style={{
            minHeight: '100vh',
            backgroundImage: `linear-gradient(180deg, rgba(6,11,23,0.2), ${colors.bg}), url(/navy-poster.webp)`,
            backgroundSize: 'cover', backgroundPosition: 'center',
          }}
        >
          <Hero links={links} />
        </div>
        <FeatureGrid />
        <FinalCta links={links} />
        <Footer links={links} />
      </main>
    );
  }

  // Full path: pinned canvas behind the four beats, then normal flow.
  return (
    <main>
      <LoadingScreen />
      <VoyageCanvas />
      <Nav links={links} />
      <div id="voyage-pin" style={{ position: 'relative', zIndex: 1, height: '400vh' }}>
        <div style={{ position: 'sticky', top: 0 }}>
          <Hero links={links} />
        </div>
        <SceneCopy />
      </div>
      <FeatureGrid />
      <FinalCta links={links} />
      <Footer links={links} />
    </main>
  );
}
```

Note: `#voyage-pin` is `400vh` (four beats); the `VoyageCanvas` ScrollTrigger pins nothing itself — the fixed canvas already stays put — it only maps `#voyage-pin`'s scroll to progress. Hero is `sticky` for beat 1; `SceneCopy` scrolls beats 2–4 over the fixed canvas.

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/landing/LandingClient.tsx
git commit -m "feat(fe): landing client wrapper with capable/static path split"
```

---

## Task 12: Wire the page + metadata + env + poster

**Files:**
- Modify: `fe/src/app/page.tsx`
- Modify: `fe/src/app/layout.tsx`
- Modify: `fe/.env.local` (create if absent) and `fe/.env.example` (if present)
- Create: `fe/public/navy-poster.webp`

- [ ] **Step 1: Replace `page.tsx`**

Overwrite `fe/src/app/page.tsx`:
```tsx
import { LandingClient } from '@/components/landing/LandingClient';

export default function Home() {
  return <LandingClient />;
}
```

- [ ] **Step 2: Fix metadata in `layout.tsx`**

In `fe/src/app/layout.tsx`, replace the `metadata` export:
```tsx
export const metadata: Metadata = {
  title: 'Navy — Payments, set to sea',
  description: 'A Solana payment ecosystem: gateway, wallet, and yield in one voyage.',
};
```

- [ ] **Step 3: Add the env var**

Append to `fe/.env.local` (create if missing):
```
NEXT_PUBLIC_WEB_WALLET_ORIGIN=http://localhost:3001
```
If `fe/.env.example` exists, add the same line there (value `http://localhost:3001`).

- [ ] **Step 4: Provide the poster image**

Create `fe/public/navy-poster.webp` — a still of the vessel on the Deep Navy background (screenshot the rendered hero once Task 13 runs, export at ~1600px wide as webp). Until then, use a temporary solid-navy placeholder so the static path renders:
```bash
# Placeholder until a real render is captured (any small webp works):
printf '\x00' > /dev/null # (capture the real still during Task 13 verification)
```
Interim: set the static path's `backgroundImage` to the gradient only if the file is absent — but prefer capturing the real still in Task 13 and committing it here.

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx src/app/layout.tsx .env.example
git commit -m "feat(fe): mount voyage landing at / + metadata + wallet-origin env"
```

---

## Task 13: Build gate + manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the unit tests**

Run: `pnpm test`
Expected: PASS — includes `scenes` and `links` suites; existing `src/lib` suites still green.

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Production build (the runtime gate)**

Run: `pnpm build`
Expected: build succeeds. If it fails on `three`/WebGL/`Buffer` resolution, confirm `VoyageCanvas` is only imported via `dynamic(..., { ssr:false })` (it is, via `LandingClient`) — no three import may reach a server component. Fix any bundling error before proceeding (per the web-wallet lesson in CLAUDE.md).

- [ ] **Step 4: Manual smoke on dev**

Run: `pnpm dev` and open the printed URL.
Verify:
- Loading screen shows with a moving progress bar, then fades to the hero.
- Scrolling pins the canvas and the vessel reframes through the four beats (turn → profile → crane-down).
- Hull under-side is navy (not green); sail glows.
- Feature cards stagger in; final CTA + footer (with Admin link) render.
- CTAs point to the right places (wallet origin, `/merchant/login`, `/admin/login`).

- [ ] **Step 5: Verify the static/reduced-motion path**

In devtools, enable "Emulate CSS prefers-reduced-motion: reduce" (or narrow the viewport < 900px) and reload.
Expected: no canvas/loading screen; poster hero + stacked sections + working CTAs. Capture a hero still here and save as `public/navy-poster.webp`.

- [ ] **Step 6: Commit the poster + any fixes**

```bash
git add public/navy-poster.webp
git commit -m "feat(fe): static-path poster still for the voyage hero"
```

---

## Self-Review Notes

- **Spec coverage:** hero object + Deep Navy palette (Tasks 7–10 use `theme.ts` tokens); live r3f + ScrollTrigger scrub (Tasks 7–8); loading screen w/ real progress (Task 6); in-engine green→navy retint + emissive sail (Task 7); quality-first GLB ~40–50 MB (Task 1); graceful degradation (Tasks 5, 11); routing/`/` replacement + demoted admin (Tasks 10, 12); env var (Task 12); plain-TS unit tests (Tasks 2–3); build gate (Task 13). All covered.
- **Type consistency:** `CtaLinks`/`resolveLinks` (Task 3) consumed identically in Tasks 9–12; `interpolateScene`/`VoyageFrame` (Task 2) consumed in Task 8; `SCENE_COPY`/`FEATURES` (Task 4) consumed in Tasks 9–10; `Vessel` `forwardRef<THREE.Group>` matches the `useRef<THREE.Group>` in Task 8.
- **Known soft spots for the implementer:** drei import paths + `useGSAP` plugin registration may vary by installed version (Task 1 Step 2 checks; adjust if needed). Scene keyframe numbers are a starting tune — expect to eyeball-adjust `SCENES` values in Task 13 for framing.
```
