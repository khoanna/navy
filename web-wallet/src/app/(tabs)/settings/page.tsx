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

/** A settings list row — matches the history list treatment: a muted (textDim)
 *  leading badge, title (+optional subtitle), and a trailing slot. Colour is
 *  reserved for interactive/semantic bits, not decoration. */
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
  const ellipsis: React.CSSProperties = {
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };
  return (
    <PressRow onPress={onPress} style={styles.row}>
      <IconBadge name={icon} color={colors.textDim} size={44} />
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
      <Card glass compact>
        <div style={styles.identity}>
          <div style={{ ...styles.avatar, backgroundImage: `linear-gradient(135deg, ${avA}, ${avB})` }} />
          <div style={{ minWidth: 0 }}>
            <Text variant="bodyStrong" color={colors.textHi} style={styles.ellipsis}>
              {primary}
            </Text>
            <button onClick={copyAddress} aria-label="Copy wallet address" style={styles.addrPill}>
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
      <Card glass compact style={styles.listCard}>
        {rows.map((r) => (
          <Row
            key={r.key}
            icon={r.icon}
            title={r.label}
            subtitle={r.subtitle}
            trailing={
              unlinkable ? (
                <button onClick={() => unlink(r.provider, r.unlinkId)} style={styles.textBtn}>
                  <Text variant="label" color={colors.textDim}>
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
            title={LINK_META[p].label}
            onPress={() => link(p)}
            trailing={<Icon name="plus" size={18} color={colors.textMute} />}
          />
        ))}
      </Card>

      {/* Wallet security */}
      <SectionTitle>Wallet security</SectionTitle>
      <Card glass compact style={styles.listCard}>
        <Row
          icon="shield"
          title="Set up recovery"
          subtitle="Password, iCloud, or Google Drive backup"
          onPress={recover}
          trailing={<Chevron />}
        />
        <Row
          icon="key"
          title="Export private key"
          subtitle="Reveal your key to import elsewhere"
          onPress={() => setConfirm('export')}
          trailing={<Chevron />}
        />
      </Card>

      {/* Login & security */}
      <SectionTitle>Login &amp; security</SectionTitle>
      <Card glass compact style={styles.listCard}>
        <Row
          icon="key"
          title="Add a passkey"
          subtitle="Sign in with Face ID / Touch ID"
          onPress={() => linkWithPasskey()}
          trailing={<Icon name="plus" size={18} color={colors.textMute} />}
        />
        <Row
          icon="shield"
          title="Two-factor authentication"
          subtitle="Authenticator app, SMS, or passkey"
          onPress={() => showMfaEnrollmentModal()}
          trailing={<Chevron />}
        />
      </Card>

      {/* Log out — the one deliberate destructive action */}
      <div style={{ marginTop: `${space.xxl}px` }}>
        <Button label="Log out" icon="logout" variant="danger" onPress={() => setConfirm('logout')} />
      </div>

      {/* Confirm: export private key */}
      <Sheet open={confirm === 'export'} onClose={() => setConfirm(null)}>
        <Text variant="h3" color={colors.textHi}>
          Export private key?
        </Text>
        <Text variant="caption" muted style={styles.sheetBody}>
          Anyone with your private key controls this wallet. Only reveal it somewhere private. Privy shows it in a secure window this app cannot read.
        </Text>
        <div style={styles.sheetActions}>
          <Button label="Reveal private key" icon="key" variant="danger" onPress={doExport} />
          <Button label="Cancel" variant="ghost" onPress={() => setConfirm(null)} />
        </div>
      </Sheet>

      {/* Confirm: log out */}
      <Sheet open={confirm === 'logout'} onClose={() => setConfirm(null)}>
        <Text variant="h3" color={colors.textHi}>
          Log out?
        </Text>
        <Text variant="caption" muted style={styles.sheetBody}>
          You&apos;ll need to sign in again to access this wallet. Your funds stay safe on-chain.
        </Text>
        <div style={styles.sheetActions}>
          <Button label="Log out" icon="logout" variant="danger" onPress={doLogout} />
          <Button label="Cancel" variant="ghost" onPress={() => setConfirm(null)} />
        </div>
      </Sheet>
    </Screen>
  );
}

const styles = {
  identity: {
    display: 'flex',
    flexDirection: 'row' as const,
    alignItems: 'center',
    gap: `${space.md}px`,
    minWidth: 0,
    padding: `${space.xs}px`,
  } as React.CSSProperties,
  avatar: {
    width: 46,
    height: 46,
    borderRadius: `${radius.pill}px`,
    border: '1px solid rgba(255,255,255,0.35)',
    flexShrink: 0,
  } as React.CSSProperties,
  addrPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    marginTop: '4px',
    padding: '4px 10px',
    background: colors.glassFill,
    border: `1px solid ${colors.border}`,
    borderRadius: `${radius.pill}px`,
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  } as React.CSSProperties,
  listCard: {
    marginTop: `${space.sm}px`,
    padding: `${space.xs}px`,
  } as React.CSSProperties,
  row: {
    gap: `${space.md}px`,
    padding: `${space.md}px`,
  } as React.CSSProperties,
  sectionTitle: {
    display: 'block',
    marginTop: `${space.xl}px`,
    marginBottom: `${space.sm}px`,
  } as React.CSSProperties,
  ellipsis: {
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as React.CSSProperties,
  textBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: `${space.xs}px ${space.sm}px`,
  } as React.CSSProperties,
  sheetBody: {
    display: 'block',
    marginTop: `${space.sm}px`,
  } as React.CSSProperties,
  sheetActions: {
    marginTop: `${space.xl}px`,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: `${space.md}px`,
  } as React.CSSProperties,
} satisfies Record<string, React.CSSProperties>;
