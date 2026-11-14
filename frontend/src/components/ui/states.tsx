import { LoaderCircle } from 'lucide-react';
import { Button } from './button';

export function LoadingState({ label = 'Loading Nivaas records' }: { label?: string }) {
  return (
    <div className="motion-item flex items-center gap-2 py-5 text-sm text-muted-foreground" role="status">
      <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" size={18} />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-state motion-item py-6">
        <h3 className="font-headline text-lg font-bold">{title}</h3>
        <p className="max-w-xl text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', description, onRetry }: { title?: string; description: string; onRetry?: () => void }) {
  return (
    <div className="error-state motion-item py-4" role="alert">
        <h3 className="font-headline text-lg font-bold">{title}</h3>
        <p className="max-w-xl text-sm leading-6 text-muted-foreground">{description}</p>
        {onRetry ? <Button variant="outline" onClick={onRetry}>Try again</Button> : null}
    </div>
  );
}

export function PermissionDeniedState() {
  return (
    <div className="permission-state motion-item max-w-xl py-5">
        <h3 className="font-headline text-lg font-bold">Permission required</h3>
        <p className="max-w-xl text-sm leading-6 text-muted-foreground">Your account does not have access to this area. Nivaas permissions are enforced by the backend.</p>
    </div>
  );
}
