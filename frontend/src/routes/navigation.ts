import {
  Blocks, BookOpenCheck, CalendarDays, CircleDollarSign, ClipboardList,
  FileCheck2, FileText, Landmark, LayoutDashboard, MessagesSquare, ShieldCheck, Users,
  type LucideIcon,
} from 'lucide-react';

export type NavigationGroup = 'Overview' | 'Society' | 'Records';

export type NavigationItem = {
  label: string;
  path: string;
  description: string;
  group: NavigationGroup;
  icon: LucideIcon;
};

export const navigationItems: NavigationItem[] = [
  { label: 'Dashboard', path: '/dashboard', description: 'A summary of society governance and transparency activity.', group: 'Overview', icon: LayoutDashboard },
  { label: 'Projects', path: '/projects', description: 'Project information and progress for the society.', group: 'Society', icon: Blocks },
  { label: 'Budget', path: '/budgets', description: 'Society budget information and related records.', group: 'Society', icon: CircleDollarSign },
  { label: 'Quotations', path: '/quotations', description: 'Quotation records associated with society projects.', group: 'Society', icon: FileCheck2 },
  { label: 'Meetings', path: '/meetings', description: 'Meeting information and governance activity.', group: 'Society', icon: CalendarDays },
  { label: 'Voting', path: '/voting', description: 'Governance voting information.', group: 'Society', icon: BookOpenCheck },
  { label: 'Complaints', path: '/complaints', description: 'The society complaints area.', group: 'Society', icon: MessagesSquare },
  { label: 'Notice Board', path: '/notices', description: 'Notices published for the society.', group: 'Society', icon: FileText },
  { label: 'Payments', path: '/payments', description: 'Payment records for the society.', group: 'Records', icon: Landmark },
  { label: 'Audit Trail', path: '/audit', description: 'Audit information and historical records.', group: 'Records', icon: ClipboardList },
  { label: 'Blockchain', path: '/blockchain', description: 'Integrity proofs associated with application records.', group: 'Records', icon: ShieldCheck },
  { label: 'Users & Admin', path: '/administration', description: 'The documented users and administration area.', group: 'Records', icon: Users },
];
