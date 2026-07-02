'use client';
import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { useNavySession } from '@/lib/auth/SessionContext';
import { colors, gradients } from '@/ui/theme';
import { Gradient } from '@/ui/Gradient';
import { Icon } from '@/ui/Icon';
import { Text } from '@/ui/Text';

export default function Index() {
  const { ready } = usePrivy();
  const { session, initializing } = useNavySession();
  const router = useRouter();

  const loading = !ready || initializing;

  useEffect(() => {
    if (!loading) router.replace(session ? '/home' : '/login');
  }, [loading, session, router]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: colors.bg,
      }}
    >
      <div style={{ animation: 'navy-pulse 1.8s ease-in-out infinite' }}>
        <Gradient
          colors={gradients.ocean}
          style={{
            width: 84,
            height: 84,
            borderRadius: 26,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="wallet" size={38} color={colors.onAccent} strokeWidth={2} />
        </Gradient>
      </div>
      <Text variant="label" muted upper style={{ marginTop: 24 }}>
        Navy
      </Text>
    </div>
  );
}
