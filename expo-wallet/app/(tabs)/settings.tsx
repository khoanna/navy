import React, { useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import {
  usePrivy,
  useLinkWithOAuth,
  useUnlinkEmail,
  useUnlinkOAuth,
  useUnlinkPasskey,
  useMfaEnrollment,
} from '@privy-io/expo';
import { useLinkWithPasskey } from '@privy-io/expo/passkey';
import { RELYING_PARTY } from '@/lib/config/privy';
import { LinkEmailSheet } from '@/features/settings/LinkEmailSheet';
import { MfaEnrollSheet } from '@/features/settings/MfaEnrollSheet';
import { RecoverySheet } from '@/features/settings/RecoverySheet';
import { currentRecoveryState, recoveryMethodLabel } from '@/lib/account/recovery';
import { enrolledMfaMethods, mfaMethodLabel } from '@/lib/account/mfa';

import { useNavySession } from '@/lib/auth/SessionContext';
import { useMobileSigner } from '@/lib/wallet/useMobileSigner';
import { short, avatarColors } from '@/lib/wallet/identicon';
import {
  describeLinkedAccounts,
  linkableProviders,
  canUnlink,
  type ProviderId,
} from '@/lib/account/linkedAccounts';
import { useToast } from '@/ui/Toast';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { Card } from '@/ui/Card';
import { Button } from '@/ui/Button';
import { Icon, IconName } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';
import { IconBadge, PressRow } from '@/ui/Bits';
import { colors, radius, space } from '@/ui/theme';

// Only Google/Apple are surfaced as inline link actions. Email linking in
// @privy-io/expo is an OTP send/verify flow (not a drop-in modal), so it is
// intentionally omitted here — see the report notes.
const LINK_META: Record<'google' | 'apple', { label: string; icon: IconName }> = {
  google: { label: 'Link Google', icon: 'shield' },
  apple: { label: 'Link Apple', icon: 'shield' },
};

/** A settings list row — a muted (textDim) leading badge, title (+optional
 *  subtitle), and a trailing slot. Colour is reserved for interactive/semantic
 *  bits, not decoration (matches the history/receive list treatment). */
function Row({
  icon,
  title,
  subtitle,
  trailing,
  onPress,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
}) {
  return (
    <PressRow onPress={onPress} style={styles.row}>
      <IconBadge name={icon} color={colors.textDim} size={44} />
      <View style={styles.rowText}>
        <Text variant="bodyStrong" color={colors.textHi}>
          {title}
        </Text>
        {subtitle && (
          <Text variant="caption" muted>
            {subtitle}
          </Text>
        )}
      </View>
      {trailing}
    </PressRow>
  );
}

/** Small muted eyebrow above each card — same as the history day headers. */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text variant="caption" dim style={styles.sectionTitle}>
      {children}
    </Text>
  );
}

function Chevron() {
  return <Icon name="chevron" size={18} color={colors.textMute} />;
}

export default function Settings() {
  const router = useRouter();
  const toast = useToast();
  const { signOut } = useNavySession();
  const { address } = useMobileSigner();

  const { user } = usePrivy();
  const { link } = useLinkWithOAuth({
    onSuccess: () => toast('Account linked'),
    onError: () => toast('Could not link account'),
  });
  const { unlinkEmail } = useUnlinkEmail();
  const { unlinkOAuth } = useUnlinkOAuth();
  const { unlink: unlinkPasskey } = useUnlinkPasskey();
  const { linkWithPasskey } = useLinkWithPasskey();
  const { unenrollMfa } = useMfaEnrollment();

  const [confirm, setConfirm] = useState<null | 'logout' | 'mfa-off' | 'mfa-passkey-off'>(null);
  const [sheet, setSheet] = useState<null | 'email' | 'mfa' | 'recovery'>(null);
  const [copied, setCopied] = useState(false);

  const rows = describeLinkedAccounts(user);
  const unlinkable = canUnlink(user);
  // Email linking is not surfaced (OTP flow), so drop it from the offer list.
  const toLink = linkableProviders(user).filter(
    (p): p is 'google' | 'apple' => p === 'google' || p === 'apple',
  );
  const [avA, avB] = avatarColors(address);
  const primaryEmail = user?.linked_accounts.find((a) => a.type === 'email');
  const primary = primaryEmail?.type === 'email' ? primaryEmail.address : short(address);

  // Enrolled-MFA status: all enrolled methods for the per-method list.
  const enrolledMfa = enrolledMfaMethods(user);
  const hasEmail = rows.some((r) => r.provider === 'email');
  // Recovery state
  const recoveryState = currentRecoveryState(user);

  const copyAddress = async () => {
    if (!address) return;
    try {
      await Clipboard.setStringAsync(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  const unlink = async (provider: ProviderId, id: string) => {
    try {
      if (provider === 'email') await unlinkEmail({ email: id });
      else if (provider === 'google') await unlinkOAuth({ provider: 'google', subject: id });
      else if (provider === 'apple') await unlinkOAuth({ provider: 'apple', subject: id });
      else await unlinkPasskey({ credentialId: id });
      toast('Account unlinked');
    } catch {
      toast('Could not unlink account');
    }
  };

  const doLink = (provider: 'google' | 'apple') => {
    link({ provider }).catch(() => {
      /* user dismissed / error surfaced via onError */
    });
  };

  const doLogout = async () => {
    setConfirm(null);
    await signOut();
    router.replace('/login');
  };

  const addPasskey = async () => {
    try {
      await linkWithPasskey({ relyingParty: RELYING_PARTY });
      toast('Passkey added');
    } catch (e) {
      toast(`Could not add passkey: ${(e as Error).message}`);
    }
  };

  const removeMfa = async () => {
    try {
      await unenrollMfa({ method: 'totp' });
      toast('Two-factor authentication removed');
    } catch (e) {
      toast(`Could not remove 2FA: ${(e as Error).message}`);
    } finally {
      setConfirm(null);
    }
  };

  const removePasskeyMfa = async () => {
    try {
      await unenrollMfa({ method: 'passkey', removeForLogin: false });
      toast('Passkey two-factor removed');
    } catch (e) {
      toast(`Could not remove passkey 2FA: ${(e as Error).message}`);
    } finally {
      setConfirm(null);
    }
  };

  return (
    <Screen scroll tabSafe>
      <Text variant="h2" color={colors.textHi} style={styles.title}>
        Settings
      </Text>

      {/* Identity header */}
      <Card glass compact>
        <View style={styles.identity}>
          <View style={[styles.avatar, { backgroundColor: avA, borderColor: avB }]} />
          <View style={styles.identityText}>
            <Text variant="bodyStrong" color={colors.textHi}>
              {primary}
            </Text>
            <Pressable
              onPress={copyAddress}
              accessibilityLabel="Copy wallet address"
              style={styles.addrPill}
            >
              <Text variant="caption" numeric color={colors.textDim}>
                {short(address)}
              </Text>
              <Icon name={copied ? 'check' : 'copy'} size={13} color={colors.textDim} />
            </Pressable>
          </View>
        </View>
      </Card>

      {/* Linked accounts */}
      <SectionTitle>Linked accounts</SectionTitle>
      <Card glass compact style={styles.listCard}>
        {rows.map((r) => (
          <Row
            key={r.key}
            icon={r.icon}
            title={r.label}
            subtitle={r.subtitle}
            trailing={
              unlinkable ? (
                <Pressable onPress={() => unlink(r.provider, r.unlinkId)} style={styles.textBtn}>
                  <Text variant="label" color={colors.textDim}>
                    Unlink
                  </Text>
                </Pressable>
              ) : undefined
            }
          />
        ))}
        {toLink.map((p) => (
          <Row
            key={`link-${p}`}
            icon={LINK_META[p].icon}
            title={LINK_META[p].label}
            onPress={() => doLink(p)}
            trailing={<Icon name="plus" size={18} color={colors.textMute} />}
          />
        ))}
        {!hasEmail && (
          <Row
            icon="mail"
            title="Link email"
            onPress={() => setSheet('email')}
            trailing={<Icon name="plus" size={18} color={colors.textMute} />}
          />
        )}
        <Row
          icon="key"
          title="Add a passkey"
          onPress={addPasskey}
          trailing={<Icon name="plus" size={18} color={colors.textMute} />}
        />
      </Card>

      {/* Security */}
      <SectionTitle>Security</SectionTitle>
      <Card glass compact style={styles.listCard}>
        <Row
          icon="shield"
          title="Wallet recovery"
          subtitle={
            recoveryState.isSet && recoveryState.method
              ? recoveryMethodLabel(recoveryState.method)
              : 'Not set'
          }
          onPress={() => setSheet('recovery')}
          trailing={<Chevron />}
        />
        {enrolledMfa.map((m) => (
          <Row
            key={m}
            icon="key"
            title={mfaMethodLabel(m)}
            subtitle="On"
            onPress={
              m === 'totp'
                ? () => setConfirm('mfa-off')
                : m === 'passkey'
                  ? () => setConfirm('mfa-passkey-off')
                  : undefined
            }
            trailing={
              m === 'totp' || m === 'passkey' ? <Chevron /> : undefined
            }
          />
        ))}
        <Row
          icon="key"
          title="Add two-factor method"
          onPress={() => setSheet('mfa')}
          trailing={<Icon name="plus" size={18} color={colors.textMute} />}
        />
      </Card>

      {/* About */}
      <SectionTitle>About</SectionTitle>
      <Card glass compact style={styles.listCard}>
        <Row
          icon="shield"
          title="Network"
          subtitle="Solana devnet"
          trailing={<Text variant="caption" muted>Devnet</Text>}
        />
        <Row icon="key" title="Version" subtitle="Navy Wallet 1.0.0" />
      </Card>

      {/* Log out — the one deliberate destructive action */}
      <View style={styles.logout}>
        <Button label="Log out" icon="logout" variant="danger" onPress={() => setConfirm('logout')} />
      </View>

      {/* Confirm: log out */}
      <Sheet open={confirm === 'logout'} onClose={() => setConfirm(null)}>
        <Text variant="h3" color={colors.textHi}>
          Log out?
        </Text>
        <Text variant="caption" muted style={styles.sheetBody}>
          You&apos;ll need to sign in again to access this wallet. Your funds stay safe on-chain.
        </Text>
        <View style={styles.sheetActions}>
          <Button label="Log out" icon="logout" variant="danger" onPress={doLogout} />
          <Button label="Cancel" variant="ghost" onPress={() => setConfirm(null)} />
        </View>
      </Sheet>

      {/* Confirm: remove 2FA */}
      <Sheet open={confirm === 'mfa-off'} onClose={() => setConfirm(null)}>
        <Text variant="h3" color={colors.textHi}>
          Remove two-factor authentication?
        </Text>
        <Text variant="caption" muted style={styles.sheetBody}>
          Your account will be less secure without a second factor.
        </Text>
        <View style={styles.sheetActions}>
          <Button label="Remove" variant="danger" onPress={removeMfa} />
          <Button label="Cancel" variant="ghost" onPress={() => setConfirm(null)} />
        </View>
      </Sheet>

      {/* Confirm: remove passkey 2FA */}
      <Sheet open={confirm === 'mfa-passkey-off'} onClose={() => setConfirm(null)}>
        <Text variant="h3" color={colors.textHi}>
          Remove passkey two-factor?
        </Text>
        <Text variant="caption" muted style={styles.sheetBody}>
          Your passkey will stay usable for login — only its role as a second
          factor will be removed.
        </Text>
        <View style={styles.sheetActions}>
          <Button label="Remove" variant="danger" onPress={removePasskeyMfa} />
          <Button label="Cancel" variant="ghost" onPress={() => setConfirm(null)} />
        </View>
      </Sheet>

      {/* Flow sheets */}
      <LinkEmailSheet open={sheet === 'email'} onClose={() => setSheet(null)} onDone={() => setSheet(null)} />
      <MfaEnrollSheet open={sheet === 'mfa'} onClose={() => setSheet(null)} onDone={() => setSheet(null)} />
      <RecoverySheet open={sheet === 'recovery'} onClose={() => setSheet(null)} onDone={() => setSheet(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    marginBottom: space.lg,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.xs,
  },
  identityText: {
    flex: 1,
    minWidth: 0,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexShrink: 0,
  },
  addrPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 4,
    paddingVertical: 4,
    paddingHorizontal: space.md,
    backgroundColor: colors.glassFill,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
  },
  listCard: {
    marginTop: space.sm,
    padding: space.xs,
  },
  row: {
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  sectionTitle: {
    marginTop: space.xl,
    marginBottom: space.sm,
  },
  textBtn: {
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
  },
  logout: {
    marginTop: space.xxl,
  },
  sheetBody: {
    marginTop: space.sm,
  },
  sheetActions: {
    marginTop: space.xl,
    gap: space.md,
  },
});
