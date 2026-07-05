'use client';
import React from 'react';
import { colors, gradients } from '@/ui/theme';
import { Gradient } from '@/ui/Gradient';
import { Icon } from '@/ui/Icon';
import { Text } from '@/ui/Text';

/** Full-screen Navy loading splash — shown while auth/session state settles,
 *  so protected screens never flash before we know where to route. */
export function Splash() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100dvh',
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
