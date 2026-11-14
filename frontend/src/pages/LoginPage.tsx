import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { animate } from 'animejs';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { AuthExperience } from '@/components/auth/AuthExperience';
import { prefersReducedMotion } from '@/lib/motion';

export function LoginPage() {
  const { isAuthenticated, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const destination = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/dashboard';

  useEffect(() => {
    if (!error || !errorRef.current || prefersReducedMotion()) return;
    animate(errorRef.current, {
      opacity: [0, 1],
      translateY: [-5, 0],
      duration: 240,
      ease: 'out(3)',
    });
  }, [error]);

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
    <AuthExperience interactiveArchitecture>
      <section className="login-form-column min-w-0" aria-labelledby="login-form-title" data-auth-enter>
        <div className="login-form-surface">
          <p className="login-form-overline text-xs font-semibold uppercase tracking-[.14em] text-secondary">Welcome back</p>
          <h2 id="login-form-title" className="mt-2 font-headline text-2xl font-bold tracking-tight text-foreground">Sign in to Nivaas</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Use your society account to continue.</p>
          <form className="mt-7 space-y-5" onSubmit={submit}>
            {error ? <p ref={errorRef} className="login-error text-sm leading-6 text-danger" role="alert">{error}</p> : null}
            <label className="login-field-label block text-sm font-semibold" htmlFor="email">Email
              <input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="login-field mt-2 min-h-12 w-full rounded-md border border-input bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </label>
            <label className="login-field-label block text-sm font-semibold" htmlFor="password">Password
              <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="login-field mt-2 min-h-12 w-full rounded-md border border-input bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </label>
            <Button type="submit" className="login-submit w-full bg-primary text-primary-foreground hover:bg-primary/90" disabled={isSubmitting}>{isSubmitting ? 'Signing in…' : 'Sign in'}</Button>
          </form>
          <p className="login-setup mt-6 text-sm leading-6 text-muted-foreground">New account setup? <Link className="font-semibold text-info underline underline-offset-4" to="/setup">Use your setup credential</Link></p>
        </div>
        <p className="login-form-footnote mt-4 text-xs leading-5 text-muted-foreground">Access follows your account role and society permissions.</p>
      </section>
    </AuthExperience>
  );
}
