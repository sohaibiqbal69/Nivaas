import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { usePageMotion } from '@/hooks/usePageMotion';

export function LoginPage() {
  const { isAuthenticated, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const pageRef = usePageMotion<HTMLDivElement>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const destination = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/dashboard';

  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate(destination, { replace: true });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Unable to sign in right now.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main ref={pageRef} className="grid min-h-screen place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="motion-item mb-8">
          <Link to="/login" className="font-headline text-3xl font-bold tracking-tight">Nivaas</Link>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">A clear, accountable workspace for society governance.</p>
        </div>
        <Card className="motion-item shadow-[8px_8px_0_var(--accent)]">
          <CardHeader><CardTitle>Sign in to your workspace</CardTitle></CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={submit}>
              {error ? <p className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm leading-6 text-danger" role="alert">{error}</p> : null}
              <label className="block text-sm font-semibold" htmlFor="email">Email
                <input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 min-h-11 w-full rounded-md border border-input bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              </label>
              <label className="block text-sm font-semibold" htmlFor="password">Password
                <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 min-h-11 w-full rounded-md border border-input bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              </label>
              <Button type="submit" className="w-full" disabled={isSubmitting}>{isSubmitting ? 'Signing in…' : 'Sign in'}</Button>
            </form>
            <p className="mt-6 text-sm leading-6 text-muted-foreground">New account setup? <Link className="font-semibold text-info underline underline-offset-4" to="/setup">Use your setup credential</Link></p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
