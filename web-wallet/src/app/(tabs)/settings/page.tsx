'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  usePrivy,
  useLinkAccount,
  useLinkWithPasskey,
  useSetWalletRecovery,
  useMfaEnrollment,
} from '@privy-io/react-auth';
import { useExportWallet } from '@privy-io/react-auth/solana';
import { useNavySession } from '@/lib/auth/SessionContext';
import { useWebSigner } from '@/lib/wallet/useWebSigner';
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

const LINK_META: Record<'email' | 'google' | 'apple', { label: string; icon: IconName }> = {
  email: { label: 'Link email', icon: 'mail' },
  google: { label: 'Link Google', icon: 'shield' },
  apple: { label: 'Link Apple', icon: 'shield' },
};

/** A settings list row: leading badge, title (+optional subtitle), trailing slot. */
function Row({
  icon,
  iconColor,
  title,
  subtitle,
  trailing,
  onPress,
}: {
  icon: IconName;
  iconColor?: string;
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
}) {
  const ellipsis: React.CSSProperties = {
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };
  return (
    <PressRow
      onPress={onPress}
      style={{ gap: `${space.md}px`, paddingTop: `${space.sm}px`, paddingBottom: `${space.sm}px` }}
    >
      <IconBadge name={icon} color={iconColor ?? colors.accent} size={40} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text variant="bodyStrong" color={colors.textHi} style={ellipsis}>
          {title}
        </Text>
        {subtitle && (
          <Text variant="caption" muted style={ellipsis}>
            {subtitle}
          </Text>
        )}
      </div>
      {trailing}
    </PressRow>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text variant="label" muted upper style={{ display: 'block', marginTop: `${space.xl}px`, marginBottom: `${space.sm}px` }}>
      {children}
    </Text>
  );
}

export default function Settings() {
  const router = useRouter();
  const toast = useToast();
  const { signOut } = useNavySession();
  const { address } = useWebSigner();

  const { user, unlinkEmail, unlinkGoogle, unlinkApple, unlinkPasskey } = usePrivy();
  const { linkEmail, linkGoogle, linkApple } = useLinkAccount({
    onSuccess: () => toast('Account linked'),
    onError: () => toast('Could not link account'),
  });
  const { linkWithPasskey } = useLinkWithPasskey({
    onSuccess: () => toast('Passkey added'),
    onError: () => toast('Could not add passkey'),
  });
  const { setWalletRecovery } = useSetWalletRecovery();
  const { exportWallet } = useExportWallet();
  const { showMfaEnrollmentModal } = useMfaEnrollment();

  const [confirm, setConfirm] = useState<null | 'export' | 'logout'>(null);
  const [copied, setCopied] = useState(false);

  const rows = describeLinkedAccounts(user);
  const unlinkable = canUnlink(user);
  const toLink = linkableProviders(user);
  const [avA, avB] = avatarColors(address);
  const primary = user?.email?.address ?? short(address);

  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  const unlink = async (provider: ProviderId, id: string) => {
    try {
      if (provider === 'email') await unlinkEmail(id);
      else if (provider === 'google') await unlinkGoogle(id);
      else if (provider === 'apple') await unlinkApple(id);
      else await unlinkPasskey(id);
      toast('Account unlinked');
    } catch {
      toast('Could not unlink account');
    }
  };

  const link = (provider: 'email' | 'google' | 'apple') => {
    if (provider === 'email') linkEmail();
    else if (provider === 'google') linkGoogle();
    else linkApple();
  };

  const recover = async () => {
    try {
      await setWalletRecovery();
      toast('Recovery updated');
    } catch {
      /* user dismissed the Privy modal */
    }
  };

  const doExport = async () => {
    setConfirm(null);
    if (!address) return;
    try {
      await exportWallet({ address });
    } catch {
      /* user dismissed the export modal */
    }
  };

  const doLogout = async () => {
    setConfirm(null);
    await signOut();
    router.replace('/login');
  };

  return (
    <Screen scroll tabSafe>
      <Text variant="h2" color={colors.textHi} style={{ display: 'block', marginBottom: `${space.lg}px` }}>
        Settings
      </Text>

      {/* Identity header */}
      <Card>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: `${space.md}px`, minWidth: 0 }}>
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: `${radius.pill}px`,
              backgroundImage: `linear-gradient(135deg, ${avA}, ${avB})`,
              border: '1px solid rgba(255,255,255,0.4)',
              flexShrink: 0,
            }}
          />
          <div style={{ minWidth: 0 }}>
            <Text variant="bodyStrong" color={colors.textHi} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {primary}
            </Text>
            <button
              onClick={copyAddress}
              aria-label="Copy wallet address"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                marginTop: '4px',
                padding: '4px 10px',
                background: colors.glassFill,
                border: `1px solid ${colors.border}`,
                borderRadius: `${radius.pill}px`,
                cursor: 'pointer',
              }}
            >
              <Text variant="caption" numeric color={colors.textDim}>
                {short(address)}
              </Text>
              <Icon name={copied ? 'check' : 'copy'} size={13} color={colors.textDim} />
            </button>
          </div>
        </div>
      </Card>

      {/* Linked accounts */}
      <SectionTitle>Linked accounts</SectionTitle>
      <Card compact>
        {rows.map((r) => (
          <Row
            key={r.key}
            icon={r.icon}
            title={r.label}
            subtitle={r.subtitle}
            trailing={
              unlinkable ? (
                <button
                  onClick={() => unlink(r.provider, r.unlinkId)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: `${space.xs}px ${space.sm}px` }}
                >
                  <Text variant="label" color={colors.danger}>
                    Unlink
                  </Text>
                </button>
              ) : undefined
            }
          />
        ))}
        {toLink.map((p) => (
          <Row
            key={`link-${p}`}
            icon={LINK_META[p].icon}
            iconColor={colors.aqua}
            title={LINK_META[p].label}
            onPress={() => link(p)}
            trailing={<Icon name="plus" size={18} color={colors.textDim} />}
          />
        ))}
      </Card>

      {/* Wallet security */}
      <SectionTitle>Wallet security</SectionTitle>
      <Card compact>
        <Row
          icon="shield"
          title="Set up recovery"
          subtitle="Password, iCloud, or Google Drive backup"
          onPress={recover}
          trailing={<Icon name="chevron" size={18} color={colors.textDim} />}
        />
        <Row
          icon="key"
          iconColor={colors.warning}
          title="Export private key"
          subtitle="Reveal your key to import elsewhere"
          onPress={() => setConfirm('export')}
          trailing={<Icon name="chevron" size={18} color={colors.textDim} />}
        />
      </Card>

      {/* Login & security */}
      <SectionTitle>Login &amp; security</SectionTitle>
      <Card compact>
        <Row
          icon="key"
          title="Add a passkey"
          subtitle="Sign in with Face ID / Touch ID"
          onPress={() => linkWithPasskey()}
          trailing={<Icon name="plus" size={18} color={colors.textDim} />}
        />
        <Row
          icon="shield"
          title="Two-factor authentication"
          subtitle="Authenticator app, SMS, or passkey"
          onPress={() => showMfaEnrollmentModal()}
          trailing={<Icon name="chevron" size={18} color={colors.textDim} />}
        />
      </Card>

      {/* Log out */}
      <div style={{ marginTop: `${space.xxl}px` }}>
        <Button label="Log out" icon="logout" variant="danger" onPress={() => setConfirm('logout')} />
      </div>

      {/* Confirm: export private key */}
      <Sheet open={confirm === 'export'} onClose={() => setConfirm(null)}>
        <Text variant="h3" color={colors.textHi}>
          Export private key?
        </Text>
        <Text variant="caption" muted style={{ display: 'block', marginTop: `${space.sm}px` }}>
          Anyone with your private key controls this wallet. Only reveal it somewhere private. Privy shows it in a secure window this app cannot read.
        </Text>
        <div style={{ marginTop: `${space.xl}px`, display: 'flex', flexDirection: 'column', gap: `${space.md}px` }}>
          <Button label="Reveal private key" icon="key" variant="danger" onPress={doExport} />
          <Button label="Cancel" variant="ghost" onPress={() => setConfirm(null)} />
        </div>
      </Sheet>

      {/* Confirm: log out */}
      <Sheet open={confirm === 'logout'} onClose={() => setConfirm(null)}>
        <Text variant="h3" color={colors.textHi}>
          Log out?
        </Text>
        <Text variant="caption" muted style={{ display: 'block', marginTop: `${space.sm}px` }}>
          You&apos;ll need to sign in again to access this wallet. Your funds stay safe on-chain.
        </Text>
        <div style={{ marginTop: `${space.xl}px`, display: 'flex', flexDirection: 'column', gap: `${space.md}px` }}>
          <Button label="Log out" icon="logout" variant="danger" onPress={doLogout} />
          <Button label="Cancel" variant="ghost" onPress={() => setConfirm(null)} />
        </div>
      </Sheet>
    </Screen>
  );
}
