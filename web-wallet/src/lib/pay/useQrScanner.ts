'use client';
import { useEffect, useRef, useState } from 'react';
import {
  BrowserQRCodeReader,
  NotFoundException,
  ChecksumException,
  FormatException,
} from '@zxing/library';

/**
 * Streams the rear camera into `videoRef` and calls `onResult` once on the
 * first successful QR decode. Returns `{ error }` for real camera-unavailable
 * cases only. Cleans up (stops stream + resets reader) on unmount AND on a
 * successful scan (so the camera indicator light never lingers).
 *
 * Real @zxing/library API verified against installed @zxing/library@0.21.3:
 *   decodeFromVideoDevice(deviceId, videoSource, callbackFn): Promise<void>
 *   - deviceId=null → { facingMode: 'environment' } (rear camera, non-exact).
 *   - The callback fires on EVERY frame; when no code is found it passes a
 *     NotFoundException (also ChecksumException/FormatException on partial
 *     reads). Those are NOT errors — surfacing them makes the scan UI show
 *     "camera unavailable" on every frame. Only the .catch() below (getUserMedia
 *     acquisition failure) is a real error.
 */
function friendlyCameraError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission denied. Allow camera access, or paste the invoice link below.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera found on this device. Paste the invoice link below.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'Camera is in use by another app. Close it and retry, or paste the link below.';
    default:
      return (e as Error)?.message || 'Camera unavailable. Paste the invoice link below.';
  }
}

export function useQrScanner(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  onResult: (text: string) => void,
): { error: string } {
  const [error, setError] = useState<string>('');
  const doneRef = useRef(false);
  // Keep the reader in a ref so cleanup (and stop-on-success) can reach it.
  const readerRef = useRef<BrowserQRCodeReader | null>(null);

  useEffect(() => {
    doneRef.current = false;
    setError('');

    // Camera requires a secure context (HTTPS or localhost). Over plain HTTP on a
    // LAN IP, navigator.mediaDevices is undefined and getUserMedia throws a cryptic
    // TypeError. Guard up front with a user-meaningful message.
    if (typeof window === 'undefined' || !window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('Camera needs a secure (HTTPS) connection. Paste the invoice link below to pay.');
      return;
    }

    const reader = new BrowserQRCodeReader();
    readerRef.current = reader;

    const stop = () => {
      readerRef.current?.reset();
      readerRef.current = null;
    };

    reader
      .decodeFromVideoDevice(null, videoRef.current, (result, err) => {
        if (err) {
          // Transient "no code this frame" signals — ignore them entirely.
          if (
            err instanceof NotFoundException ||
            err instanceof ChecksumException ||
            err instanceof FormatException
          ) {
            return;
          }
          // Any other callback error is unexpected but not necessarily fatal; surface it.
          setError(friendlyCameraError(err));
          return;
        }
        if (result && !doneRef.current) {
          doneRef.current = true;
          // Release the camera immediately on success — don't rely on route-tree
          // unmount to stop the stream.
          stop();
          onResult(result.getText());
        }
      })
      .catch((e: unknown) => {
        // getUserMedia acquisition failure (denied / no device / insecure / in-use).
        setError(friendlyCameraError(e));
      });

    return () => {
      readerRef.current?.reset();
      readerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { error };
}
