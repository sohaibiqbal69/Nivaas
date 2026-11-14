import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, completeAccountSetup } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { AuthExperience } from '@/components/auth/AuthExperience';

export function AccountSetupPage() {
  const navigate = useNavigate();
  const [credential, setCredential] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (newPassword !== confirmation) {
      setError('Passwords do not match.');
      return;
    }
    try {
      await completeAccountSetup(credential.trim(), newPassword);
      setComplete(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Unable to complete account setup right now.');
    }
  }

  return (
    <AuthExperience>
      <section className="login-form-column min-w-0" aria-labelledby="setup-form-title" data-auth-enter>
        <div className="login-form-surface">
          <p className="login-form-overline text-xs font-semibold uppercase tracking-[.14em] text-secondary">Account setup</p>
          <h2 id="setup-form-title" className="mt-2 font-headline text-2xl font-bold tracking-tight text-foreground">Set up your Nivaas account</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Use your setup credential to set a password for this account.</p>
          {complete ? (
            <div className="mt-7 space-y-4" role="status">
              <p className="text-sm leading-6">Your account is ready. Sign in with your new password.</p>
              <Button onClick={() => navigate('/login', { replace: true })}>Continue to sign in</Button>
            </div>
          ) : (
            <form className="mt-7 space-y-5" onSubmit={submit}>
              {error ? <p className="login-error text-sm leading-6 text-danger" role="alert">{error}</p> : null}
              <label className="login-field-label block text-sm font-semibold" htmlFor="credential">Setup credential
                <input id="credential" required value={credential} onChange={(event) => setCredential(event.target.value)} className="login-field mt-2 min-h-12 w-full rounded-md border border-input bg-background px-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              </label>
              <label className="login-field-label block text-sm font-semibold" htmlFor="new-password">New password
                <input id="new-password" type="password" minLength={8} autoComplete="new-password" required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="login-field mt-2 min-h-12 w-full rounded-md border border-input bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              </label>
              <label className="login-field-label block text-sm font-semibold" htmlFor="confirm-password">Confirm password
                <input id="confirm-password" type="password" minLength={8} autoComplete="new-password" required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="login-field mt-2 min-h-12 w-full rounded-md border border-input bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              </label>
              <Button type="submit" className="login-submit w-full bg-primary text-primary-foreground hover:bg-primary/90">Complete setup</Button>
              <Link className="block text-center text-sm font-semibold text-info underline underline-offset-4" to="/login">Back to sign in</Link>
            </form>
          )}
        </div>
      </section>
    </AuthExperience>
  );
}
