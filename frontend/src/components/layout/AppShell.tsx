import { useEffect, useRef, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { navigationItems } from '@/routes/navigation';
import { Button } from '@/components/ui/button';
import { Brand } from './Brand';
import { SidebarNavigation } from './SidebarNavigation';

function NavigationPanel({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-5 py-5"><Brand onNavigate={onNavigate} /></div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-5"><SidebarNavigation onNavigate={onNavigate} /></div>
      <p className="border-t border-border/70 px-5 py-4 text-xs leading-5 text-muted-foreground">Society information will appear here when Nivaas services are connected.</p>
    </div>
  );
}

export function AppShell() {
  const location = useLocation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const current = navigationItems.find((item) => item.path === location.pathname);
  const title = current?.label ?? (location.pathname === '/' ? 'Dashboard' : 'Page not found');

  useEffect(() => {
    setMobileNavigationOpen(false);
    if (dialogRef.current?.open) dialogRef.current.close();
  }, [location.pathname]);

  function openMobileNavigation() {
    dialogRef.current?.showModal();
    setMobileNavigationOpen(true);
  }

  function closeMobileNavigation() {
    dialogRef.current?.close();
    setMobileNavigationOpen(false);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a href="#main-content" className="sr-only z-50 rounded-md bg-background px-4 py-3 font-semibold text-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:outline-2 focus:outline-offset-2 focus:outline-ring">Skip to main content</a>

      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-border/70 bg-sidebar md:block" aria-label="Application sidebar">
        <NavigationPanel />
      </aside>

      <dialog
        ref={dialogRef}
        id="mobile-navigation"
        aria-label="Nivaas navigation"
        onClose={() => setMobileNavigationOpen(false)}
        onClick={(event) => { if (event.target === dialogRef.current) closeMobileNavigation(); }}
        className="fixed inset-y-0 left-0 m-0 h-full max-h-none w-[min(20rem,88vw)] max-w-none border-0 bg-sidebar p-0 text-foreground shadow-xl backdrop:bg-foreground/35 open:flex open:flex-col md:hidden"
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-border/70 px-5">
            <Brand onNavigate={closeMobileNavigation} />
            <Button variant="ghost" size="icon" aria-label="Close navigation" onClick={closeMobileNavigation}>
              <X aria-hidden="true" size={20} />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto"><NavigationPanel onNavigate={closeMobileNavigation} /></div>
        </div>
      </dialog>

      <div className="min-h-screen md:pl-64">
        <header className="sticky top-0 z-10 border-b border-border/70 bg-background/95 backdrop-blur-sm">
          <div className="mx-auto flex min-h-[4.5rem] max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <Button className="md:hidden" variant="outline" size="icon" aria-label="Open navigation" aria-controls="mobile-navigation" aria-expanded={mobileNavigationOpen} aria-haspopup="dialog" onClick={openMobileNavigation}>
                <Menu aria-hidden="true" size={20} />
              </Button>
              <div className="min-w-0">
                <p className="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted-foreground">Society workspace</p>
                <h1 className="truncate font-headline text-lg font-bold sm:text-xl">{title}</h1>
              </div>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">Frontend foundation</span>
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-7xl px-4 py-7 outline-none sm:px-6 sm:py-9 lg:px-8">
          <Outlet />
          <footer className="mt-12 border-t border-border/70 pt-5 text-xs leading-5 text-muted-foreground">
            <p>Nivaas presents society information. Governance and application decisions belong to the system services defined for Nivaas.</p>
            <p className="mt-1"><Link to="/blockchain" className="font-semibold text-info underline decoration-info/40 underline-offset-4 hover:decoration-info focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">About integrity proofs</Link></p>
          </footer>
        </main>
      </div>
    </div>
  );
}
