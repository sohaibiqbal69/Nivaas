import { Link } from 'react-router-dom';

export function Brand({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      to="/dashboard"
      onClick={onNavigate}
      aria-label="Nivaas dashboard"
      className="nivaas-brand group inline-flex min-h-12 items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
    >
      <img
        src="/assets/nivaas-mark-small.png"
        alt=""
        width="48"
        height="48"
        className="nivaas-brand-mark size-12 shrink-0 object-contain"
        decoding="async"
      />
      <img
        src="/assets/nivaas-wordmark.png"
        alt="Nivaas"
        width="1200"
        height="400"
        className="nivaas-brand-wordmark block h-auto w-32"
        decoding="async"
      />
    </Link>
  );
}
