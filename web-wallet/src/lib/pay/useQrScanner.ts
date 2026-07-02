'use client';
import { useEffect, useRef, useState } from 'react';
import { BrowserQRCodeReader } from '@zxing/library';

/**
 * Streams the default camera into `videoRef` and calls `onResult` once on the
 * first successful QR decode. Returns `{ error }` for camera-unavailable cases.
 * Cleans up (stops stream + resets reader) on unmount.
 *
 * Real @zxing/library API verified against installed types:
 *   decodeFromVideoDevice(
 *     deviceId: string | null,
 *     videoSource: string | HTMLVideoElement | null,
 *     callbackFn: (result: Result, error?: Exception) => any
 *   ): Promise<void>   ← returns Promise<void>, NOT IScannerControls
 *
 * To stop the stream: call reader.reset() which calls stopContinuousDecode()
 * and stopStreams() internally.
 */
export function useQrScanner(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  onResult: (text: string) => void,
): { error: string } {
  const [error, setError] = useState<string>('');
  const doneRef = useRef(false);
  // Keep the reader in a ref so cleanup can reach it.
  const readerRef = useRef<BrowserQRCodeReader | null>(null);

  useEffect(() => {
    doneRef.current = false;
    setError('');

    const reader = new BrowserQRCodeReader();
    readerRef.current = reader;

    // decodeFromVideoDevice: deviceId=null → default camera
    reader
      .decodeFromVideoDevice(null, videoRef.current, (result, err) => {
        if (err) {
          // Continuous scan fires the callback even on transient decode failures;
          // only surface hard errors (camera denied / device missing) which
          // come through as exceptions with a meaningful message.
          if (err && (err as unknown as Error).message) {
            setError((err as unknown as Error).message);
          }
          return;
        }
        if (result && !doneRef.current) {
          doneRef.current = true;
          onResult(result.getText());
        }
      })
      .catch((e: Error) => {
        setError(e.message || 'Camera unavailable');
      });

    return () => {
      readerRef.current?.reset();
      readerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { error };
}
