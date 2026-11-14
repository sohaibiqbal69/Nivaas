import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { usePageMotion } from '@/hooks/usePageMotion';
import { ApiError } from '@/lib/api';
import { createSociety, listSocieties, type CreateSocietyInput, type SocietyRecord } from '@/lib/administration';
import { createSocietyBuilding, listSocietyBuildings, type SocietyBuilding } from '@/lib/members';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState, PermissionDeniedState } from '@/components/ui/states';
import { PageHeader } from '@/components/layout/PageHeader';

type SocietyForm = Required<Pick<CreateSocietyInput, 'name'>> & Omit<CreateSocietyInput, 'name'>;

const EMPTY_FORM: SocietyForm = {
  name: '', registrationNumber: '', address: '', contactEmail: '', contactPhone: '',
  financialYearStart: '', financialYearEnd: '',
};

export function SocietyManagementPage() {
  const pageRef = usePageMotion<HTMLDivElement>();
  const { user, token } = useAuth();
  const [societies, setSocieties] = useState<SocietyRecord[] | null>(null);
  const [buildings, setBuildings] = useState<Record<string, SocietyBuilding[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buildingLoadError, setBuildingLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<SocietyForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [buildingSocietyId, setBuildingSocietyId] = useState<string | null>(null);
  const [buildingName, setBuildingName] = useState('');
  const [buildingCode, setBuildingCode] = useState('');
  const [buildingSaving, setBuildingSaving] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const records = await listSocieties(token);
      setSocieties(records);
      setBuildingLoadError(null);
      try {
        const entries = await Promise.all(records.map(async (society) => [society._id, await listSocietyBuildings(token, society._id)] as const));
        setBuildings(Object.fromEntries(entries));
      } catch (cause) {
        setBuildingLoadError(cause instanceof ApiError ? cause.message : 'Buildings could not be loaded.');
      }
    }
    catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Societies could not be loaded.');
      setSocieties(null);
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    const input = Object.fromEntries(Object.entries(form).filter(([, value]) => value.trim() !== '')) as CreateSocietyInput;
    try {
      const created = await createSociety(input, token);
      setSocieties((current) => current ? [created, ...current] : [created]);
      setBuildings((current) => ({ ...current, [created._id]: [] }));
      setForm(EMPTY_FORM);
      setNotice(`${created.name} was created and is ${created.status.toLowerCase()}. Its initial approval rule was created by the server.`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The society could not be created.');
    } finally { setSaving(false); }
  }

  async function submitBuilding(event: FormEvent<HTMLFormElement>, society: SocietyRecord) {
    event.preventDefault();
    if (!token || buildingSaving || !buildingName.trim()) return;
    setBuildingSaving(true);
    setError(null);
    setNotice(null);
    try {
      const building = await createSocietyBuilding({
        societyId: society._id,
        name: buildingName,
        ...(buildingCode.trim() ? { buildingCode: buildingCode.trim() } : {}),
      }, token);
      setBuildings((current) => ({ ...current, [society._id]: [...(current[society._id] ?? []), building] }));
      setBuildingName('');
      setBuildingCode('');
      setBuildingSocietyId(null);
      setNotice(`${building.name} was created for ${society.name}${building.buildingCode ? ` (${building.buildingCode})` : ''}.`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The building could not be created. Check the building code and try again.');
    } finally { setBuildingSaving(false); }
  }

  if (user?.role !== 'SYSTEM_ADMIN') return <div ref={pageRef} className="page-admin space-y-6"><PageHeader eyebrow="Platform administration" title="Societies" description="Create and review society records." /><PermissionDeniedState /></div>;

  return (
    <div ref={pageRef} className="page-admin space-y-8">
      <PageHeader eyebrow="Platform administration" title="Societies" description="Create society records and review their platform status." />
      {error ? <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div> : null}
      {notice ? <p role="status" className="rounded-md border border-success/40 bg-success/10 p-3 text-sm">{notice}</p> : null}

      <Card className="task-form">
        <CardHeader><CardTitle>Create society</CardTitle><CardDescription>Name is required. Optional fields follow the existing society API validation; the backend creates the society as active and initializes its approval rule.</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={(event) => void submit(event)} className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-semibold sm:col-span-2">Society name *
              <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="min-h-11 w-full rounded-md border border-input bg-background px-3 font-normal focus-visible:outline-2 focus-visible:outline-ring" />
            </label>
            <label className="space-y-1 text-sm font-semibold">Registration number
              <input value={form.registrationNumber} onChange={(event) => setForm({ ...form, registrationNumber: event.target.value })} className="min-h-11 w-full rounded-md border border-input bg-background px-3 font-normal focus-visible:outline-2 focus-visible:outline-ring" />
            </label>
            <label className="space-y-1 text-sm font-semibold">Contact email
              <input type="email" value={form.contactEmail} onChange={(event) => setForm({ ...form, contactEmail: event.target.value })} className="min-h-11 w-full rounded-md border border-input bg-background px-3 font-normal focus-visible:outline-2 focus-visible:outline-ring" />
            </label>
            <label className="space-y-1 text-sm font-semibold sm:col-span-2">Address
              <textarea rows={2} value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} className="w-full rounded-md border border-input bg-background px-3 py-2 font-normal focus-visible:outline-2 focus-visible:outline-ring" />
            </label>
            <label className="space-y-1 text-sm font-semibold">Contact phone
              <input type="tel" value={form.contactPhone} onChange={(event) => setForm({ ...form, contactPhone: event.target.value })} className="min-h-11 w-full rounded-md border border-input bg-background px-3 font-normal focus-visible:outline-2 focus-visible:outline-ring" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-sm font-semibold">Financial year start
                <input type="date" value={form.financialYearStart} onChange={(event) => setForm({ ...form, financialYearStart: event.target.value })} className="min-h-11 w-full rounded-md border border-input bg-background px-2 font-normal focus-visible:outline-2 focus-visible:outline-ring" />
              </label>
              <label className="space-y-1 text-sm font-semibold">Financial year end
                <input type="date" value={form.financialYearEnd} onChange={(event) => setForm({ ...form, financialYearEnd: event.target.value })} className="min-h-11 w-full rounded-md border border-input bg-background px-2 font-normal focus-visible:outline-2 focus-visible:outline-ring" />
              </label>
            </div>
            <div className="sm:col-span-2"><Button type="submit" disabled={saving}>{saving ? 'Creating society…' : 'Create society'}</Button></div>
          </form>
        </CardContent>
      </Card>

      <section className="space-y-4" aria-labelledby="societies-heading">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Platform records</p><h2 id="societies-heading" className="mt-1 font-headline text-2xl font-bold">Existing societies</h2></div><Link to="/administration/users" className="min-h-11 inline-flex items-center font-semibold text-info underline underline-offset-4">Manage users</Link></div>
        {loading ? <LoadingState label="Loading society records" /> : null}
        {!loading && error && !societies ? <ErrorState title="Society list unavailable" description={error} onRetry={() => void load()} /> : null}
        {!loading && buildingLoadError ? <ErrorState title="Building list unavailable" description={buildingLoadError} onRetry={() => void load()} /> : null}
        {!loading && societies?.length === 0 ? <EmptyState title="No societies yet" description="Create a society above. The platform will return its persisted record and initialize the society's approval rule." /> : null}
        <div className="grid gap-x-10 lg:grid-cols-2">{societies?.map((society) => <Card key={society._id} className="admin-record">
          <CardHeader className="flex flex-row items-start justify-between gap-3"><div className="min-w-0"><CardTitle className="break-words">{society.name}</CardTitle><CardDescription className="mt-1 font-mono">ID {society._id}</CardDescription></div><span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold">{society.status}</span></CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">{society.registrationNumber ? <p>Registration: {society.registrationNumber}</p> : null}{society.address ? <p>{society.address}</p> : null}{society.contactEmail ? <p>{society.contactEmail}</p> : null}{society.contactPhone ? <p>{society.contactPhone}</p> : null}<p>Created {new Date(society.createdAt).toLocaleDateString()}</p>
            <div className="space-y-2 border-t border-border pt-3"><div className="flex items-center justify-between gap-3"><h3 className="font-semibold text-foreground">Buildings</h3><Button type="button" variant="outline" aria-label={`${buildingSocietyId === society._id ? 'Cancel' : 'Add building to'} ${society.name}`} onClick={() => { setBuildingSocietyId((current) => current === society._id ? null : society._id); setError(null); }}>{buildingSocietyId === society._id ? 'Cancel' : 'Add building'}</Button></div>
              {buildings[society._id]?.length ? <ul className="space-y-1">{buildings[society._id].map((building) => <li key={building._id} className="text-foreground">{building.name}{building.buildingCode ? ` · ${building.buildingCode}` : ''}</li>)}</ul> : <p>No buildings recorded for this society.</p>}
              {buildingSocietyId === society._id ? <form aria-label={`Add building to ${society.name}`} onSubmit={(event) => void submitBuilding(event, society)} className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 font-semibold text-foreground">Building name *<input required value={buildingName} onChange={(event) => setBuildingName(event.target.value)} className="min-h-11 w-full rounded-md border border-input bg-background px-3 font-normal" /></label>
                <label className="space-y-1 font-semibold text-foreground">Building code (optional)<input value={buildingCode} onChange={(event) => setBuildingCode(event.target.value)} placeholder="Leave blank if not used" className="min-h-11 w-full rounded-md border border-input bg-background px-3 font-normal" /></label>
                <div className="sm:col-span-2"><Button type="submit" disabled={buildingSaving || !buildingName.trim()}>{buildingSaving ? 'Creating building…' : 'Create building'}</Button></div>
              </form> : null}
            </div>
          </CardContent>
        </Card>)}</div>
      </section>
    </div>
  );
}
