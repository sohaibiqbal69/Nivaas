import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, completeAccountSetup } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { usePageMotion } from '@/hooks/usePageMotion';

export function AccountSetupPage() {
  const navigate = useNavigate();
  const pageRef = usePageMotion<HTMLDivElement>();
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
    <main ref={pageRef} className="grid min-h-screen place-items-center bg-background px-4 py-10">
      <Card className="motion-item w-full max-w-md shadow-[8px_8px_0_var(--accent)]">
        <CardHeader><CardTitle>Set up your Nivaas account</CardTitle></CardHeader>
        <CardContent>
          {complete ? (
            <div className="space-y-4" role="status">
              <p className="text-sm leading-6">Your account is ready. Sign in with your new password.</p>
              <Button onClick={() => navigate('/login', { replace: true })}>Continue to sign in</Button>
            </div>
          ) : (
            <form className="space-y-5" onSubmit={submit}>
              {error ? <p className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm leading-6 text-danger" role="alert">{error}</p> : null}
              <label className="block text-sm font-semibold" htmlFor="credential">Setup credential
                <input id="credential" required value={credential} onChange={(event) => setCredential(event.target.value)} className="mt-2 min-h-11 w-full rounded-md border border-input bg-background px-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              </label>
              <label className="block text-sm font-semibold" htmlFor="new-password">New password
                <input id="new-password" type="password" minLength={8} autoComplete="new-password" required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="mt-2 min-h-11 w-full rounded-md border border-input bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              </label>
              <label className="block text-sm font-semibold" htmlFor="confirm-password">Confirm password
                <input id="confirm-password" type="password" minLength={8} autoComplete="new-password" required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-2 min-h-11 w-full rounded-md border border-input bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              </label>
              <Button type="submit" className="w-full">Complete setup</Button>
              <Link className="block text-center text-sm font-semibold text-info underline underline-offset-4" to="/login">Back to sign in</Link>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
