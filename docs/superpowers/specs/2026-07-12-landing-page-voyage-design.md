# Navy Landing Page — "The Voyage" (design)

**Date:** 2026-07-12
**App:** `fe/` (Next.js 16 App Router, React 19)
**Status:** Design — approved for planning

## 1. Purpose

Replace `fe/`'s bare auth-chooser root (`src/app/page.tsx`) with a distinctive, scroll-driven marketing landing page that showcases the whole Navy ecosystem (gateway + wallet + farming) and routes two audiences to their front doors:

- **End-users** → "Get the wallet" (external link to the web-wallet origin)
- **Merchants** → "For merchants" (`/merchant/login`, with signup)
- **Admin** → demoted to a quiet footer link.

Success = a premium, on-brand hero experience that (a) feels like one product with the existing dark-navy app, (b) tells the payment story through a single 3D vessel that transforms on scroll, and (c) stays fast and accessible (graceful degradation, reduced-motion, mobile).

## 2. Creative direction (locked)

- **Hero object:** "The Voyage" — a single futuristic naval **vessel** (the brand is literally "Navy") that travels through the story.
- **Visual language:** **Deep Navy Luminous** — evolution of the current palette (`#060B17` bg, `#4F8CFF` electric blue, `#2FE0C2` seafoam), cinematic glow, glassy panels. Consumes existing `src/ui/theme.ts` tokens; no new palette.
- **Render:** live 3D via **react-three-fiber**, camera + vessel driven by GSAP **ScrollTrigger** (pin + scrub).
- **Motion stance:** **bold but graceful** — rich pinned/scrub storytelling on capable devices; automatic degrade to a static hero on mobile / low-end / no-WebGL / `prefers-reduced-motion`.

## 3. The 3D asset

- **Source:** `fe/public/navy.glb` (Tripo text-to-3D, GLB). Deep-navy hull, glowing aqua-cyan edge strips, single mast + clean glowing triangular sail.
- **Known issues, fixed in-engine (Path A — no regeneration):**
  1. Hull underside is off-brand lime-green → **retint that material** at load to deep navy with an aqua waterline.
  2. Sail can read flat from some angles → give the sail material a subtle **emissive aqua** so the glow holds through a 360° scroll.
- **Asset weight — quality-first, light optimization only:** the raw GLB is **79 MB**. Per explicit direction, we keep quality high and only lightly optimize — **target ~40–50 MB** committed as `fe/public/navy-opt.glb`.
  - Run **gltf-transform** with *conservative* settings: `dedupe`, `prune`, `weld`, `instance`, and **meshopt** geometry compression (lossless-feeling). Keep textures at their native/2048 resolution — do NOT downscale or heavily recompress textures (that's where visible quality is lost).
  - Compare optimized vs raw side-by-side; if anything softens, ease off. Size is the low-priority knob here.
  - **Tradeoff (accepted):** ~40–50 MB means a real first-load wait (~10–40s depending on connection). This is deliberately covered by the branded loading screen (below) + `useGLTF.preload` + HTTP caching so repeat visits are instant. The 79 MB raw is NOT shipped (gitignore / remove after optimizing).
  - Load with drei `useGLTF` + `MeshoptDecoder`; `useGLTF.preload`.
- Optional idle sail flutter is done in-engine (gentle transform/shader), not a baked rig.

## 4. Page structure (six beats)

Scenes **1–4 share one pinned `<canvas>`**; ScrollTrigger scrub interpolates the camera + vessel between four scene keyframes. Copy panels parallax over the canvas. Scenes 5–6 are normal document flow.

| # | Beat | Camera / vessel | Copy | CTA |
|---|------|-----------------|------|-----|
| 1 | **Set sail** (hero) | Front ¾, gentle idle bob + slow rotate | "Payments, set to sea." | Get the wallet · For merchants |
| 2 | **Port of trade** (merchants) | Dolly-in, orbit to starboard; invoice/QR cards float in | "Get paid in seconds." Accept USDC · 1% fee · gasless · instant settlement · webhook | Start selling |
| 3 | **Open sea** (Solana) | Side-profile tracking, speed streaks, network nodes | "Settled on-chain, fast." Sub-second finality · on-chain proof from `InvoicePaid` | — |
| 4 | **Treasure** (farming) | Crane-down, reveal harbour; warm gold accent; coins grow | "Idle balance, put to work." Non-custodial subwallet · policy-guarded | Get the wallet |
| 5 | **Proof** | (canvas unpinned) | Feature grid (wallet · gateway · farming · security) + stat counters + "built on Solana" | — |
| 6 | **Close** | Calm horizon | "Set sail with Navy." | Get the wallet · For merchants; footer holds Admin link |

## 5. Architecture

**New dependencies:** `gsap`, `@gsap/react` (`useGSAP` for teardown), `three`, `@react-three/fiber`, `@react-three/drei`. (three has no native postinstall; no `onlyBuiltDependencies` change needed. Verify installed `.d.ts` — SDK drift per `fe/AGENTS.md`.)

**Files:**

- `src/app/page.tsx` — thin **server** shell composing section components (copy is SSR'd).
- `src/components/landing/`
  - `Nav.tsx` — logo + top CTAs.
  - `Hero.tsx` — scene-1 copy overlay + scroll hint.
  - `LoadingScreen.tsx` — **branded first-visit loader** shown while the GLB downloads/decodes. Full-viewport, on-brand Deep Navy Luminous: animated aqua→blue vessel/wave motif, "Charting your voyage…" style copy, and a real **progress bar** wired to drei `useProgress()` (percent from actual asset load, not fake). Fades out (GSAP) once loaded; suppressed on the non-capable/static path (no heavy asset there). Optionally set a `sessionStorage` flag so it only fully plays on first load per session. Overlays `VoyageCanvas` via `<Suspense fallback>`.
  - `VoyageCanvas.tsx` — the r3f `<Canvas>`, loaded via `next/dynamic(..., { ssr:false })`; owns the pinned ScrollTrigger and the scene interpolation loop. Wraps the model in `<Suspense>` with `LoadingScreen` as fallback.
  - `Vessel.tsx` — `useGLTF('/navy-opt.glb')`, applies the material overrides (§3), exposes a ref the canvas drives.
  - `SceneCopy.tsx` — the 4 parallax copy panels (data-driven).
  - `FeatureGrid.tsx` — scene 5, `ScrollTrigger.batch` staggered reveal.
  - `FinalCta.tsx`, `Footer.tsx` — scene 6.
- `src/lib/landing/scenes.ts` — **plain-TS** (no React/three imports): the scene keyframe table (per-scene camera position/target + vessel position/rotation), plus `interpolateScene(progress)` and easing helpers. **Unit-tested** (per CLAUDE.md: keep non-UI logic in plain-TS `src/lib`).
- `src/lib/landing/links.ts` — plain-TS CTA target resolution (wallet origin from env, merchant/admin routes). Unit-tested.
- `public/navy-opt.glb` — compressed asset. `public/navy-poster.webp` — static fallback hero.

**Data flow:** `scenes.ts` is the single source of truth for the storyboard geometry. `VoyageCanvas` subscribes to ScrollTrigger progress → calls `interpolateScene(progress)` → writes camera + vessel transforms each frame. Copy panels use their own per-section ScrollTriggers for reveal/parallax (independent top-level triggers, never nested — per gsap-scrolltrigger rules).

**Graceful degradation:** a `useCapableDevice()` gate (matchMedia: `prefers-reduced-motion`, viewport width, WebGL availability). When not capable → render `navy-poster.webp` hero + plain stacked sections, skip pin/scrub/canvas entirely. `VoyageCanvas` is never imported on the non-capable path (dynamic import stays unloaded).

**Perf:** single shared canvas; Draco GLB < 4 MB; `useGLTF.preload`; `ScrollTrigger.refresh()` after model load + on font load; `useGSAP({ scope })` reverts all triggers on unmount; cap `dpr={[1,1.5]}`.

## 6. Routing / integration

- `/` becomes the landing page. Existing `/admin/login`, `/merchant/login` untouched.
- CTAs: wallet → **new** `NEXT_PUBLIC_WEB_WALLET_ORIGIN` env (the web-wallet lives at `http://localhost:3001`, matching `be`'s `WEB_WALLET_ORIGIN`; `fe` currently has no `NEXT_PUBLIC_*` vars — add one); merchant → `/merchant/login`; admin → footer link to `/admin/login`.
- `src/app/layout.tsx` metadata updated (title/description no longer "Create Next App").

## 7. Testing & gates

- `src/lib/landing/scenes.ts` + `links.ts` → **jest** unit tests (interpolation correctness, progress→camera monotonicity, boundary clamps, link resolution). Matches `fe/` convention (tests only run under `src/lib/**`).
- Screens/canvas (r3f not unit-testable) → gated by `pnpm exec tsc --noEmit` **and** `pnpm build` (the runtime gate).
- Manual: verify reduced-motion + a narrow viewport render the static fallback; verify optimized GLB loads and the green→navy retint applied.

## 8. Out of scope (YAGNI)

- No CMS / editable copy — content is in code.
- No i18n.
- No baked Tripo animation rig (motion is in-engine).
- No AR/USDZ (can add later from the same GLB).
- No changes to admin/merchant app screens beyond the demoted admin link.

## 9. Risks

- **GLB weight (primary, accepted).** ~40–50 MB by choice (quality over size). Mitigated by the branded loading screen that covers the first-load wait, `useGLTF.preload` + HTTP caching for instant repeat visits, and the static poster fallback on non-capable/mobile devices (which skip the heavy download entirely).
- **r3f/three + Next 16 bundling** (Buffer/WebGL). Mitigated by `ssr:false` dynamic import and the `pnpm build` runtime gate (same lesson as web-wallet).
- **Scroll jank on weak devices.** Mitigated by the capability gate + `dpr` cap.
