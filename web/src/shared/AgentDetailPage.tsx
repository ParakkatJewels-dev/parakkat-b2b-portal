import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '../lib/router';
import { AppShell } from '../components/layout/AppShell';
import { Skeleton, SkeletonForm, SkeletonStats } from '../components/ui/Skeleton';
import { Badge, Button, Card, Modal, PageHeader, Stat, Toggle, inr } from '../components/ui/kit';
import * as agentsApi from '../api/agents.api';
import type { AgentDetail, Permissions } from '../api/agents.api';
import { useAuth } from '../hooks/useAuth';

const PERM_LABELS: { key: keyof Permissions; label: string }[] = [
  { key: 'canBook', label: 'Create bookings' },
  { key: 'canCancel', label: 'Cancel bookings' },
  { key: 'canModify', label: 'Modify bookings' },
  { key: 'canViewReports', label: 'Access reports' },
];

const BOOKING_STATE_TONE: Record<string, 'green' | 'red' | 'amber' | 'blue' | 'slate'> = {
  DRAFT: 'slate',
  AWAITING_PAYMENT: 'amber',
  CONFIRMED_ON_CREDIT: 'blue',
  PAID: 'blue',
  CONFIRMED: 'green',
  COMMITTED: 'green',
  COMMIT_FAILED: 'red',
  CANCELLED: 'red',
  EXPIRED: 'slate',
};

function extractError(err: unknown): string {
  return (err as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'Action failed';
}

export function AgentDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const backTo = isAdmin ? '/admin/agents' : '/agency/agents';

  const [error, setError] = useState<string | null>(null);
  const [editingPerms, setEditingPerms] = useState(false);
  const [credential, setCredential] = useState<{ email: string; password: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: agent, isLoading } = useQuery({
    queryKey: ['agent-detail', id],
    queryFn: () => agentsApi.getAgentDetail(id),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['agent-detail', id] });
    queryClient.invalidateQueries({ queryKey: ['agents'] });
    queryClient.invalidateQueries({ queryKey: ['agents', 'all'] });
  };

  const statusM = useMutation({
    mutationFn: (status: 'ACTIVE' | 'SUSPENDED') => agentsApi.setAgentStatus(id, status),
    onSuccess: invalidate,
    onError: (e) => setError(extractError(e)),
  });
  const resetM = useMutation({
    mutationFn: () => agentsApi.resetAgentPassword(id).then((r) => ({ email: agent!.email, password: r.tempPassword })),
    onSuccess: (c) => {
      invalidate();
      setCredential(c);
    },
    onError: (e) => setError(extractError(e)),
  });
  const logoutM = useMutation({
    mutationFn: () => agentsApi.forceLogoutAgent(id),
    onSuccess: invalidate,
    onError: (e) => setError(extractError(e)),
  });
  const deleteM = useMutation({
    mutationFn: () => agentsApi.deleteAgent(id),
    onSuccess: () => navigate(backTo),
    onError: (e) => setError(extractError(e)),
  });

  const busy = statusM.isPending || resetM.isPending || logoutM.isPending || deleteM.isPending;

  if (isLoading || !agent) {
    return (
      <AppShell title="Agent">
        <div className="space-y-4">
          <Skeleton className="h-7 w-64" />
          <SkeletonStats count={4} />
          <SkeletonForm sections={2} fields={4} />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Agent Detail">
      <Link to={backTo} className="text-sm text-slate-500 hover:underline">
        ← Back to agents
      </Link>

      <PageHeader
        title={agent.name ?? agent.email}
        subtitle={isAdmin ? agent.agencyName : agent.email}
        actions={
          <>
            {agent.status === 'ACTIVE' ? (
              <Button variant="danger" disabled={busy} onClick={() => { setError(null); statusM.mutate('SUSPENDED'); }}>
                Disable
              </Button>
            ) : (
              <Button variant="secondary" disabled={busy} onClick={() => { setError(null); statusM.mutate('ACTIVE'); }}>
                Enable
              </Button>
            )}
            <Button variant="secondary" disabled={busy} onClick={() => { setError(null); resetM.mutate(); }}>
              Reset password
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => { setError(null); logoutM.mutate(); }}>
              Force logout
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          </>
        }
      />

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone={agent.status === 'ACTIVE' ? 'green' : 'slate'}>{agent.status === 'ACTIVE' ? 'Active' : 'Disabled'}</Badge>
        {agent.mustChangePassword && <Badge tone="amber">Password change pending</Badge>}
        <Badge tone={agent.mfaEnabled ? 'blue' : 'slate'}>{agent.mfaEnabled ? '2FA enabled' : '2FA not set up'}</Badge>
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total bookings" value={agent.stats.totalBookings} tone="blue" />
        <Stat label="Confirmed" value={agent.stats.confirmedBookings} tone="green" />
        <Stat label="Cancelled" value={agent.stats.cancelledBookings} tone="red" />
        <Stat label="Revenue" value={inr(agent.stats.totalRevenue)} tone="violet" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Profile">
          <Row label="Name" value={agent.name ?? '—'} />
          <Row label="Email" value={agent.email} />
          {isAdmin && <Row label="Agency" value={agent.agencyName} />}
          <Row label="Created by" value={agent.createdBy ? (agent.createdBy.name ?? agent.createdBy.email) : '—'} />
          <Row label="Created" value={new Date(agent.createdAt).toLocaleDateString()} />
        </Card>

        <Card
          title="Permissions"
          action={
            !editingPerms ? (
              <button onClick={() => setEditingPerms(true)} className="text-xs font-medium text-blue-700 hover:underline">
                Edit
              </button>
            ) : undefined
          }
        >
          <PermissionsBlock agent={agent} editing={editingPerms} onDone={() => setEditingPerms(false)} onSaved={invalidate} />
        </Card>

        <Card title={`Recent bookings (${agent.recentBookings.length})`} className="lg:col-span-2">
          {agent.recentBookings.length === 0 ? (
            <p className="text-sm text-slate-400">No bookings yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {agent.recentBookings.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-800">{b.resortName}</p>
                    <p className="truncate text-xs text-slate-400">
                      {new Date(b.checkIn).toLocaleDateString()} → {new Date(b.checkOut).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-medium text-slate-700">{inr(b.agencyPrice)}</span>
                    <Badge tone={BOOKING_STATE_TONE[b.state] ?? 'slate'}>{b.state.replace(/_/g, ' ')}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent activity" className="lg:col-span-2">
          {agent.recentActivity.length === 0 ? (
            <p className="text-sm text-slate-400">No activity recorded.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {agent.recentActivity.map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="text-slate-700">{a.event.replace(/_/g, ' ')}</span>
                  <span className="text-xs text-slate-400">{new Date(a.createdAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {credential && (
        <Modal title="Temporary password" onClose={() => setCredential(null)} footer={<Button variant="primary" onClick={() => setCredential(null)}>Done</Button>}>
          <p className="text-sm text-slate-600">Share these credentials with the agent. The password is shown only once.</p>
          <div className="mt-3 space-y-1 rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
            <div><span className="text-slate-400">Email:</span> <span className="font-medium text-slate-800">{credential.email}</span></div>
            <div><span className="text-slate-400">Password:</span> <span className="font-mono font-medium text-slate-800">{credential.password}</span></div>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <Modal
          title="Delete agent"
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button
                variant="danger"
                disabled={deleteM.isPending}
                onClick={() => {
                  setError(null);
                  setConfirmDelete(false);
                  deleteM.mutate();
                }}
              >
                {deleteM.isPending ? 'Deleting…' : 'Delete'}
              </Button>
            </>
          }
        >
          <p className="text-sm text-slate-600">
            Delete <strong>{agent.name ?? agent.email}</strong>? This is only allowed if the agent has no bookings or audit
            history. This cannot be undone.
          </p>
        </Modal>
      )}
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-900">{value ?? '—'}</span>
    </div>
  );
}

function PermissionsBlock({
  agent,
  editing,
  onDone,
  onSaved,
}: {
  agent: AgentDetail;
  editing: boolean;
  onDone: () => void;
  onSaved: () => void;
}) {
  const [perms, setPerms] = useState<Permissions>({
    canBook: agent.canBook,
    canCancel: agent.canCancel,
    canModify: agent.canModify,
    canViewReports: agent.canViewReports,
  });
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => agentsApi.updateAgent(agent.id, { permissions: perms }),
    onSuccess: () => {
      onSaved();
      onDone();
    },
    onError: (e) => setError(extractError(e)),
  });

  if (!editing) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {PERM_LABELS.filter((p) => agent[p.key]).map((p) => (
          <span key={p.key} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
            {p.label}
          </span>
        ))}
        {PERM_LABELS.every((p) => !agent[p.key]) && <span className="text-sm text-slate-400">No permissions granted</span>}
      </div>
    );
  }

  return (
    <div>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="space-y-2">
        {PERM_LABELS.map((p) => (
          <div key={p.key} className="flex items-center justify-between">
            <span className="text-sm text-slate-700">{p.label}</span>
            <Toggle checked={perms[p.key]} onChange={(v) => setPerms((prev) => ({ ...prev, [p.key]: v }))} />
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button onClick={onDone}>Cancel</Button>
        <Button variant="primary" disabled={save.isPending} onClick={() => { setError(null); save.mutate(); }}>
          {save.isPending ? 'Saving…' : 'Save permissions'}
        </Button>
      </div>
    </div>
  );
}
