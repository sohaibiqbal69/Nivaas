import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { usePageMotion } from '@/hooks/usePageMotion';
import { ApiError } from '@/lib/api';
import { createSocietyManager, listAdminUsers, listSocieties, reissueSetupCredential, type AdminUserRecord, type CreatedAdminUser, type SocietyRecord } from '@/lib/administration';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState, PermissionDeniedState } from '@/components/ui/states';
import { PageHeader } from '@/components/layout/PageHeader';

export function UserAdministrationPage() {
  const pageRef = usePageMotion<HTMLDivElement>();
  const { user, token } = useAuth();
  const [users, setUsers] = useState<AdminUserRecord[] | null>(null);
  const [societies, setSocieties] = useState<SocietyRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [societyId, setSocietyId] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [reissuingUserId, setReissuingUserId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [credential, setCredential] = useState<Pick<CreatedAdminUser, 'name' | 'email' | 'setupCredential' | 'setupCredentialExpiresAt'> | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [userRecords, societyRecords] = await Promise.all([listAdminUsers(token), listSocieties(token)]);
      setUsers(userRecords);
      setSocieties(societyRecords);
      setSocietyId((current) => current || societyRecords[0]?._id || '');
    } catch (cause) {
      setUsers(null);
      setSocieties(null);
      setError(cause instanceof ApiError ? cause.message : 'User administration records could not be loaded.');
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { void load(); }, [load]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    setCredential(null);
    try {
      const created = await createSocietyManager({ societyId, name, email, ...(phone.trim() ? { phone: phone.trim() } : {}) }, token);
      const { setupCredential, setupCredentialExpiresAt, ...safeUser } = created;
      setUsers((current) => current ? [safeUser, ...current] : [safeUser]);
      setCredential({ name: created.name, email: created.email, ...(setupCredential ? { setupCredential } : {}), ...(setupCredentialExpiresAt ? { setupCredentialExpiresAt } : {}) });
      setNotice(created.setupCredential
        ? `${created.name} was created with status ${created.status}. Share the one-time credential privately so the recipient can complete setup.`
        : `${created.name} was created with status ${created.status}. The backend returned no setup credential, so the account remains pending until an authorized delivery method is available.`);
      setName(''); setEmail(''); setPhone('');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The manager account could not be created.');
    } finally { setSaving(false); }
  }

  async function reissue(account: AdminUserRecord) {
    if (!token || account.status !== 'PENDING_SETUP') return;
    if (!window.confirm(`Reissue the one-time setup credential for ${account.name} (${account.email})? Any previous unconsumed setup credential will stop working.`)) return;
    setReissuingUserId(account._id);
    setError(null);
    setNotice(null);
    setCredential(null);
    try {
      const reissued = await reissueSetupCredential(account._id, token);
      setCredential({ name: reissued.name, email: reissued.email, ...(reissued.setupCredential ? { setupCredential: reissued.setupCredential } : {}), ...(reissued.setupCredentialExpiresAt ? { setupCredentialExpiresAt: reissued.setupCredentialExpiresAt } : {}) });
      setNotice(reissued.setupCredential
        ? `A new one-time setup credential was issued for ${reissued.name}. The previous outstanding credential has been invalidated.`
        : 'The backend did not return a setup credential. No credential is available to share.');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The setup credential could not be reissued.');
    } finally { setReissuingUserId(null); }
  }

  if (user?.role !== 'SYSTEM_ADMIN') return <div ref={pageRef} className="page-admin space-y-6"><PageHeader eyebrow="Platform administration" title="Users & Admin" description="Provision society-scoped accounts." /><PermissionDeniedState /></div>;

  const societyNames = new Map(societies?.map((society) => [society._id, society.name]) ?? []);
  return (
    <div ref={pageRef} className="page-admin space-y-8">
      <PageHeader eyebrow="Platform administration" title="Users & Admin" description="Provision society manager accounts and review setup status." />
      {error ? <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div> : null}
      {notice ? <p role="status" className="rounded-md border border-success/40 bg-success/10 p-3 text-sm">{notice}</p> : null}
      {credential?.setupCredential ? <Card className="border-secondary/50"><CardHeader><CardTitle>One-time setup credential available</CardTitle><CardDescription>The authorized local API returned this credential once. It is held only in this page session and is not saved in the user list.</CardDescription></CardHeader><CardContent className="space-y-3"><details><summary className="min-h-11 cursor-pointer py-3 font-semibold">Reveal credential for {credential.name}</summary><code className="block select-all break-all rounded bg-muted p-3 font-mono text-sm">{credential.setupCredential}</code>{credential.setupCredentialExpiresAt ? <p className="mt-2 text-xs text-muted-foreground">Expires {new Date(credential.setupCredentialExpiresAt).toLocaleString()}</p> : null}<p className="mt-2 text-sm">Share it privately. The recipient completes setup at <Link to="/setup" className="font-semibold text-info underline">/setup</Link>.</p></details><Button variant="outline" type="button" onClick={() => setCredential(null)}>Discard from this page</Button></CardContent></Card> : null}

      <Card className="task-form">
        <CardHeader><CardTitle>Create society manager</CardTitle><CardDescription>The backend creates the account in PENDING_SETUP. A credential is returned only through enabled loopback delivery in the isolated local demo environment. Production credential delivery is not configured yet.</CardDescription></CardHeader>
        <CardContent>
          {societies?.length === 0 ? <div className="space-y-3"><EmptyState title="Create a society first" description="A society manager must belong to a real society. Create one before provisioning this account." /><Link to="/administration/societies" className="inline-flex min-h-11 items-center font-semibold text-info underline underline-offset-4">Open society management</Link></div> : (
            <form onSubmit={(event) => void submit(event)} className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1 text-sm font-semibold sm:col-span-2">Society *
                <select required value={societyId} onChange={(event) => setSocietyId(event.target.value)} className="min-h-11 w-full rounded-md border border-input bg-background px-3 font-normal focus-visible:outline-2 focus-visible:outline-ring"><option value="" disabled>Select a society</option>{societies?.map((society) => <option key={society._id} value={society._id}>{society.name} · {society.status}</option>)}</select>
              </label>
              <label className="space-y-1 text-sm font-semibold">Name *<input required value={name} onChange={(event) => setName(event.target.value)} className="min-h-11 w-full rounded-md border border-input bg-background px-3 font-normal focus-visible:outline-2 focus-visible:outline-ring" /></label>
              <label className="space-y-1 text-sm font-semibold">Email *<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="min-h-11 w-full rounded-md border border-input bg-background px-3 font-normal focus-visible:outline-2 focus-visible:outline-ring" /></label>
              <label className="space-y-1 text-sm font-semibold">Phone (optional)<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} className="min-h-11 w-full rounded-md border border-input bg-background px-3 font-normal focus-visible:outline-2 focus-visible:outline-ring" /></label>
              <div className="flex items-end"><Button type="submit" disabled={saving || loading || !societyId}>{saving ? 'Creating account…' : 'Create manager account'}</Button></div>
            </form>
          )}
        </CardContent>
      </Card>

      <section className="space-y-4" aria-labelledby="users-heading">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Platform records</p><h2 id="users-heading" className="mt-1 font-headline text-2xl font-bold">Accounts</h2></div><Link to="/administration/societies" className="min-h-11 inline-flex items-center font-semibold text-info underline underline-offset-4">Manage societies</Link></div>
        {loading ? <LoadingState label="Loading user and society records" /> : null}
        {!loading && error && !users ? <ErrorState title="Accounts unavailable" description={error} onRetry={() => void load()} /> : null}
        {!loading && users?.length === 0 ? <EmptyState title="No user accounts found" description="New accounts created here will appear after the backend confirms they were saved." /> : null}
        <div className="space-y-2">{users?.map((account) => <Card key={account._id} className="admin-record"><CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="font-semibold">{account.name}</p><p className="break-all text-sm text-muted-foreground">{account.email}</p><p className="mt-1 font-mono text-xs text-muted-foreground">{account.societyId ? societyNames.get(account.societyId) ?? 'Society record unavailable' : 'Platform account'} · {account.role}</p></div><div className="flex flex-wrap items-center gap-2"><span className="w-fit rounded-full bg-accent px-3 py-1 text-xs font-semibold">{account.status}</span>{account.status === 'PENDING_SETUP' ? <Button type="button" variant="outline" disabled={reissuingUserId !== null} onClick={() => void reissue(account)}>{reissuingUserId === account._id ? 'Reissuing…' : 'Reissue setup credential'}</Button> : null}</div></CardContent></Card>)}</div>
      </section>
    </div>
  );
}
