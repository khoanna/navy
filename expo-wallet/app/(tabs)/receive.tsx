import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { useRouter } from 'expo-router';

import { useMobileSigner } from '@/lib/wallet/useMobileSigner';
import { short } from '@/lib/wallet/identicon';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { Card } from '@/ui/Card';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { PressRow } from '@/ui/Bits';
import { Skeleton } from '@/ui/Skeleton';
import { useToast } from '@/ui/Toast';
import { colors, space } from '@/ui/theme';
import { FundButton } from '@/features/wallet/FundButton';

export default function Receive() {
  const router = useRouter();
  const toast = useToast();
  const { address } = useMobileSigner();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!address) return;
    try {
      await Clipboard.setStringAsync(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
      toast('Wallet address copied');
    } catch {
      toast('Could not copy — try long-pressing the address');
    }
  };

  return (
    <Screen scroll tabSafe>
      {/* Back header */}
      <PressRow onPress={() => router.back()} style={styles.backRow}>
        <View style={styles.backIconWrap}>
          <Icon name="chevron" size={20} color={colors.textDim} />
        </View>
        <Text variant="h3" color={colors.textHi} style={styles.backLabel}>
          Receive
        </Text>
      </PressRow>

      {/* QR card */}
      <Card style={styles.qrCard}>
        {address ? (
          <QRCode
            value={address}
            size={180}
            color="#060B17"
            backgroundColor="#FFFFFF"
          />
        ) : (
          <Skeleton width={180} height={180} />
        )}
      </Card>

      {/* Eyebrow label */}
      <Text variant="caption" dim center style={styles.eyebrow}>
        Your Navy address
      </Text>

      {/* Address block */}
      <Card glass compact style={styles.addrCard}>
        <Text variant="mono" color={colors.textHi}>
          {address ?? 'provisioning…'}
        </Text>
      </Card>

      {/* Short chip + copy indicator */}
      {address && (
        <View style={styles.chipRow}>
          <View style={styles.chip}>
            <Text variant="label" color={colors.textDim}>
              {short(address)}
            </Text>
          </View>
          {copied && (
            <View style={styles.chip}>
              <Icon name="check" size={13} color={colors.success} />
              <Text variant="label" color={colors.success} style={styles.chipLabel}>
                Copied
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Action row */}
      <View style={styles.actions}>
        <View style={styles.actionBtn}>
          <Button
            label={copied ? 'Copied!' : 'Copy'}
            icon={copied ? 'check' : 'copy'}
            variant="secondary"
            onPress={copy}
          />
        </View>
        <View style={styles.actionBtn}>
          <Button label="Copy address" icon="copy" onPress={copy} />
        </View>
      </View>

      {/* Add funds */}
      <View style={{ marginTop: space.lg }}>
        <FundButton address={address} />
      </View>

      {/* Chain hint */}
      <Card glass compact style={styles.hint}>
        <Text variant="caption" color={colors.text}>
          Only send ETH or USDC (ERC-20) on Ethereum Sepolia to this address.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: space.xxl,
  },
  backIconWrap: {
    // Rotate the chevron 180° to point left
    transform: [{ rotate: '180deg' }],
  },
  backLabel: {
    marginLeft: space.sm,
  },
  qrCard: {
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  eyebrow: {
    marginTop: space.lg,
  },
  addrCard: {
    marginTop: space.sm,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: space.md,
    backgroundColor: colors.glassFill,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
  },
  chipLabel: {
    marginLeft: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: space.md,
    marginTop: space.lg,
  },
  actionBtn: {
    flex: 1,
  },
  hint: {
    marginTop: space.lg,
  },
});
