import { useCallback, useRef } from 'react';
import { useCameraPermissions } from 'expo-camera';
import type { BarcodeScanningResult } from 'expo-camera';
import { parsePayUrl } from '@/lib/pay/payUrl';
import { parseSendTarget } from '@/lib/pay/parseSendTarget';

export interface UseCameraScannerOptions {
  /** Called once when a valid Navy pay URL is decoded. Receives the order UUID. */
  onOrder: (orderId: string) => void;
  /**
   * Called once when a QR decodes to a raw EVM address / EIP-681 send target
   * (but is NOT a Navy pay URL). Optional — omit to disable the send branch.
   */
  onSend?: (target: { address: string; amountWei?: string }) => void;
  /** Called when a QR is decoded but is neither a pay URL nor a send target. Optional. */
  onInvalid?: (text: string) => void;
}

export interface UseCameraScannerResult {
  /** expo-camera permission response (null until first check). */
  permission: ReturnType<typeof useCameraPermissions>[0];
  /** Trigger OS permission prompt. */
  requestPermission: ReturnType<typeof useCameraPermissions>[1];
  /** Pass directly to CameraView's onBarcodeScanned prop. */
  handleBarcode: (result: BarcodeScanningResult) => void;
}

/**
 * Adapts expo-camera v17 (SDK 54) barcode scanning to the Navy pay URL decode
 * contract. Verified against:
 *   - `useCameraPermissions()` → [PermissionResponse | null, requestFn, refreshFn]
 *   - `CameraViewProps.onBarcodeScanned` → (BarcodeScanningResult) => void
 *   - `BarcodeScanningResult` → { data: string; type: string; ... }
 *
 * A ref latch (`doneRef`) ensures only the first successful decode fires
 * `onOrder` — subsequent frames that decode the same code are silently dropped.
 * The latch is intentionally never reset here; the screen navigates away on
 * success, which unmounts this hook.
 */
export function useCameraScanner({
  onOrder,
  onSend,
  onInvalid,
}: UseCameraScannerOptions): UseCameraScannerResult {
  // useCameraPermissions returns a 3-tuple: [permission, request, refresh].
  // We only need the first two for the scan screen.
  const [permission, requestPermission] = useCameraPermissions();

  // Latch prevents repeated firing on the same QR code across multiple frames.
  const doneRef = useRef(false);

  const handleBarcode = useCallback(
    ({ data }: BarcodeScanningResult) => {
      if (doneRef.current) return;

      let orderId: string;
      try {
        orderId = parsePayUrl(data);
      } catch {
        // Not a Navy pay URL — try the send-target branch (raw address / EIP-681).
        const target = parseSendTarget(data);
        if (target) {
          doneRef.current = true;
          onSend?.(target);
        } else {
          onInvalid?.(data);
        }
        return;
      }

      // Valid — latch and call the order callback.
      doneRef.current = true;
      onOrder(orderId);
    },
    [onOrder, onSend, onInvalid],
  );

  return { permission, requestPermission, handleBarcode };
}
