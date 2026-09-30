import { NavLink } from 'react-router-dom';
import { navigationItems, type NavigationGroup } from '@/routes/navigation';

const groups: NavigationGroup[] = ['Overview', 'Society', 'Records'];

export function SidebarNavigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Primary navigation" className="space-y-6">
      {groups.map((group) => {
        const items = navigationItems.filter((item) => item.group === group);
        return (
          <section key={group} aria-labelledby={`navigation-${group.toLowerCase()}`}>
            <h2 id={`navigation-${group.toLowerCase()}`} className="mb-2 px-3 font-mono text-[0.65rem] font-medium uppercase tracking-[0.12em] text-muted-foreground">{group}</h2>
            <ul className="space-y-1">
              {items.map(({ label, path, icon: Icon }) => (
                <li key={path}>
                  <NavLink
                    to={path}
                    onClick={onNavigate}
                    className={({ isActive }) => `flex min-h-11 items-center gap-3 rounded-md border-l-2 px-3 text-sm font-semibold transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${isActive ? 'border-primary bg-accent text-foreground' : 'border-transparent text-foreground/80 hover:bg-accent/70 hover:text-foreground'}`}
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
