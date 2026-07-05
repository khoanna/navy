import type { NavItem } from './Sidebar';

export const ADMIN_NAV: NavItem[] = [
  { href: '/admin', label: 'Overview', icon: 'chart' },
  { href: '/admin/merchants', label: 'Merchants', icon: 'store' },
];

export const MERCHANT_NAV: NavItem[] = [
  { href: '/merchant', label: 'Overview', icon: 'chart' },
  { href: '/merchant/orders', label: 'Orders', icon: 'orders' },
  { href: '/merchant/orders/new', label: 'New Invoice', icon: 'plus' },
];
