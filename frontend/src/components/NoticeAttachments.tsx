import { useState, type FormEvent } from 'react';
import { apiBlobRequest, apiRequest, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';

export function NoticeAttachments({ noticeId, attachmentIds, canUpload, token, onUploaded }: { noticeId: string; attachmentIds: string[]; canUpload: boolean; token: string; onUploaded: () => Promise<void> }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [success, setSuccess] = useState(false);
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const file = new FormData(form).get('scan');
    if (!(file instanceof File) || !file.size || file.size > 5 * 1024 * 1024) { setError('Select a JPEG or PNG scan no larger than 5 MiB.'); return; }
    setBusy(true); setError(null); setSuccess(false);
    try {
      await apiRequest(`/evidence/upload?noticeId=${encodeURIComponent(noticeId)}&category=NOTICE_ATTACHMENT`, { token, method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
      form.reset(); await onUploaded(); setSuccess(true);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Attachment upload failed. Refresh before retrying.'); }
    finally { setBusy(false); }
  }
  async function download(id: string) {
    setBusy(true); setError(null);
    try {
      const blob = await apiBlobRequest(`/evidence/${encodeURIComponent(id)}`, { token });
      const signature = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `${id}.${signature[0] === 0x89 ? 'png' : 'jpg'}`;
      document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Attachment download failed.'); }
    finally { setBusy(false); }
  }
  return <section aria-label="Notice attachments" className="space-y-3 border-t border-border pt-3">
    <p className="text-sm font-semibold">Document scans {attachmentIds.length ? `(${attachmentIds.length})` : ''}</p>
    {attachmentIds.map((id, index) => <Button key={id} variant="outline" disabled={busy} onClick={() => void download(id)}>Download scan {index + 1}</Button>)}
    {canUpload ? <form aria-label="Attach notice scan" onSubmit={event => void upload(event)} className="space-y-2"><label className="block text-sm">Add a scanned document or photo<input type="file" name="scan" accept="image/jpeg,image/png" required className="block min-h-11 w-full py-2" /></label><p className="text-xs text-muted-foreground">JPEG or PNG, up to 5 MiB per file. PDF and Office documents are not supported yet. Attach scans before publishing; published attachments are locked.</p><Button type="submit" disabled={busy}>{busy ? 'Transferring…' : 'Attach scan'}</Button></form> : null}
    {busy ? <p role="status" className="text-sm">Transferring private attachment…</p> : null}
    {success ? <p role="status" className="text-sm">Attachment saved. It will follow the notice’s publication and audience rules.</p> : null}
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
  </section>;
}
