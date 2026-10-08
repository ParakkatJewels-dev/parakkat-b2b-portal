import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '../../components/layout/AppShell';
import { Badge, Button, DataTable, PageHeader, Tabs, Toggle, type Column } from '../../components/ui/kit';
import { SkeletonRows } from '../../components/ui/Skeleton';
import * as securityApi from '../../api/security.api';
import * as settingsApi from '../../api/settings.api';
import type { SecuritySettings } from '../../api/settings.api';
import type { FailedLogin, Session } from '../../api/security.api';
import { MfaCard } from '../../shared/MfaCard';

const fmt = (d: string) => new Date(d).toLocaleString('en-IN');

export function SecurityPage() {
  const [tab, setTab] = useState('sessions');
  const qc = useQueryClient();

  const sessionsQ = useQuery({ queryKey: ['security', 'sessions'], queryFn: securityApi.listSessions });
  const failedQ = useQuery({ queryKey: ['security', 'failed'], queryFn: securityApi.listFailedLogins });
  const policyQ = useQuery({ queryKey: ['security', 'policy'], queryFn: securityApi.getPolicy });
  const settingsQ = useQuery({ queryKey: ['settings'], queryFn: settingsApi.getSettings });

  const revoke = useMutation({
    mutationFn: (id: string) => securityApi.revokeSession(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['security', 'sessions'] }),
  });

  // Editable MFA-enforcement policy (persisted to the security settings group).
  const [mfaForm, setMfaForm] = useState<SecuritySettings | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (settingsQ.data && !mfaForm) setMfaForm({ ...settingsQ.data.security });
  }, [settingsQ.data, mfaForm]);
  const saveMfa = useMutation({
    mutationFn: () => settingsApi.updateSettings('security', mfaForm!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['security', 'policy'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });
  const setMfa = (field: keyof SecuritySettings, value: boolean) =>
    setMfaForm((f) => (f ? { ...f, [field]: value } : f));

  const sessionCols: Column<Session>[] = [
    {
      header: 'User',
      render: (s) => (
        <div>
          <div className="font-medium text-slate-800">{s.user}</div>
          <div className="text-xs text-slate-400">{s.email}</div>
        </div>
      ),
    },
    { header: 'Role', render: (s) => <Badge tone="blue">{s.role}</Badge> },
    { header: 'IP', className: 'font-mono text-xs text-slate-600', render: (s) => s.ip ?? '—' },
    { header: 'Device', render: (s) => <span className="block max-w-[200px] truncate text-xs text-slate-500">{s.userAgent ?? '—'}</span> },
    { header: 'Started', render: (s) => <span className="text-slate-500">{fmt(s.createdAt)}</span> },
    { header: 'Last active', render: (s) => <span className="text-slate-500">{fmt(s.lastActiveAt)}</span> },
    { header: 'Actions', align: 'right', render: (s) => <Button variant="danger" disabled={revoke.isPending} onClick={() => revoke.mutate(s.id)}>Revoke</Button> },
  ];

  const failedCols: Column<FailedLogin>[] = [
    { header: 'Email', className: 'font-medium text-slate-800', render: (f) => f.email },
    { header: 'Role', render: (f) => (f.role ? <Badge tone="slate">{f.role}</Badge> : '—') },
    { header: 'Attempts', align: 'center', render: (f) => <Badge tone={f.attempts >= 5 ? 'red' : 'amber'}>{f.attempts}</Badge> },
    { header: 'Last attempt', render: (f) => <span className="text-slate-500">{fmt(f.lastAttempt)}</span> },
  ];

  const p = policyQ.data;

  return (
    <AppShell>
      <PageHeader title="Security" subtitle="Active sessions, failed login attempts and the effective security policy." />
      <Tabs
        tabs={[
          { key: 'sessions', label: 'Active Sessions', count: sessionsQ.data?.length },
          { key: 'failed', label: 'Failed Logins', count: failedQ.data?.length },
          { key: 'policy', label: 'Password & Policy' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'sessions' &&
        (sessionsQ.isLoading ? (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white"><table className="w-full text-sm"><tbody><SkeletonRows rows={6} cols={6} /></tbody></table></div>
        ) : (
          <DataTable columns={sessionCols} rows={sessionsQ.data ?? []} rowKey={(s) => s.id} empty="No active sessions." />
        ))}

      {tab === 'failed' &&
        (failedQ.isLoading ? (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white"><table className="w-full text-sm"><tbody><SkeletonRows rows={5} cols={4} /></tbody></table></div>
        ) : (
          <DataTable columns={failedCols} rows={failedQ.data ?? []} rowKey={(f) => f.email} empty="No failed login attempts recorded." />
        ))}

      {tab === 'policy' && p && (
        <div className="grid max-w-3xl gap-3 lg:grid-cols-2">
          {/* Admin's own two-factor enrolment */}
          <div className="lg:col-span-2"><MfaCard /></div>

          {/* Org-wide MFA enforcement — editable, persisted to settings */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2">
            <div className="mb-1 text-sm font-semibold text-slate-700">Two-factor enforcement</div>
            <div className="mb-3 text-xs text-slate-400">Control who is required to use MFA. The master switch must be on for any enforcement to apply.</div>
            {mfaForm && (
              <div className="space-y-1">
                <ToggleRow label="Enable MFA (master switch)" hint="When off, no one is prompted for a second factor." checked={mfaForm.mfaEnabled} onChange={(v) => setMfa('mfaEnabled', v)} />
                <ToggleRow label="Require for Admin & Verifier" checked={mfaForm.enforceAdmin} disabled={!mfaForm.mfaEnabled} onChange={(v) => setMfa('enforceAdmin', v)} />
                <ToggleRow label="Require for Agency principals" checked={mfaForm.enforceAgency} disabled={!mfaForm.mfaEnabled} onChange={(v) => setMfa('enforceAgency', v)} />
                <ToggleRow label="Require for Agents" checked={mfaForm.enforceAgent} disabled={!mfaForm.mfaEnabled} onChange={(v) => setMfa('enforceAgent', v)} />
                <div className="flex items-center gap-3 pt-3">
                  <Button variant="primary" disabled={saveMfa.isPending} onClick={() => saveMfa.mutate()}>{saveMfa.isPending ? 'Saving…' : 'Save enforcement'}</Button>
                  {saved && <span className="text-xs font-medium text-green-700">Saved — applies on next login.</span>}
                </div>
                <p className="pt-1 text-xs text-slate-400">Enforced users who haven&apos;t enrolled will be walked through setup at their next login.</p>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-2 text-sm font-semibold text-slate-700">Password policy</div>
            <Row label="Minimum length" value={`${p.password.minLength} characters`} />
            {p.password.requires.map((r) => (
              <Row key={r} label={r} value={<Badge tone="green">Required</Badge>} />
            ))}
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-2 text-sm font-semibold text-slate-700">Sessions</div>
            <Row label="Sign-in provider" value={p.session.provider} />
            <Row label="Stay signed in for" value={`${p.session.refreshTokenTtlDays} days`} />
          </div>
        </div>
      )}
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-2 text-sm last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-900">{value}</span>
    </div>
  );
}

function ToggleRow({ label, hint, checked, disabled, onChange }: { label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={`flex items-center justify-between gap-4 border-b border-slate-100 py-2.5 last:border-0 ${disabled ? 'opacity-50' : ''}`}>
      <div>
        <div className="text-sm font-medium text-slate-700">{label}</div>
        {hint && <div className="text-xs text-slate-400">{hint}</div>}
      </div>
      <Toggle checked={checked} onChange={(v) => !disabled && onChange(v)} />
    </div>
  );
}
