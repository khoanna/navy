'use client';
import React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { colors, radius, space } from './theme';
import { Icon, IconName } from './Icon';
import { Text } from './Text';

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: '/home', label: 'Wallet', icon: 'home' },
  { href: '/scan', label: 'Pay', icon: 'scan' },
  { href: '/farming', label: 'Earn', icon: 'sprout' },
  { href: '/history', label: 'Activity', icon: 'clock' },
];

function TabItem({
  focused,
  label,
  icon,
  onClick,
}: {
  focused: boolean;
  label: string;
  icon: IconName;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: 'none',
        background: 'none',
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 3,
        paddingLeft: `${space.lg}px`,
        paddingRight: `${space.lg}px`,
        cursor: 'pointer',
      }}
    >
      <div
        style={{
          width: 44,
          height: 34,
          borderRadius: `${radius.md}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'transform 160ms ease, background 160ms ease',
          transform: focused ? 'translateY(-2px)' : 'translateY(0)',
          ...(focused ? { background: 'rgba(47,224,194,0.12)' } : null),
        }}
      >
        <Icon
          name={icon}
          size={22}
          color={focused ? colors.aqua : colors.textMute}
          strokeWidth={focused ? 2.2 : 1.8}
        />
      </div>
      <Text variant="label" color={focused ? colors.textHi : colors.textMute} style={{ fontSize: 10, letterSpacing: '0.5px' }}>
        {label}
      </Text>
    </button>
  );
}

export function TabBar() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        justifyContent: 'center',
        paddingBottom: `calc(${space.md}px + env(safe-area-inset-bottom))`,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          background: 'rgba(17,27,46,0.96)',
          borderRadius: `${radius.pill}px`,
          border: `1px solid ${colors.borderStrong}`,
          paddingLeft: `${space.sm}px`,
          paddingRight: `${space.sm}px`,
          paddingTop: `${space.sm}px`,
          paddingBottom: `${space.sm}px`,
          marginLeft: `${space.xl}px`,
          marginRight: `${space.xl}px`,
          boxShadow: '0 12px 24px rgba(0,0,0,0.45)',
          pointerEvents: 'auto',
        }}
      >
        {TABS.map((t) => {
          const focused = pathname === t.href || pathname.startsWith(`${t.href}/`);
          return (
            <TabItem
              key={t.href}
              focused={focused}
              label={t.label}
              icon={t.icon}
              onClick={() => {
                if (!focused) router.push(t.href);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
