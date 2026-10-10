import { AlertCircle, CircleDashed, LoaderCircle, ShieldAlert } from 'lucide-react';
import { Button } from './button';
import { Card, CardContent } from './card';

export function LoadingState({ label = 'Loading Nivaas records' }: { label?: string }) {
  return (
    <div className="motion-item flex min-h-40 items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card/60 p-8 text-sm text-muted-foreground" role="status">
      <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" size={18} />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <Card className="motion-item border-dashed">
      <CardContent className="flex flex-col items-start gap-3 py-10">
        <CircleDashed aria-hidden="true" className="text-secondary" size={24} />
        <h3 className="font-headline text-lg font-bold">{title}</h3>
        <p className="max-w-xl text-sm leading-6 text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

export function ErrorState({ title = 'Something went wrong', description, onRetry }: { title?: string; description: string; onRetry?: () => void }) {
  return (
    <Card className="motion-item border-danger/40">
      <CardContent className="flex flex-col items-start gap-3 py-10">
        <AlertCircle aria-hidden="true" className="text-danger" size={24} />
        <h3 className="font-headline text-lg font-bold">{title}</h3>
        <p className="max-w-xl text-sm leading-6 text-muted-foreground">{description}</p>
        {onRetry ? <Button variant="outline" onClick={onRetry}>Try again</Button> : null}
      </CardContent>
    </Card>
  );
}

export function PermissionDeniedState() {
  return (
    <Card className="motion-item border-warning/40">
      <CardContent className="flex flex-col items-start gap-3 py-10">
        <ShieldAlert aria-hidden="true" className="text-warning" size={24} />
        <h3 className="font-headline text-lg font-bold">Permission required</h3>
        <p className="max-w-xl text-sm leading-6 text-muted-foreground">Your account does not have access to this area. Nivaas permissions are enforced by the backend.</p>
      </CardContent>
    </Card>
  );
}
