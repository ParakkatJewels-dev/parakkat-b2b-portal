import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '../../lib/router';
import { AppShell } from '../../components/layout/AppShell';
import {
  Badge,
  Button,
  DataTable,
  Field,
  Input,
  Modal,
  PageHeader,
  SearchInput,
  Stat,
  Toggle,
  Toolbar,
  type Column,
} from '../../components/ui/kit';
import { CountUp } from '../../components/ui/CountUp';
import { SkeletonRows } from '../../components/ui/Skeleton';
import * as agentsApi from '../../api/agents.api';
import type { Agent, Permissions } from '../../api/agents.api';

const PERM_LABELS: { key: keyof Permissions; label: string }[] = [
  { key: 'canBook', label: 'Create bookings' },
  { key: 'canCancel', label: 'Cancel bookings' },
  { key: 'canModify', label: 'Modify bookings' },
  { key: 'canViewReports', label: 'Access reports' },
];
const lift = 'transition duration-200 hover:-translate-y-0.5 hover:shadow-md';

export function AgencyAgentsPage() {
  const qc = useQueryClient();
  const { data: agents = [], isLoading } = useQuery({ queryKey: ['agents'], queryFn: agentsApi.listAgents });
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [credential, setCredential] = useState<{ email: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['agents'] });
  const onErr = (e: unknown) => setError(extractError(e));

  const statusM = useMutation({ mutationFn: (v: { id: string; status: 'ACTIVE' | 'SUSPENDED' }) => agentsApi.setAgentStatus(v.id, v.status), onSuccess: invalidate, onError: onErr });
  const resetM = useMutation({
    mutationFn: (a: Agent) => agentsApi.resetAgentPassword(a.id).then((r) => ({ email: a.email, password: r.tempPassword })),
    onSuccess: (c) => { invalidate(); setCredential(c); },
    onError: onErr,
  });
  const deleteM = useMutation({ mutationFn: (id: string) => agentsApi.deleteAgent(id), onSuccess: invalidate, onError: onErr });
  const busy = statusM.isPending || resetM.isPending || deleteM.isPending;

  const rows = useMemo(
    () => agents.filter((a) => [a.name ?? '', a.email].some((f) => f.toLowerCase().includes(q.toLowerCase()))),
    [agents, q],
  );

  const columns: Column<Agent>[] = [
    {
      header: 'Agent',
      render: (a) => (
        <Link to={`/agency/agents/${a.id}`} className="block hover:underline">
          <div className="font-medium text-slate-800">{a.name ?? '—'}</div>
          <div className="text-xs text-slate-400">{a.email}</div>
        </Link>
      ),
    },
    {
      header: 'Permissions',
      render: (a) => (
        <div className="flex flex-wrap gap-1">
          {PERM_LABELS.filter((p) => a[p.key]).map((p) => (
            <span key={p.key} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{p.label}</span>
          ))}
          {PERM_LABELS.every((p) => !a[p.key]) && <span className="text-xs text-slate-400">No permissions</span>}
        </div>
      ),
    },
    { header: 'Bookings', align: 'right', render: (a) => a.bookings },
    { header: 'Status', render: (a) => <Badge tone={a.status === 'ACTIVE' ? 'green' : 'slate'}>{a.status === 'ACTIVE' ? 'Active' : 'Disabled'}</Badge> },
    {
      header: 'Actions',
      align: 'right',
      render: (a) => (
        <div className="flex justify-end gap-1.5">
          <Button variant="ghost" onClick={() => { setError(null); setEditing(a); }}>Permissions</Button>
          {a.status === 'ACTIVE' ? (
            <Button variant="danger" disabled={busy} onClick={() => { setError(null); statusM.mutate({ id: a.id, status: 'SUSPENDED' }); }}>Disable</Button>
          ) : (
            <Button variant="secondary" disabled={busy} onClick={() => { setError(null); statusM.mutate({ id: a.id, status: 'ACTIVE' }); }}>Enable</Button>
          )}
          <Button variant="ghost" disabled={busy} onClick={() => { setError(null); resetM.mutate(a); }}>Reset password</Button>
          <Button variant="ghost" disabled={busy} onClick={() => { if (confirm(`Delete ${a.email}? This only works if they have no bookings.`)) { setError(null); deleteM.mutate(a.id); } }}>Delete</Button>
        </div>
      ),
    },
  ];

  return (
    <AppShell>
      <PageHeader
        title="Agent Management"
        subtitle="Manage the users under your agency, their permissions and access."
        actions={<Button variant="primary" onClick={() => { setError(null); setCreating(true); }}>+ Create Agent</Button>}
      />

      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Agents" value={<CountUp to={agents.length} />} tone="blue" className={lift} />
        <Stat label="Active" value={<CountUp to={agents.filter((a) => a.status === 'ACTIVE').length} />} tone="green" className={lift} />
        <Stat label="Disabled" value={<CountUp to={agents.filter((a) => a.status === 'SUSPENDED').length} />} tone="slate" className={lift} />
        <Stat label="Bookings (all)" value={<CountUp to={agents.reduce((s, a) => s + a.bookings, 0)} />} tone="violet" className={lift} />
      </div>

      <Toolbar><SearchInput value={q} onChange={setQ} placeholder="Search agents…" /></Toolbar>

      {isLoading ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm"><tbody><SkeletonRows rows={5} cols={5} /></tbody></table>
        </div>
      ) : (
        <DataTable columns={columns} rows={rows} rowKey={(a) => a.id} empty="No agents yet. Create your first sub-agent." />
      )}

      {creating && <CreateAgentModal onClose={() => setCreating(false)} onCreated={(c) => { setCreating(false); if (c) setCredential(c); }} />}
      {editing && <PermissionsModal agent={editing} onClose={() => setEditing(null)} />}
      {credential && (
        <Modal title="Temporary password" onClose={() => setCredential(null)} footer={<Button variant="primary" onClick={() => setCredential(null)}>Done</Button>}>
          <p className="text-sm text-slate-600">Share these credentials with the agent. The password is shown only once.</p>
          <div className="mt-3 space-y-1 rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
            <div><span className="text-slate-400">Email:</span> <span className="font-medium text-slate-800">{credential.email}</span></div>
            <div><span className="text-slate-400">Password:</span> <span className="font-mono font-medium text-slate-800">{credential.password}</span></div>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}

function CreateAgentModal({ onClose, onCreated }: { onClose: () => void; onCreated: (c: { email: string; password: string } | null) => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', email: '' });
  const [perms, setPerms] = useState<Permissions>({ canBook: true, canCancel: false, canModify: false, canViewReports: false });
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => agentsApi.createAgent({ name: form.name, email: form.email, permissions: perms }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['agents'] });
      onCreated(r.tempPassword ? { email: r.agent.email, password: r.tempPassword } : null);
    },
    onError: (e) => setError(extractError(e)),
  });

  return (
    <Modal
      title="Create Agent"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={create.isPending || !form.name || !form.email} onClick={() => create.mutate()}>{create.isPending ? 'Creating…' : 'Create agent'}</Button>
        </>
      }
    >
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="space-y-3">
        <Field label="Full name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Anjali Suresh" /></Field>
        <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="agent@agency.com" /></Field>
        <div>
          <div className="mb-1.5 text-xs font-medium text-slate-600">Permissions</div>
          <div className="space-y-2">
            {PERM_LABELS.map((p) => (
              <div key={p.key} className="flex items-center justify-between">
                <span className="text-sm text-slate-700">{p.label}</span>
                <Toggle checked={perms[p.key]} onChange={(v) => setPerms((prev) => ({ ...prev, [p.key]: v }))} />
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-slate-400">A temporary password is generated and shown once after creation.</p>
      </div>
    </Modal>
  );
}

function PermissionsModal({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const qc = useQueryClient();
  const [perms, setPerms] = useState<Permissions>({ canBook: agent.canBook, canCancel: agent.canCancel, canModify: agent.canModify, canViewReports: agent.canViewReports });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => agentsApi.updateAgent(agent.id, { permissions: perms }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['agents'] }); onClose(); },
    onError: (e) => setError(extractError(e)),
  });
  return (
    <Modal
      title={`Permissions · ${agent.name ?? agent.email}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save permissions'}</Button>
        </>
      }
    >
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="space-y-3">
        {PERM_LABELS.map((p) => (
          <div key={p.key} className="flex items-center justify-between">
            <span className="text-sm text-slate-700">{p.label}</span>
            <Toggle checked={perms[p.key]} onChange={(v) => setPerms((prev) => ({ ...prev, [p.key]: v }))} />
          </div>
        ))}
      </div>
    </Modal>
  );
}

function extractError(err: unknown): string {
  return (err as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'Something went wrong';
}
