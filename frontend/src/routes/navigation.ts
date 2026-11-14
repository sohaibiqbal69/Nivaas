import {
  Blocks, BookOpenCheck, CircleDollarSign, ClipboardList,
  FileCheck2, FileText, Landmark, LayoutDashboard, MessagesSquare, ShieldCheck, Users,
  type LucideIcon,
} from 'lucide-react';

export type NavigationGroup = 'Overview' | 'Society' | 'Records' | 'Administration';

export type NavigationItem = {
  label: string;
  path: string;
  description: string;
  group: NavigationGroup;
  icon: LucideIcon;
  roles?: readonly string[];
};

export const navigationItems: NavigationItem[] = [
  { label: 'Dashboard', path: '/dashboard', description: 'A summary of society governance and transparency activity.', group: 'Overview', icon: LayoutDashboard },
  { label: 'Projects', path: '/projects', description: 'Project progress, approvals, and completion records for the society.', group: 'Society', icon: Blocks, roles: ['SYSTEM_ADMIN', 'SOCIETY_MANAGER', 'COMMITTEE_MEMBER', 'OWNER_MEMBER'] },
  { label: 'Budget', path: '/budgets', description: 'Approved society budget and recorded spending.', group: 'Society', icon: CircleDollarSign, roles: ['SYSTEM_ADMIN', 'SOCIETY_MANAGER', 'OWNER_MEMBER'] },
  { label: 'Quotations', path: '/quotations', description: 'Quotation versions, vendor comparisons, and change requests.', group: 'Society', icon: FileCheck2, roles: ['SYSTEM_ADMIN', 'SOCIETY_MANAGER', 'COMMITTEE_MEMBER', 'OWNER_MEMBER'] },
  { label: 'Voting', path: '/voting', description: 'Governance voting information.', group: 'Society', icon: BookOpenCheck },
  { label: 'Governance Settings', path: '/society/settings/governance', description: 'Review and configure this society’s versioned project approval threshold.', group: 'Society', icon: ShieldCheck, roles: ['SOCIETY_MANAGER'] },
  { label: 'Members & Flats', path: '/members', description: 'Manage existing society memberships and flat relationships.', group: 'Society', icon: Users, roles: ['SOCIETY_MANAGER'] },
  { label: 'Complaints', path: '/complaints', description: 'Raise and track complaints and society-manager responses.', group: 'Society', icon: MessagesSquare, roles: ['SOCIETY_MANAGER', 'OWNER_MEMBER', 'RESIDENT'] },
  { label: 'Notice Board', path: '/notices', description: 'Notices published for the society.', group: 'Society', icon: FileText },
  { label: 'Payments', path: '/payments', description: 'Payment records for the society.', group: 'Records', icon: Landmark },
  { label: 'Audit Trail', path: '/audit', description: 'Society-scoped audit events and record-integrity checks.', group: 'Records', icon: ClipboardList, roles: ['SYSTEM_ADMIN', 'SOCIETY_MANAGER', 'COMMITTEE_MEMBER', 'OWNER_MEMBER'] },
  { label: 'Blockchain', path: '/blockchain', description: 'Read-only verification status for society integrity proofs.', group: 'Records', icon: ShieldCheck, roles: ['SYSTEM_ADMIN', 'SOCIETY_MANAGER', 'COMMITTEE_MEMBER', 'OWNER_MEMBER'] },
  { label: 'Societies', path: '/administration/societies', description: 'Create and review platform society records.', group: 'Administration', icon: Landmark, roles: ['SYSTEM_ADMIN'] },
  { label: 'Users & Admin', path: '/administration/users', description: 'Provision society manager accounts.', group: 'Administration', icon: Users, roles: ['SYSTEM_ADMIN'] },
];
