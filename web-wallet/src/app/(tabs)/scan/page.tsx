'use client';
import React, { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { parsePayUrl } from '@/lib/pay/payUrl';
import { useQrScanner } from '@/lib/pay/useQrScanner';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { colors, radius, space } from '@/ui/theme';

/** Reticle size for the scan window (Aurora spec: ~170×170). */
const RETICLE = 170;

export default function Scan() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [manualUrl, setManualUrl] = useState('');

  const { error: cameraError } = useQrScanner(videoRef, (data) => {
    try {
      const id = parsePayUrl(data);
      router.push(`/pay/${id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  });

  const displayError = error || cameraError;

  const handleManual = () => {
    if (!manualUrl.trim()) return;
    try {
      const id = parsePayUrl(manualUrl.trim());
      router.push(`/pay/${id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div style={styles.root}>
      {/* Full-bleed camera feed — ref and attributes unchanged */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={styles.video}
      />

      {/* Dimmed surround: four quadrant scrims that leave the reticle clear.
          pointer-events none so camera touch still works. */}
      <div style={styles.scrimLayer} aria-hidden="true">
        {/* top */}
        <div style={{ ...styles.scrimPanel, top: 0, left: 0, right: 0, bottom: `calc(50% + ${RETICLE / 2}px)` }} />
        {/* bottom */}
        <div style={{ ...styles.scrimPanel, top: `calc(50% + ${RETICLE / 2}px)`, left: 0, right: 0, bottom: 0 }} />
        {/* left (middle row) */}
        <div style={{
          ...styles.scrimPanel,
          top: `calc(50% - ${RETICLE / 2}px)`,
          left: 0,
          width: `calc(50% - ${RETICLE / 2}px)`,
          height: RETICLE,
        }} />
        {/* right (middle row) */}
        <div style={{
          ...styles.scrimPanel,
          top: `calc(50% - ${RETICLE / 2}px)`,
          right: 0,
          left: `calc(50% + ${RETICLE / 2}px)`,
          height: RETICLE,
        }} />
      </div>

      {/* Reticle border ring — drawn as a separate absolute div */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: RETICLE,
          height: RETICLE,
          borderRadius: radius.xl,        // 24px
          border: '2px solid rgba(255,255,255,0.85)',
          pointerEvents: 'none',
          zIndex: 11,
          overflow: 'hidden',
        }}
      >
        {/* Animated horizontal scan line using the existing navy-laser keyframe */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            borderRadius: 2,
            background: `linear-gradient(90deg, transparent, ${colors.aqua}, transparent)`,
            boxShadow: `0 0 8px ${colors.aqua}, 0 0 16px ${colors.aqua}60`,
            // --laser-travel drives the translateY in the keyframe (reticle height minus line height)
            ['--laser-travel' as string]: `${RETICLE - 2}px`,
            animation: 'navy-laser 2.4s ease-in-out infinite',
          }}
        />
      </div>

      {/* Top bar — pointer-events on so the close button works */}
      <div style={styles.topBar}>
        <button
          onClick={() => router.back()}
          style={styles.iconBtn}
          aria-label="Close scanner"
        >
          <span style={styles.closeX}>✕</span>
        </button>

        <Text variant="label" color={colors.textHi} upper>
          Scan to pay
        </Text>

        {/* Right slot kept empty (no torch in existing logic) */}
        <div style={{ width: 40 }} />
      </div>

      {/* Hint below reticle */}
      <div style={styles.hint}>
        {displayError ? (
          <div style={styles.errorPill}>
            <Text variant="caption" color={colors.danger} center>
              {displayError}
            </Text>
          </div>
        ) : (
          <div style={styles.hintPill}>
            <Text variant="caption" color="rgba(255,255,255,0.8)" center>
              Point at a Navy QR code
            </Text>
          </div>
        )}
      </div>

      {/* Paste fallback — wired to existing handleManual logic */}
      <div style={styles.pastePanel}>
        {displayError && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: `${space.sm}px`, paddingBottom: `${space.md}px` }}>
            <Text variant="h3" color={colors.textHi} center>
              Paste an invoice link
            </Text>
            <Text variant="caption" muted center>
              Camera unavailable — paste a Navy invoice URL below.
            </Text>
          </div>
        )}
        <input
          value={manualUrl}
          onChange={(e) => setManualUrl(e.target.value)}
          placeholder="https://pay.navy/pay/..."
          style={{
            background: colors.surface,
            border: `1px solid ${displayError ? colors.borderStrong : colors.border}`,
            borderRadius: `${radius.md}px`,
            color: colors.textHi,
            fontSize: 16,
            padding: `${space.md}px ${space.lg}px`,
            outline: 'none',
            width: '100%',
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleManual(); }}
        />
        <Button label="Paste address instead" icon="copy" onPress={handleManual} full />
      </div>
    </div>
  );
}

const styles = {
  root: {
    position: 'relative',
    width: '100%',
    height: '100dvh',
    overflow: 'hidden',
    backgroundColor: '#000',
  } as React.CSSProperties,

  video: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  } as React.CSSProperties,

  scrimLayer: {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    zIndex: 10,
  } as React.CSSProperties,

  scrimPanel: {
    position: 'absolute',
    backgroundColor: 'rgba(4,8,20,0.72)',
  } as React.CSSProperties,

  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: `max(${space.xl}px, env(safe-area-inset-top))`,
    paddingLeft: `${space.lg}px`,
    paddingRight: `${space.lg}px`,
    paddingBottom: `${space.lg}px`,
    zIndex: 20,
  } as React.CSSProperties,

  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    background: 'rgba(255,255,255,0.12)',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    WebkitTapHighlightColor: 'transparent',
  } as React.CSSProperties,

  closeX: {
    color: colors.textHi,
    fontSize: 17,
    lineHeight: 1,
    fontWeight: '600',
  } as React.CSSProperties,

  hint: {
    position: 'absolute',
    left: 0,
    right: 0,
    // sits ~24px below the reticle's bottom edge
    top: `calc(50% + ${RETICLE / 2 + 24}px)`,
    display: 'flex',
    justifyContent: 'center',
    paddingLeft: `${space.xxl}px`,
    paddingRight: `${space.xxl}px`,
    pointerEvents: 'none',
    zIndex: 20,
  } as React.CSSProperties,

  hintPill: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingTop: `${space.sm}px`,
    paddingBottom: `${space.sm}px`,
    paddingLeft: `${space.lg}px`,
    paddingRight: `${space.lg}px`,
    borderRadius: `${radius.pill}px`,
  } as React.CSSProperties,

  errorPill: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingTop: `${space.sm}px`,
    paddingBottom: `${space.sm}px`,
    paddingLeft: `${space.lg}px`,
    paddingRight: `${space.lg}px`,
    borderRadius: `${radius.pill}px`,
    border: '1px solid rgba(255,107,131,0.4)',
  } as React.CSSProperties,

  pastePanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(6,11,23,0.92)',
    borderTop: `1px solid rgba(255,255,255,0.07)`,
    padding: `${space.lg}px ${space.xl}px max(${space.huge}px, calc(${space.huge}px + env(safe-area-inset-bottom)))`,
    display: 'flex',
    flexDirection: 'column',
    gap: `${space.md}px`,
    zIndex: 20,
  } as React.CSSProperties,
} satisfies Record<string, React.CSSProperties>;
