import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState, PermissionDeniedState } from '@/components/ui/states';
import { usePageMotion } from '@/hooks/usePageMotion';
import { ApiError } from '@/lib/api';
import {
  createOwnership, createResidence, createSocietyMembership, createSocietyUser, createSocietyFlat, listFlatOwnerships, listFlatResidents,
  listSocietyFlats, listSocietyMemberships, listSocietyUsers, listSocietyBuildings, type SocietyBuilding,
  type CreatedSocietyUser, type FlatRelationship, type SocietyFlat, type SocietyMembership, type SocietyUser,
} from '@/lib/members';

type RelationshipKind = 'ownership' | 'residence';

export function SocietyMembersPage() {
  const pageRef = usePageMotion<HTMLDivElement>();
  const { user, token } = useAuth();
  const canManage = user?.role === 'SOCIETY_MANAGER' && Boolean(user.societyId);
  const [users, setUsers] = useState<SocietyUser[] | null>(null);
  const [memberships, setMemberships] = useState<SocietyMembership[] | null>(null);
  const [flats, setFlats] = useState<SocietyFlat[] | null>(null);
  const [buildings, setBuildings] = useState<SocietyBuilding[]>([]);
  const [ownerships, setOwnerships] = useState<FlatRelationship[] | null>(null);
  const [residents, setResidents] = useState<FlatRelationship[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [relationshipLoading, setRelationshipLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [accountName, setAccountName] = useState('');
  const [accountEmail, setAccountEmail] = useState('');
  const [accountPhone, setAccountPhone] = useState('');
  const [accountRole, setAccountRole] = useState<'OWNER_MEMBER' | 'RESIDENT' | 'COMMITTEE_MEMBER'>('OWNER_MEMBER');
  const [createdAccount, setCreatedAccount] = useState<CreatedSocietyUser | null>(null);
  const [search, setSearch] = useState('');
  const [flatSearch, setFlatSearch] = useState('');
  const [newFlatBuildingId, setNewFlatBuildingId] = useState('');
  const [newFlatNumber, setNewFlatNumber] = useState('');
  const [newFlatStatus, setNewFlatStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [membershipUserId, setMembershipUserId] = useState('');
  const [membershipFlatId, setMembershipFlatId] = useState('');
  const [membershipType, setMembershipType] = useState<SocietyMembership['membershipType']>('PRIMARY');
  const [membershipStatus, setMembershipStatus] = useState<SocietyMembership['membershipStatus']>('ACTIVE');
  const [relationshipKind, setRelationshipKind] = useState<RelationshipKind>('ownership');
  const [relationshipUserId, setRelationshipUserId] = useState('');
  const [relationshipFlatId, setRelationshipFlatId] = useState('');
  const [relationshipBuildingId, setRelationshipBuildingId] = useState('');
  const [relationshipFlatNumber, setRelationshipFlatNumber] = useState('');
  const [relationshipType, setRelationshipType] = useState('');
  const [relationshipStatus, setRelationshipStatus] = useState('');
  const [ownershipOrder, setOwnershipOrder] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const load = useCallback(async () => {
    if (!token || !user?.societyId || !canManage) return;
    setLoading(true); setError(null);
    try {
      const [membershipRecords, flatRecords, buildingRecords] = await Promise.all([
        listSocietyMemberships(token, user.societyId), listSocietyFlats(token, user.societyId),
        listSocietyBuildings(token, user.societyId),
      ]);
      setMemberships(membershipRecords); setFlats(flatRecords); setBuildings(buildingRecords);
      setMembershipFlatId((current) => flatRecords.some(flat => flat._id === current) ? current : '');
      setRelationshipFlatId((current) => flatRecords.some(flat => flat._id === current) ? current : '');
    } catch (cause) {
      setMemberships(null); setFlats(null);
      setError(cause instanceof ApiError ? cause.message : 'Society members and flats could not be loaded.');
    } finally { setLoading(false); }
  }, [canManage, token, user?.societyId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!token || !user?.societyId || !canManage) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void listSocietyUsers(token, search).then((records) => {
        if (active) setUsers(records);
      }).catch((cause: unknown) => {
        if (!active) return;
        setUsers(null);
        setError(cause instanceof ApiError ? cause.message : 'Society accounts could not be searched.');
      });
    }, search ? 200 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [canManage, search, token, user?.societyId]);

  const loadRelationships = useCallback(async () => {
    if (!token || !relationshipFlatId) { setOwnerships([]); setResidents([]); return; }
    setRelationshipLoading(true);
    try {
      const [ownershipRecords, residenceRecords] = await Promise.all([
        listFlatOwnerships(relationshipFlatId, token), listFlatResidents(relationshipFlatId, token),
      ]);
      setOwnerships(ownershipRecords); setResidents(residenceRecords);
    } catch (cause) {
      setOwnerships(null); setResidents(null);
      setError(cause instanceof ApiError ? cause.message : 'Flat relationships could not be loaded.');
    } finally { setRelationshipLoading(false); }
  }, [relationshipFlatId, token]);
  useEffect(() => { void loadRelationships(); }, [loadRelationships]);

  const peopleById = useMemo(() => new Map(users?.map((record) => [record._id, record]) ?? []), [users]);
  const flatsById = useMemo(() => new Map(flats?.map((record) => [record._id, record]) ?? []), [flats]);
  const visibleMemberships = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (memberships ?? []).filter((membership) => {
      const person = peopleById.get(membership.userId);
      const flat = flatsById.get(membership.unitId);
      return !query || [person?.name, person?.email, flat?.flatNumber, membership.membershipType, membership.membershipStatus]
        .some((value) => value?.toLocaleLowerCase().includes(query));
    });
  }, [flatsById, memberships, peopleById, search]);

  async function submitMembership(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !user?.societyId) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const created = await createSocietyMembership({ societyId: user.societyId, userId: membershipUserId, unitId: membershipFlatId, membershipType, membershipStatus }, token);
      setMemberships((current) => current ? [created, ...current] : [created]);
      setNotice('Membership record added. Membership, ownership, residence and voting eligibility remain separate records.');
      setMembershipUserId('');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The membership could not be added.'); }
    finally { setSaving(false); }
  }

  async function addFlat(buildingId = newFlatBuildingId, flatNumber = newFlatNumber, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') {
    if (!token || !buildingId || !flatNumber.trim() || saving) return;
    setSaving(true); setNotice(null); setError(null);
    try {
      const created = await createSocietyFlat({ buildingId, flatNumber, status }, token);
      setNotice(`Flat ${created.flatNumber} was created. You can now add its owner, residents or membership record separately.`);
      setNewFlatNumber(''); setRelationshipBuildingId(buildingId); setRelationshipFlatNumber(created.flatNumber); setRelationshipFlatId(created._id);
      await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The flat could not be created. Check whether its number already exists in this building.'); }
    finally { setSaving(false); }
  }

  function selectRelationshipFlatNumber(value: string) {
    setRelationshipFlatNumber(value);
    const match = flats?.find(flat => flat.buildingId === relationshipBuildingId && flat.flatNumber === value.trim());
    setRelationshipFlatId(match?._id ?? '');
  }

  async function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const created = await createSocietyUser({
        name: accountName.trim(), email: accountEmail.trim(), role: accountRole,
        ...(accountPhone.trim() ? { phone: accountPhone.trim() } : {}),
      }, token);
      const safeUser: SocietyUser = {
        _id: created._id, societyId: created.societyId, name: created.name,
        email: created.email, ...(created.phone ? { phone: created.phone } : {}),
        role: created.role, status: created.status,
      };
      setUsers((current) => current ? [safeUser, ...current.filter((person) => person._id !== safeUser._id)] : [safeUser]);
      setCreatedAccount(created);
      setMembershipUserId(created._id);
      setRelationshipUserId(created._id);
      setNotice(created.setupCredential
        ? `${created.name} was created as a pending account. The one-time setup credential is available below for private delivery.`
        : `${created.name} was created as a pending account. No setup credential was returned, so the account cannot sign in until secure delivery is configured.`);
      setAccountName(''); setAccountEmail(''); setAccountPhone('');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The account could not be created.');
    } finally { setSaving(false); }
  }

  async function submitRelationship(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !relationshipFlatId) return;
    setSaving(true); setError(null); setNotice(null);
    const dates = { ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}) };
    try {
      if (relationshipKind === 'ownership') {
        await createOwnership(relationshipFlatId, { userId: relationshipUserId, ownershipType: relationshipType, status: relationshipStatus, ...(ownershipOrder ? { ownershipOrder: Number(ownershipOrder) } : {}), ...dates }, token);
      } else {
        await createResidence(relationshipFlatId, { userId: relationshipUserId, occupancyType: relationshipType, status: relationshipStatus, ...dates }, token);
      }
      setNotice(`${relationshipKind === 'ownership' ? 'Ownership' : 'Residence'} record saved for the selected flat.`);
      setRelationshipType(''); setRelationshipStatus(''); setOwnershipOrder(''); setStartDate(''); setEndDate('');
      await loadRelationships();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The flat relationship could not be saved.'); }
    finally { setSaving(false); }
  }

  if (!canManage) return <div ref={pageRef} className="page-members space-y-6"><PageHeader eyebrow="Society records" title="Members & Flats" description="Manage society membership and flat relationships." /><PermissionDeniedState /></div>;

  const eligiblePeople = (users ?? []).filter((person) => person._id !== user?._id && person.role !== 'SYSTEM_ADMIN');
  const buildingLabel = (flat: SocietyFlat) => buildings.find(building => building._id === flat.buildingId)?.name ?? `Building ${flat.buildingId.slice(-6)}`;
  const matchingFlats = (flats ?? []).filter(flat => flat._id === membershipFlatId || flat._id === relationshipFlatId || `${flat.flatNumber} ${buildingLabel(flat)} ${flat.floor ?? ''}`.toLowerCase().includes(flatSearch.trim().toLowerCase()));
  return (
    <div ref={pageRef} className="page-members space-y-7">
      <PageHeader eyebrow="Society operations" title="Members & Flats" description="Create accounts and maintain separate membership, ownership and residence records." />
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">Application role, society membership, flat ownership and residence are distinct. Residence or an application role alone does not create voting eligibility; governance rules and verified membership evidence determine eligibility. New member accounts are restricted to this society and begin in pending setup. System Admin remains responsible for creating societies, flats and Society Manager accounts.</p>
      {error ? <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div> : null}
      {notice ? <p role="status" className="rounded-md border border-success/40 bg-success/10 p-3 text-sm">{notice}</p> : null}
      {createdAccount?.setupCredential ? <Card className="border-secondary/50"><CardHeader><CardTitle>One-time account setup credential</CardTitle><CardDescription>This value was returned once through the configured local loopback delivery path. It is held only in this page session and is not saved in account records.</CardDescription></CardHeader><CardContent className="space-y-3"><details><summary className="min-h-11 cursor-pointer py-3 font-semibold">Reveal credential for {createdAccount.name}</summary><code className="block select-all break-all rounded bg-muted p-3 font-mono text-sm">{createdAccount.setupCredential}</code>{createdAccount.setupCredentialExpiresAt ? <p className="mt-2 text-xs text-muted-foreground">Expires {new Date(createdAccount.setupCredentialExpiresAt).toLocaleString()}</p> : null}<p className="mt-2 text-sm">Share privately with the recipient. They set their own password through the account setup page.</p></details><Button type="button" variant="outline" onClick={() => setCreatedAccount(null)}>Discard credential from this page</Button></CardContent></Card> : null}
      {createdAccount?.role === 'COMMITTEE_MEMBER' ? <p role="note" className="rounded-md border border-border bg-muted/50 p-3 text-sm">The COMMITTEE_MEMBER account role does not create a CommitteeMember assignment. Committee models exist, but this repository has no committee management API; no committee position or term is inferred here.</p> : null}
      <Card className="task-form">
        <CardHeader><CardTitle>Create a society member account</CardTitle><CardDescription>Creates a PENDING_SETUP account in your assigned society. Setup credentials are returned only when local loopback delivery is explicitly enabled; no production delivery provider is configured.</CardDescription></CardHeader>
        <CardContent><form aria-label="Create society account" onSubmit={(event) => void submitAccount(event)} className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm font-semibold">Name *<input name="account-name" required value={accountName} onChange={(event) => setAccountName(event.target.value)} className="min-h-11 w-full rounded-md border border-input bg-background px-3 font-normal" /></label>
          <label className="space-y-1 text-sm font-semibold">Email *<input name="account-email" type="email" required value={accountEmail} onChange={(event) => setAccountEmail(event.target.value)} className="min-h-11 w-full rounded-md border border-input bg-background px-3 font-normal" /></label>
          <label className="space-y-1 text-sm font-semibold">Phone (optional)<input name="account-phone" type="tel" value={accountPhone} onChange={(event) => setAccountPhone(event.target.value)} className="min-h-11 w-full rounded-md border border-input bg-background px-3 font-normal" /></label>
          <label className="space-y-1 text-sm font-semibold">Application role *<select name="account-role" required value={accountRole} onChange={(event) => setAccountRole(event.target.value as typeof accountRole)} className="min-h-11 w-full rounded-md border border-input bg-background px-3 font-normal"><option value="OWNER_MEMBER">Owner Member</option><option value="RESIDENT">Resident</option><option value="COMMITTEE_MEMBER">Committee Member</option></select></label>
          <div><Button type="submit" disabled={saving || !accountName.trim() || !accountEmail.trim()}>{saving ? 'Creating account…' : 'Create account'}</Button></div>
        </form></CardContent>
      </Card>
      {loading ? <LoadingState label="Loading society accounts, memberships and flats" /> : null}
      {!loading && error && !users ? <ErrorState title="Society onboarding unavailable" description={error} onRetry={() => void load()} /> : null}
      {!loading && users?.length === 0 ? <EmptyState title="No accounts assigned to this society" description="Create an owner, resident or committee-member account above, then add its separate flat and membership records." /> : null}
      {!loading ? <Card className="task-form"><CardHeader><CardTitle>Add flat</CardTitle><CardDescription>Create a property record in your assigned society. Flat numbers are text, so leading zeros are preserved. A duplicate number in this building is rejected.</CardDescription></CardHeader><CardContent><form aria-label="Add society flat" onSubmit={event => { event.preventDefault(); void addFlat(newFlatBuildingId, newFlatNumber, newFlatStatus); }} className="grid gap-3 md:grid-cols-4"><label className="space-y-1 text-sm font-semibold">Building<select required value={newFlatBuildingId} onChange={event => setNewFlatBuildingId(event.target.value)} className="min-h-11 w-full rounded-md border border-input bg-background px-3"><option value="">Select a building</option>{buildings.map(building => <option key={building._id} value={building._id}>{building.name}</option>)}</select></label><label className="space-y-1 text-sm font-semibold">Flat number<input required value={newFlatNumber} onChange={event => setNewFlatNumber(event.target.value)} placeholder="e.g. 002, 0101, 1313" inputMode="text" className="min-h-11 w-full rounded-md border border-input bg-background px-3" /></label><label className="space-y-1 text-sm font-semibold">Flat status<select value={newFlatStatus} onChange={event => setNewFlatStatus(event.target.value as 'ACTIVE' | 'INACTIVE')} className="min-h-11 w-full rounded-md border border-input bg-background px-3"><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label><div className="self-end"><Button type="submit" disabled={saving || !newFlatBuildingId || !newFlatNumber.trim()}>{saving ? 'Creating…' : 'Add Flat'}</Button></div></form></CardContent></Card> : null}
      {!loading ? <div className="space-y-3 rounded-lg border border-border p-4"><p className="text-sm">If a building is missing, ask a System Admin to create it in this society, then refresh this list.</p><Button variant="outline" onClick={() => void load()}>Refresh accounts and flats</Button>{flats?.length ? <label className="block text-sm font-semibold">Search saved flats<input type="search" value={flatSearch} onChange={event => setFlatSearch(event.target.value)} placeholder="Flat number, floor or building name" className="min-h-11 w-full rounded-md border border-input bg-background px-3" /></label> : null}{flats?.length && matchingFlats.length === 0 ? <p role="status" className="text-sm">No saved flats match. Clear the search or create the missing flat above.</p> : null}</div> : null}

      {!loading && users && flats && users.length > 0 ? <>
        <Card className="task-form">
          <CardHeader><CardTitle>Add a society membership</CardTitle><CardDescription>Use the account and flat in the society's verified membership record. Membership is separate from the account's application role; duplicate active memberships are rejected.</CardDescription></CardHeader>
          <CardContent><form onSubmit={(event) => void submitMembership(event)} className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm font-semibold">Existing society account<select required value={membershipUserId} onChange={(event) => setMembershipUserId(event.target.value)} className="min-h-11 w-full rounded-md border border-input bg-background px-3 font-normal"><option value="">Select an account</option>{eligiblePeople.map((person) => <option key={person._id} value={person._id}>{person.name} · {person.email} · {person.role} · {person.status}</option>)}</select></label>
            <label className="space-y-1 text-sm font-semibold">Flat<select required value={membershipFlatId} onChange={(event) => setMembershipFlatId(event.target.value)} className="min-h-11 w-full rounded-md border border-input bg-background px-3 font-normal"><option value="">Select a flat</option>{matchingFlats.map((flat) => <option key={flat._id} value={flat._id}>{buildingLabel(flat)} · {flat.flatNumber} · {flat.status}</option>)}</select></label>
            <label className="space-y-1 text-sm font-semibold">Membership category<select aria-describedby="membership-category-help" value={membershipType} onChange={(event) => setMembershipType(event.target.value as SocietyMembership['membershipType'])} className="min-h-11 w-full rounded-md border border-input bg-background px-3 font-normal"><option>PRIMARY</option><option>JOINT</option><option>ASSOCIATE</option><option>PROVISIONAL</option></select><span id="membership-category-help" className="block text-xs font-normal text-muted-foreground">Copy the recorded category. These categories do not automatically grant voting rights.</span></label>
            <label className="space-y-1 text-sm font-semibold">Membership status<select aria-describedby="membership-status-help" value={membershipStatus} onChange={(event) => setMembershipStatus(event.target.value as SocietyMembership['membershipStatus'])} className="min-h-11 w-full rounded-md border border-input bg-background px-3 font-normal"><option>ACTIVE</option><option>INACTIVE</option></select><span id="membership-status-help" className="block text-xs font-normal text-muted-foreground">ACTIVE refers to this membership record, not account activation or voting eligibility.</span></label>
            <div><Button type="submit" disabled={saving || !membershipUserId || !membershipFlatId}>{saving ? 'Saving…' : 'Add membership'}</Button></div>
          </form></CardContent>
        </Card>

        <Card className="task-form">
          <CardHeader><CardTitle>Record a flat relationship</CardTitle><CardDescription>Ownership records who owns a flat; residence records who lives there. Neither creates society membership or voting rights. Use verified society records.</CardDescription></CardHeader>
          <CardContent><form aria-label="Record a flat relationship" onSubmit={(event) => void submitRelationship(event)} className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm font-semibold">Relationship<select value={relationshipKind} onChange={(event) => { setRelationshipKind(event.target.value as RelationshipKind); setRelationshipType(''); }} className="min-h-11 w-full rounded-md border border-input bg-background px-3 font-normal"><option value="ownership">Ownership</option><option value="residence">Residence / tenancy</option></select></label>
            <label className="space-y-1 text-sm font-semibold">Building<select required value={relationshipBuildingId} onChange={(event) => { setRelationshipBuildingId(event.target.value); setRelationshipFlatId(''); setRelationshipFlatNumber(''); }} className="min-h-11 w-full rounded-md border border-input bg-background px-3 font-normal"><option value="">Select a building</option>{buildings.map(building => <option key={building._id} value={building._id}>{building.name}{building.buildingCode ? ` · ${building.buildingCode}` : ''}</option>)}</select></label>
            <label className="space-y-1 text-sm font-semibold">Flat number<input required list="relationship-flat-options" value={relationshipFlatNumber} onChange={(event) => selectRelationshipFlatNumber(event.target.value)} inputMode="text" placeholder="e.g. 002, 0101, 1313" className="min-h-11 w-full rounded-md border border-input bg-background px-3 font-normal" /><datalist id="relationship-flat-options">{(flats ?? []).filter(flat => flat.buildingId === relationshipBuildingId).map(flat => <option key={flat._id} value={flat.flatNumber} label={`${buildingLabel(flat)} · ${flat.status}`} />)}</datalist><span className="block text-xs font-normal text-muted-foreground">Flat numbers are text. Leading zeros are preserved.</span></label>
            {relationshipFlatNumber.trim() && !relationshipFlatId ? <div className="md:col-span-2"><p className="mb-2 text-sm">No saved flat with this number in the selected building.</p><Button type="button" variant="outline" disabled={saving || !relationshipBuildingId} onClick={() => void addFlat(relationshipBuildingId, relationshipFlatNumber)}>Create Flat {relationshipFlatNumber}</Button></div> : null}
            {relationshipFlatId ? <p className="md:col-span-2 text-sm text-muted-foreground">Selected saved flat {relationshipFlatNumber}. Each additional joint owner is recorded as a separate ownership relationship.</p> : null}
            <label className="space-y-1 text-sm font-semibold">Existing society account<select required value={relationshipUserId} onChange={(event) => setRelationshipUserId(event.target.value)} className="min-h-11 w-full rounded-md border border-input bg-background px-3 font-normal"><option value="">Select an account</option>{eligiblePeople.map((person) => <option key={person._id} value={person._id}>{person.name} · {person.email}</option>)}</select></label>
            <label className="space-y-1 text-sm font-semibold">{relationshipKind === 'ownership' ? 'Ownership type' : 'Occupancy type'} *<input required aria-describedby="relationship-type-help" value={relationshipType} onChange={(event) => setRelationshipType(event.target.value)} className="min-h-11 w-full rounded-md border border-input bg-background px-3 font-normal" /><span id="relationship-type-help" className="block text-xs font-normal text-muted-foreground">Society-supplied text, for example {relationshipKind === 'ownership' ? 'PRIMARY' : 'TENANT'}. This is a recorded classification, not a legal entitlement.</span></label>
            <label className="space-y-1 text-sm font-semibold">Relationship status *<input required aria-describedby="relationship-status-help" value={relationshipStatus} onChange={(event) => setRelationshipStatus(event.target.value)} className="min-h-11 w-full rounded-md border border-input bg-background px-3 font-normal" /><span id="relationship-status-help" className="block text-xs font-normal text-muted-foreground">Use the recorded status, for example ACTIVE. This text does not activate the user's account.</span></label>
            {relationshipKind === 'ownership' ? <label className="space-y-1 text-sm font-semibold">Ownership order (optional)<input type="number" min="1" step="1" aria-describedby="ownership-order-help" value={ownershipOrder} onChange={(event) => setOwnershipOrder(event.target.value)} className="min-h-11 w-full rounded-md border border-input bg-background px-3 font-normal" /><span id="ownership-order-help" className="block text-xs font-normal text-muted-foreground">A positive whole number from the ownership record, for example 1. It does not appoint a voter.</span></label> : null}
            <label className="space-y-1 text-sm font-semibold">Start date (optional)<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="min-h-11 w-full rounded-md border border-input bg-background px-3 font-normal" /></label>
            <label className="space-y-1 text-sm font-semibold">End date (optional)<input type="date" aria-describedby="relationship-end-help" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="min-h-11 w-full rounded-md border border-input bg-background px-3 font-normal" /><span id="relationship-end-help" className="block text-xs font-normal text-muted-foreground">Leave blank if no end is recorded. It cannot precede the start date.</span></label>
            <div><Button type="submit" disabled={saving || !relationshipUserId || !relationshipFlatId}>{saving ? 'Saving…' : `Save ${relationshipKind} record`}</Button></div>
          </form></CardContent>
          <CardContent className="grid gap-5 border-t border-border/60 pt-5 md:grid-cols-2">
            <div><h3 className="font-semibold">Ownership records</h3>{relationshipLoading ? <p className="mt-2 text-sm text-muted-foreground">Loading…</p> : ownerships === null ? <button type="button" className="mt-2 text-sm text-info underline" onClick={() => void loadRelationships()}>Retry loading relationships</button> : ownerships.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No ownership records for this flat.</p> : <ul className="mt-2 space-y-2 text-sm">{ownerships.map((record) => <li key={record._id}>{peopleById.get(record.userId)?.name ?? 'Account'} · {record.ownershipType} · {record.status}</li>)}</ul>}</div>
            <div><h3 className="font-semibold">Residence records</h3>{relationshipLoading ? <p className="mt-2 text-sm text-muted-foreground">Loading…</p> : residents === null ? <button type="button" className="mt-2 text-sm text-info underline" onClick={() => void loadRelationships()}>Retry loading relationships</button> : residents.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No residence records for this flat.</p> : <ul className="mt-2 space-y-2 text-sm">{residents.map((record) => <li key={record._id}>{peopleById.get(record.userId)?.name ?? 'Account'} · {record.occupancyType} · {record.status}</li>)}</ul>}</div>
          </CardContent>
        </Card>

        <section className="space-y-4" aria-labelledby="membership-list-title">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Assigned society</p><h2 id="membership-list-title" className="mt-1 font-headline text-2xl font-bold">Memberships</h2></div><label className="w-full max-w-sm space-y-1 text-sm font-semibold">Search accounts and memberships<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} className="min-h-11 w-full rounded-md border border-input bg-background px-3 font-normal" /></label></div>
          {memberships?.length === 0 ? <EmptyState title="No memberships recorded" description="Create a membership from an existing same-society account and flat. This does not itself assert governance eligibility." /> : visibleMemberships.length === 0 ? <EmptyState title="No matching membership" description="Try a different name, email, flat number or membership status." /> : <div className="space-y-2">{visibleMemberships.map((membership) => <Card key={membership._id} className="member-record"><CardContent className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">{peopleById.get(membership.userId)?.name ?? 'Account'} <span className="font-normal text-muted-foreground">· {peopleById.get(membership.userId)?.email ?? 'Profile unavailable'}</span></p><p className="text-sm text-muted-foreground">Flat {flatsById.get(membership.unitId)?.flatNumber ?? 'unavailable'} · {membership.membershipType}</p></div><span className="w-fit rounded-full bg-accent px-3 py-1 text-xs font-semibold">{membership.membershipStatus}</span></CardContent></Card>)}</div>}
        </section>
      </> : null}
    </div>
  );
}
