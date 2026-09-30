import { Link } from 'react-router-dom';

export function Brand({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      to="/dashboard"
      onClick={onNavigate}
      aria-label="Nivaas dashboard"
      className="group inline-flex min-h-11 items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
    >
      <span aria-hidden="true" className="grid size-10 place-items-center rounded-md bg-accent font-headline text-xl font-bold text-foreground">N</span>
      <span translate="no" className="font-headline text-xl font-bold tracking-tight">Nivaas</span>
    </Link>
  );
}
