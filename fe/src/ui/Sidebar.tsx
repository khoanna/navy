// fe/src/ui/Sidebar.tsx
'use client';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { colors, space, radius, gradients } from './theme';
import { Text } from './Text';
import { Icon, IconName } from './Icon';

export interface NavItem { href: string; label: string; icon: IconName; }
export interface Identity { title: string; subtitle: string; }

export function Sidebar({ items, identity, onLogout }: { items: NavItem[]; identity: Identity; onLogout?: () => void }) {
  const pathname = usePathname();
  return (
    <aside style={{ width: 248, flexShrink: 0, display: 'flex', flexDirection: 'column', padding: space.xl, gap: space.xs, borderRight: `1px solid ${colors.border}`, background: 'rgba(11,19,34,0.55)', backdropFilter: 'blur(14px)', position: 'sticky', top: 0, height: '100dvh' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, padding: `${space.sm}px ${space.sm}px ${space.xl}px` }}>
        <div style={{ width: 34, height: 34, borderRadius: radius.md, background: `linear-gradient(135deg, ${gradients.ocean[0]}, ${gradients.ocean[1]})`, display: 'grid', placeItems: 'center' }}>
          <Icon name="wallet" size={18} color={colors.onAccent} />
        </div>
        <Text variant="h3" color={colors.textHi}>Navy</Text>
      </div>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: space.xs }}>
        {items.map((it) => {
          const active = pathname === it.href || (it.href !== '/' && pathname?.startsWith(it.href + '/'));
          return (
            <Link key={it.href} href={it.href} style={{ display: 'flex', alignItems: 'center', gap: space.md, padding: `${space.md}px ${space.md}px`, borderRadius: radius.md, background: active ? `linear-gradient(135deg, ${gradients.ocean[0]}, ${gradients.ocean[1]})` : 'transparent', color: active ? colors.onAccent : colors.textDim, boxShadow: active ? '0 6px 16px rgba(23,196,168,0.28)' : undefined }}>
              <Icon name={it.icon} size={20} color={active ? colors.onAccent : colors.textDim} />
              <Text variant="bodyStrong" color={active ? colors.onAccent : colors.text}>{it.label}</Text>
            </Link>
          );
        })}
      </nav>
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: space.sm, paddingTop: space.lg, borderTop: `1px solid ${colors.border}` }}>
        <div style={{ padding: `${space.sm}px ${space.md}px` }}>
          <Text variant="bodyStrong" color={colors.textHi}>{identity.title}</Text>
          <Text variant="caption" dim>{identity.subtitle}</Text>
        </div>
        {onLogout && (
          <button onClick={onLogout} style={{ display: 'flex', alignItems: 'center', gap: space.md, padding: `${space.md}px`, borderRadius: radius.md, color: colors.danger }}>
            <Icon name="logout" size={20} color={colors.danger} />
            <Text variant="bodyStrong" color={colors.danger}>Log out</Text>
          </button>
        )}
      </div>
    </aside>
  );
}
