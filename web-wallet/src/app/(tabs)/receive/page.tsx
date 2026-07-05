'use client';
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { useWebSigner } from '@/lib/wallet/useWebSigner';
import { useToast } from '@/ui/Toast';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { Card } from '@/ui/Card';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { PressRow } from '@/ui/Bits';
import { Skeleton } from '@/ui/Skeleton';
import { colors, space } from '@/ui/theme';

export default function Receive() {
  const router = useRouter();
  const toast = useToast();
  const { address } = useWebSigner();
  const [qr, setQr] = useState<string>('');

  useEffect(() => {
    if (!address) return;
    QRCode.toDataURL(address, {
      margin: 1,
      width: 360,
      color: { dark: '#060B17', light: '#FFFFFF' },
    })
      .then(setQr)
      .catch(() => setQr(''));
  }, [address]);

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      toast('Wallet address copied');
    } catch {
      toast('Could not copy — try long-pressing the address');
    }
  };

  const share = async () => {
    if (!address) return;
    if (navigator.share) {
      try {
        await navigator.share({ text: address });
      } catch {
        // user dismissed — fall through to copy
        await copy();
      }
    } else {
      await copy();
    }
  };

  return (
    <Screen scroll tabSafe>
      {/* Back header */}
      <PressRow onPress={() => router.back()} style={styles.backRow}>
        <span style={{ transform: 'rotate(180deg)', display: 'inline-flex' }}>
          <Icon name="chevron" size={20} color={colors.textDim} />
        </span>
        <Text variant="h3" color={colors.textHi} style={{ marginLeft: `${space.sm}px` }}>
          Receive
        </Text>
      </PressRow>

      {/* QR card */}
      <Card style={styles.qrCard}>
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qr}
            alt="Wallet address QR"
            width={180}
            height={180}
            style={{ borderRadius: 8, display: 'block' }}
          />
        ) : (
          <Skeleton width={180} height={180} />
        )}
      </Card>

      {/* Eyebrow label */}
      <Text
        variant="caption"
        dim
        center
        style={{ marginTop: `${space.lg}px`, display: 'block' }}
      >
        Your Navy address
      </Text>

      {/* Address block */}
      <Card glass compact style={{ marginTop: `${space.sm}px` }}>
        <Text
          variant="mono"
          color={colors.textHi}
          style={{ userSelect: 'text', wordBreak: 'break-all' }}
        >
          {address ?? 'provisioning…'}
        </Text>
      </Card>

      {/* Action row */}
      <div style={styles.actions}>
        <Button label="Copy" icon="copy" variant="secondary" onPress={copy} />
        <Button label="Share" icon="send" onPress={share} />
      </div>

      {/* Chain hint */}
      <Card glass compact style={{ marginTop: `${space.lg}px` }}>
        <Text variant="caption" color={colors.text}>
          Only send SOL or USDC (SPL) on Solana devnet to this address.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = {
  backRow: {
    marginBottom: `${space.xxl}px`,
  } as React.CSSProperties,
  qrCard: {
    background: '#FFFFFF',
    display: 'flex',
    justifyContent: 'center',
    padding: 20,
  } as React.CSSProperties,
  actions: {
    display: 'flex',
    flexDirection: 'row' as const,
    gap: `${space.md}px`,
    marginTop: `${space.lg}px`,
  },
} satisfies Record<string, React.CSSProperties>;
