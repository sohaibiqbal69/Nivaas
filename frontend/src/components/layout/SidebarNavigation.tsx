import { NavLink } from 'react-router-dom';
import { navigationItems, type NavigationGroup } from '@/routes/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { pressFeedback } from '@/lib/motion';

const groups: NavigationGroup[] = ['Overview', 'Society', 'Records', 'Administration'];

export function SidebarNavigation({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  const visibleItems = navigationItems.filter((item) => !item.roles || (user && item.roles.includes(user.role)));
  return (
    <nav aria-label="Primary navigation" className="space-y-6">
      {groups.map((group) => {
        const items = visibleItems.filter((item) => item.group === group);
        if (items.length === 0) return null;
        return (
          <section key={group} aria-labelledby={`navigation-${group.toLowerCase()}`}>
            <h2 id={`navigation-${group.toLowerCase()}`} className="mb-2 px-3 text-xs font-semibold text-muted-foreground">{group}</h2>
            <ul className="space-y-1">
              {items.map(({ label, path, icon: Icon }) => (
                <li key={path}>
                  <NavLink
                    to={path}
                    onClick={onNavigate}
                    onPointerDown={(event) => pressFeedback(event.currentTarget)}
                    className={({ isActive }) => `sidebar-link flex min-h-11 items-center gap-3 rounded-md border-l-2 px-3 text-sm font-semibold transition-[color,background-color,box-shadow,transform] duration-200 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${isActive ? 'border-primary bg-accent text-foreground' : 'border-transparent text-foreground/80 hover:bg-accent/70 hover:text-foreground'}`}
                  >
                    <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
                    <span>{label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}
