import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '../../lib/router';
import { AppShell } from '../../components/layout/AppShell';
import { Badge, Button, DataTable, Field, Input, Modal, PageHeader, SearchInput, Stat, Toggle, Toolbar, type Column } from '../../components/ui/kit';
import { Icons } from '../../components/layout/icons';
import { CountUp } from '../../components/ui/CountUp';
import { SkeletonRows } from '../../components/ui/Skeleton';
import * as agentsApi from '../../api/agents.api';
import type { Agent, Permissions } from '../../api/agents.api';
import * as adminApi from '../../api/admin.api';

const PERM_LABELS: { key: keyof Permissions; label: string }[] = [
  { key: 'canBook', label: 'Book' },
  { key: 'canCancel', label: 'Cancel' },
  { key: 'canModify', label: 'Modify' },
  { key: 'canViewReports', label: 'Reports' },
];

export function AgentsPage() {
  const qc = useQueryClient();
  const { data: agents = [], isLoading } = useQuery({ queryKey: ['agents', 'all'], queryFn: agentsApi.listAllAgents });
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [credential, setCredential] = useState<{ email: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['agents', 'all'] });
  const onErr = (e: unknown) => setError(extractError(e));

  const statusM = useMutation({ mutationFn: (v: { id: string; status: 'ACTIVE' | 'SUSPENDED' }) => agentsApi.setAgentStatus(v.id, v.status), onSuccess: invalidate, onError: onErr });
  const resetM = useMutation({ mutationFn: (a: Agent) => agentsApi.resetAgentPassword(a.id).then((r) => ({ email: a.email, password: r.tempPassword })), onSuccess: (c) => { invalidate(); setCredential(c); }, onError: onErr });
  const logoutM = useMutation({ mutationFn: (id: string) => agentsApi.forceLogoutAgent(id), onSuccess: invalidate, onError: onErr });
  const deleteM = useMutation({ mutationFn: (id: string) => agentsApi.deleteAgent(id), onSuccess: invalidate, onError: onErr });
  const busy = statusM.isPending || resetM.isPending || logoutM.isPending || deleteM.isPending;

  const rows = useMemo(
    () => agents.filter((a) => [a.name ?? '', a.email, a.agencyName ?? ''].some((f) => f.toLowerCase().includes(q.toLowerCase()))),
    [agents, q],
  );

  const columns: Column<Agent>[] = [
    {
      header: 'Agent',
      render: (a) => (
        <Link to={`/admin/agents/${a.id}`} className="block hover:underline">
          <div className="font-medium text-slate-800">{a.name ?? '—'}</div>
          <div className="text-xs text-slate-400">{a.email}</div>
        </Link>
      ),
    },
    { header: 'Agency', render: (a) => a.agencyName },
    {
      header: 'Permissions',
      render: (a) => (
        <div className="flex flex-wrap gap-1">
          {PERM_LABELS.filter((p) => a[p.key]).map((p) => (
            <span key={p.key} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{p.label}</span>
          ))}
          {PERM_LABELS.every((p) => !a[p.key]) && <span className="text-xs text-slate-400">None</span>}
        </div>
      ),
    },
    { header: 'Bookings', align: 'right', render: (a) => a.bookings },
    { header: 'Status', render: (a) => <Badge tone={a.status === 'ACTIVE' ? 'green' : 'slate'}>{a.status === 'ACTIVE' ? 'Active' : 'Disabled'}</Badge> },
    {
      header: 'Actions',
      align: 'right',
      render: (a) => (
        <div className="relative flex justify-end">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setActiveMenuId(activeMenuId === a.id ? null : a.id);
            }}
            className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
          >
            <Icons.dots className="h-4 w-4" />
          </button>
          {activeMenuId === a.id && (
            <div className="absolute right-0 top-full mt-1 w-40 rounded-xl border border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-950 p-1.5 shadow-xl z-50 animate-pop-in space-y-0.5">
              {a.status === 'ACTIVE' ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setActiveMenuId(null);
                    statusM.mutate({ id: a.id, status: 'SUSPENDED' });
                  }}
                  className="w-full text-left px-2.5 py-1.5 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-lg transition-colors"
                >
                  Disable
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setActiveMenuId(null);
                    statusM.mutate({ id: a.id, status: 'ACTIVE' });
                  }}
                  className="w-full text-left px-2.5 py-1.5 text-xs font-semibold text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/20 rounded-lg transition-colors"
                >
                  Activate
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setActiveMenuId(null);
                  resetM.mutate(a);
                }}
                className="w-full text-left px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900 rounded-lg transition-colors"
              >
                Reset pwd
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setActiveMenuId(null);
                  logoutM.mutate(a.id);
                }}
                className="w-full text-left px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900 rounded-lg transition-colors"
              >
                Force logout
              </button>
              <div className="border-t border-slate-100 dark:border-slate-900 my-1" />
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setActiveMenuId(null);
                  if (confirm(`Delete ${a.email}?`)) deleteM.mutate(a.id);
                }}
                className="w-full text-left px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-lg transition-colors"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <AppShell>
      {activeMenuId && (
        <div className="fixed inset-0 z-40 cursor-default" onClick={() => setActiveMenuId(null)} />
      )}
      <PageHeader
        title="Agent Management"
        subtitle="All agents across every agency — create, disable, reset credentials and force logout."
        actions={!creating && <Button variant="primary" onClick={() => { setError(null); setCreating(true); }}>+ Create Agent</Button>}
      />

      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {creating && (
        <CreateAgentSection
          onClose={() => setCreating(false)}
          onCreated={(c) => { setCreating(false); if (c) setCredential(c); }}
        />
      )}

      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total Agents" value={<CountUp to={agents.length} />} tone="blue" />
        <Stat label="Active" value={<CountUp to={agents.filter((a) => a.status === 'ACTIVE').length} />} tone="green" />
        <Stat label="Disabled" value={<CountUp to={agents.filter((a) => a.status === 'SUSPENDED').length} />} tone="slate" />
        <Stat label="Bookings (all)" value={<CountUp to={agents.reduce((s, a) => s + a.bookings, 0)} />} tone="violet" />
      </div>

      <Toolbar><SearchInput value={q} onChange={setQ} placeholder="Search agents or agency…" /></Toolbar>

      {isLoading ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm"><tbody><SkeletonRows rows={6} cols={6} /></tbody></table>
        </div>
      ) : (
        <DataTable columns={columns} rows={rows} rowKey={(a) => a.id} empty="No agents found." />
      )}

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

/** Searchable agency typeahead — filters by legal name or GSTIN as you type. */
function AgencyPicker({
  agencies,
  value,
  onChange,
}: {
  agencies: { id: string; legalName: string; gstin: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = agencies.find((a) => a.id === value);
  const filtered = agencies
    .filter((a) => [a.legalName, a.gstin].some((f) => f.toLowerCase().includes(query.toLowerCase())))
    .slice(0, 8);

  return (
    <div className="relative">
      <input
        value={open ? query : selected?.legalName ?? ''}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); if (value) onChange(''); }}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search agency by name or GSTIN…"
        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-blue-400"
      />
      {open && (
        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-slate-400">No active agencies found.</div>
          ) : (
            filtered.map((a) => (
              <button
                key={a.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(a.id); setOpen(false); setQuery(''); }}
                className={`flex w-full flex-col items-start px-3 py-2 text-left hover:bg-slate-50 ${a.id === value ? 'bg-blue-50' : ''}`}
              >
                <span className="text-sm font-medium text-slate-800">{a.legalName}</span>
                <span className="font-mono text-xs text-slate-400">{a.gstin}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function CreateAgentSection({ onClose, onCreated }: { onClose: () => void; onCreated: (c: { email: string; password: string } | null) => void }) {
  const qc = useQueryClient();
  const { data: agencies } = useQuery({ queryKey: ['agencies'], queryFn: adminApi.listAgencies });
  const [form, setForm] = useState({ name: '', email: '', agencyId: '' });
  const [perms, setPerms] = useState<Permissions>({ canBook: true, canCancel: false, canModify: false, canViewReports: false });
  const [error, setError] = useState<string | null>(null);

  const activeAgencies = (agencies?.items ?? []).filter((a) => a.status === 'ACTIVE');

  const create = useMutation({
    mutationFn: () => agentsApi.createAgent({ name: form.name, email: form.email, agencyId: form.agencyId, permissions: perms }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['agents', 'all'] }); onCreated(r.tempPassword ? { email: r.agent.email, password: r.tempPassword } : null); },
    onError: (e) => setError(extractError(e)),
  });

  return (
    <div className="mb-3 rounded-xl border border-blue-200 bg-white shadow-sm ring-1 ring-blue-100">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-800">Create Agent</h2>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Close">✕</button>
      </div>
      <div className="p-4">
        {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <Field label="Agency">
              <AgencyPicker agencies={activeAgencies} value={form.agencyId} onChange={(id) => setForm({ ...form, agencyId: id })} />
            </Field>
            <Field label="Full name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Agent name" /></Field>
            <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="agent@agency.com" /></Field>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-slate-600">Permissions</div>
            <div className="space-y-2 rounded-lg border border-slate-100 bg-slate-50 p-3">
              {PERM_LABELS.map((p) => (
                <div key={p.key} className="flex items-center justify-between">
                  <span className="text-sm text-slate-700">{p.label}</span>
                  <Toggle checked={perms[p.key]} onChange={(v) => setPerms((prev) => ({ ...prev, [p.key]: v }))} />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2 border-t border-slate-100 pt-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={create.isPending || !form.name || !form.email || !form.agencyId} onClick={() => { setError(null); create.mutate(); }}>
            {create.isPending ? 'Creating…' : 'Create agent'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function extractError(err: unknown): string {
  return (err as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'Something went wrong';
}
