import {
  ArrowLeftRight,
  Coins,
  CreditCard,
  LayoutDashboard,
  PiggyBank,
  Receipt,
  Settings,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Shown in the mobile bottom bar; the rest live behind "More". */
  primaryOnMobile?: boolean;
}

/** One source of truth for both the sidebar and the mobile bar. */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, primaryOnMobile: true },
  { to: '/transactions', label: 'Transactions', icon: Receipt, primaryOnMobile: true },
  { to: '/accounts', label: 'Accounts', icon: Wallet },
  { to: '/debts', label: 'Debts', icon: CreditCard, primaryOnMobile: true },
  { to: '/savings', label: 'Savings', icon: PiggyBank },
  { to: '/budgets', label: 'Budgets', icon: Coins },
  { to: '/currency', label: 'Currency', icon: ArrowLeftRight },
  { to: '/settings', label: 'Settings', icon: Settings },
];

/**
 * The four destinations flanking the centre "Add" button (SPEC §10). Five slots total,
 * and the middle one is the action, not a destination.
 */
export const MOBILE_PRIMARY = NAV_ITEMS.filter((item) => item.primaryOnMobile === true);

export const MOBILE_SECONDARY = NAV_ITEMS.filter((item) => item.primaryOnMobile !== true);
