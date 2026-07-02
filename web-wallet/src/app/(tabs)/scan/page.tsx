'use client';
import React, { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { parsePayUrl } from '@/lib/pay/payUrl';
import { useQrScanner } from '@/lib/pay/useQrScanner';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { IconBadge } from '@/ui/Bits';
import { colors, radius, space } from '@/ui/theme';

/** The frame side length in px. Matches mobile's FRAME logic (window – 96, capped 280). */
const FRAME = 280;

/**
 * One of the four corner brackets framing the scan window.
 * Each bracket is a 34×34 div whose relevant borders form an "L" shape.
 */
function Corner({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  const base: React.CSSProperties = {
    position: 'absolute',
    width: 34,
    height: 34,
    borderColor: colors.aqua,
    borderStyle: 'solid',
    borderWidth: 0,
  };

  const corner: React.CSSProperties =
    pos === 'tl'
      ? { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: `${radius.lg}px` }
      : pos === 'tr'
      ? { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: `${radius.lg}px` }
      : pos === 'bl'
      ? { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: `${radius.lg}px` }
      : { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: `${radius.lg}px` };

  return <div style={{ ...base, ...corner }} />;
}

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
      {/* Full-frame camera feed */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={styles.video}
      />

      {/* Semi-transparent scrim overlay — pointer-events off so the video receives touch */}
      <div style={styles.overlay}>
        {/* Header */}
        <div style={styles.header}>
          <Text variant="label" color={colors.textHi} upper>
            Scan to pay
          </Text>
          <Text variant="caption" color="rgba(255,255,255,0.7)" center style={{ marginTop: '4px' }}>
            Point at a Navy invoice QR code
          </Text>
        </div>

        {/* Corner-bracket frame + animated laser */}
        <div style={{ width: FRAME, height: FRAME, position: 'relative', marginTop: -40 }}>
          <Corner pos="tl" />
          <Corner pos="tr" />
          <Corner pos="bl" />
          <Corner pos="br" />
          {/* Laser line — CSS animation navy-laser defined in globals.css */}
          <div
            style={{
              position: 'absolute',
              left: 6,
              right: 6,
              top: 0,
              height: 2,
              borderRadius: 2,
              backgroundColor: colors.aqua,
              boxShadow: `0 0 8px ${colors.aqua}`,
              // The CSS var drives the translateY travel distance
              ['--laser-travel' as string]: `${FRAME - 6}px`,
              animation: 'navy-laser 3.6s ease-in-out infinite',
            }}
          />
        </div>

        {/* Footer: hint or error pill */}
        <div style={styles.footer}>
          {displayError ? (
            <div style={styles.errorPill}>
              <Text variant="caption" color={colors.danger} center>
                {displayError}
              </Text>
            </div>
          ) : (
            <div style={styles.hintPill}>
              <Text variant="caption" color="rgba(255,255,255,0.8)" center>
                Gasless — Navy covers the network fee
              </Text>
            </div>
          )}
        </div>
      </div>

      {/* Manual fallback — always rendered below the overlay; more prominent on error */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: displayError ? colors.surface : 'rgba(6,11,23,0.85)',
          borderTop: `1px solid ${colors.border}`,
          padding: `${space.lg}px ${space.xl}px ${space.huge}px`,
          display: 'flex',
          flexDirection: 'column',
          gap: `${space.md}px`,
          zIndex: 20,
        }}
      >
        {displayError && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: `${space.sm}px`, paddingBottom: `${space.md}px` }}>
            <IconBadge name="scan" color={colors.accent} size={52} />
            <Text variant="h3" color={colors.textHi} center>
              Paste an invoice link
            </Text>
            <Text variant="caption" muted center>
              Camera unavailable — paste a Navy invoice URL below to pay.
            </Text>
          </div>
        )}
        <input
          value={manualUrl}
          onChange={(e) => setManualUrl(e.target.value)}
          placeholder="navy://pay/... or https://..."
          style={{
            background: colors.surface,
            border: `1px solid ${displayError ? colors.borderStrong : colors.border}`,
            borderRadius: `${radius.md}px`,
            color: colors.textHi,
            fontSize: 14,
            padding: `${space.md}px ${space.lg}px`,
            outline: 'none',
            width: '100%',
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleManual(); }}
        />
        <Button label="Open invoice link" icon="send" onPress={handleManual} full />
      </div>
    </div>
  );
}

const styles = {
  root: {
    position: 'relative',
    width: '100%',
    height: '100vh',
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
  overlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'space-between',
    pointerEvents: 'none',
    zIndex: 10,
  } as React.CSSProperties,
  header: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    paddingTop: `${space.xl + space.xxl}px`,
    paddingLeft: `${space.xxl}px`,
    paddingRight: `${space.xxl}px`,
  } as React.CSSProperties,
  footer: {
    paddingBottom: '240px',
    paddingLeft: `${space.xxl}px`,
    paddingRight: `${space.xxl}px`,
    width: '100%',
    display: 'flex',
    justifyContent: 'center',
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
} satisfies Record<string, React.CSSProperties>;
