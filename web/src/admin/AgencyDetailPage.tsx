import { type FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '../lib/router';
import { AppShell } from '../components/layout/AppShell';
import { Skeleton, SkeletonForm, SkeletonStats } from '../components/ui/Skeleton';
import * as adminApi from '../api/admin.api';
import type { AgencyDetail, UpdateAgencyInput } from '../types/admin';
import { formatPaymentTerms } from '../shared/format';

function extractError(err: unknown): string {
  return (err as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'Action failed';
}

function money(n: number): string {
  return `₹${Number(n).toLocaleString('en-IN')}`;
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'ACTIVE' || status === 'PASSED' || status === 'PAID'
      ? 'bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400'
      : status === 'SUSPENDED' || status === 'FAILED' || status === 'VOID'
        ? 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400'
        : 'bg-slate-50 dark:bg-slate-900/60 text-slate-650 dark:text-slate-400';
  return <span className={`rounded-lg px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{status}</span>;
}

export function AgencyDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: agency, isLoading } = useQuery({
    queryKey: ['agency-detail', id],
    queryFn: () => adminApi.getAgencyDetail(id),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['agency-detail', id] });
    queryClient.invalidateQueries({ queryKey: ['agencies'] });
    queryClient.invalidateQueries({ queryKey: ['admin-summary'] });
  };

  const statusMutation = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: invalidate,
    onError: (e) => setError(extractError(e)),
  });

  if (isLoading || !agency) {
    return (
      <AppShell title="Agency">
        <div className="space-y-4">
          <Skeleton className="h-7 w-64" />
          <SkeletonStats count={4} />
          <SkeletonForm sections={2} fields={4} />
        </div>
      </AppShell>
    );
  }

  const runStatus = (fn: () => Promise<unknown>) => {
    setError(null);
    statusMutation.mutate(fn);
  };

  return (
    <AppShell title="Agency Detail">
      <Link to="/admin/agencies" className="text-sm font-semibold text-blue-600 hover:text-blue-750 hover:underline dark:text-blue-400 dark:hover:text-blue-300 transition-colors">
        ← Back to agencies
      </Link>

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">{agency.legalName}</h1>
          <StatusBadge status={agency.status} />
          {agency.isIndependent && (
            <span className="rounded-lg bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
              Independent
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {agency.status === 'ACTIVE' ? (
            <button
              disabled={statusMutation.isPending}
              onClick={() => runStatus(() => adminApi.suspendAgency(agency.id))}
              className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2 text-sm font-semibold text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/20 disabled:opacity-50 transition-colors"
            >
              Suspend
            </button>
          ) : (
            <button
              disabled={statusMutation.isPending}
              onClick={() => runStatus(() => adminApi.reactivateAgency(agency.id))}
              className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2 text-sm font-semibold text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/20 disabled:opacity-50 transition-colors"
            >
              Reactivate
            </button>
          )}
          <button
            disabled={statusMutation.isPending}
            onClick={() => setConfirmDelete(true)}
            className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2 text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 disabled:opacity-50 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>

      {error && <p className="mt-3 rounded-lg bg-red-50 dark:bg-red-950/20 px-3 py-2 text-sm text-red-700 dark:text-red-400">{error}</p>}

      {/* Financial roll-up */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Bookings" value={String(agency.stats.bookings)} />
        <StatCard label="Invoiced" value={money(agency.stats.invoiced)} />
        <StatCard label="Paid" value={money(agency.stats.paid)} />
        <StatCard label="Outstanding" value={money(agency.stats.outstanding)} accent="amber" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ProfileSection agency={agency} onError={setError} onSaved={invalidate} />
        <CommercialSection agency={agency} onError={setError} onSaved={invalidate} />
        <UsersSection agency={agency} />
        <DocumentsSection agency={agency} />
      </div>

      {confirmDelete && (
        <Modal title="Delete agency" onClose={() => setConfirmDelete(false)}>
          <p className="text-sm text-slate-650 dark:text-slate-350 leading-relaxed">
            Delete <strong>{agency.legalName}</strong>? This is only allowed if the agency has no bookings,
            invoices, or payments. This cannot be undone.
          </p>
          <div className="mt-5 flex justify-end gap-2.5">
            <button onClick={() => setConfirmDelete(false)} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-905 px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
              Cancel
            </button>
            <button
              onClick={() => {
                setError(null);
                setConfirmDelete(false);
                adminApi
                  .deleteAgency(agency.id)
                  .then(() => {
                    queryClient.invalidateQueries({ queryKey: ['agencies'] });
                    queryClient.invalidateQueries({ queryKey: ['admin-summary'] });
                    navigate('/admin/agencies');
                  })
                  .catch((e) => setError(extractError(e)));
              }}
              className="rounded-lg bg-red-600 hover:bg-red-700 px-4 py-2 text-sm font-bold text-white shadow-xs active:scale-95 transition-all"
            >
              Delete
            </button>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: 'amber' }) {
  return (
    <div className="rounded-xl border border-slate-200/50 bg-white/70 dark:border-slate-800/30 dark:bg-slate-900/40 p-4 shadow-xs">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-505">{label}</p>
      <p className={`mt-1.5 text-lg font-extrabold tracking-tight ${accent === 'amber' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`}>{value}</p>
    </div>
  );
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200/50 bg-white/80 dark:border-slate-800/40 dark:bg-slate-900/30 p-5 shadow-xs">
      <div className="mb-4 flex items-center justify-between border-b border-slate-100 dark:border-slate-800/50 pb-2.5">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm border-b border-slate-100/50 dark:border-slate-800/20 last:border-0">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-right font-medium text-slate-900 dark:text-white">{value ?? '—'}</span>
    </div>
  );
}

function ProfileSection({
  agency,
  onError,
  onSaved,
}: {
  agency: AgencyDetail;
  onError: (m: string | null) => void;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<UpdateAgencyInput>({});

  useEffect(() => {
    setForm({
      legalName: agency.legalName,
      gstin: agency.gstin,
      pan: agency.pan,
      contactEmail: agency.contactEmail,
      contactPhone: agency.contactPhone,
    });
  }, [agency]);

  const mutation = useMutation({
    mutationFn: () => adminApi.updateAgency(agency.id, form),
    onSuccess: () => {
      onSaved();
      setEditing(false);
    },
    onError: (e) => onError(extractError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    onError(null);
    mutation.mutate();
  }

  const fields: { key: keyof UpdateAgencyInput; label: string; hide?: boolean }[] = [
    { key: 'legalName', label: 'Legal name' },
    { key: 'gstin', label: 'GSTIN', hide: agency.isIndependent },
    { key: 'pan', label: 'PAN' },
    { key: 'contactEmail', label: 'Contact email' },
    { key: 'contactPhone', label: 'Contact phone' },
  ];

  return (
    <Card
      title="Profile"
      action={
        !editing ? (
          <button onClick={() => setEditing(true)} className="text-xs font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors">
            Edit
          </button>
        ) : (
          <button
            onClick={() => {
              setEditing(false);
              onError(null);
            }}
            className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:underline transition"
          >
            Cancel
          </button>
        )
      }
    >
      {!editing ? (
        <div>
          <Row label="Business type" value={agency.isIndependent ? 'Independent Agent' : 'Standard Agency'} />
          <Row label="Legal name" value={agency.legalName} />
          {!agency.isIndependent && <Row label="GSTIN" value={<span className="font-mono text-xs">{agency.gstin}</span>} />}
          <Row label="PAN" value={<span className="font-mono text-xs">{agency.pan}</span>} />
          <Row label="Contact email" value={agency.contactEmail} />
          <Row label="Contact phone" value={agency.contactPhone} />
          <Row label="Activated" value={agency.activatedAt ? new Date(agency.activatedAt).toLocaleDateString() : '—'} />
          <Row label="Created" value={new Date(agency.createdAt).toLocaleDateString()} />
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          {fields
            .filter((f) => !f.hide)
            .map((f) => (
              <label key={f.key} className="block text-sm space-y-1.5">
                <span className="font-semibold text-slate-700 dark:text-slate-350">{f.label}</span>
                <input
                  value={form[f.key] ?? ''}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                />
              </label>
            ))}
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/40 mt-3">
            <button
              type="submit"
              disabled={mutation.isPending}
              className="rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-bold text-white shadow-xs active:scale-95 transition-all disabled:opacity-50"
            >
              {mutation.isPending ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}

function CommercialSection({
  agency,
  onError,
  onSaved,
}: {
  agency: AgencyDetail;
  onError: (m: string | null) => void;
  onSaved: () => void;
}) {
  const config = agency.commercialConfigurations?.[0];
  const { data: tiers } = useQuery({ queryKey: ['tiers'], queryFn: adminApi.listTiers });
  const [tier, setTier] = useState(config?.tier ?? 'A');
  const [markup, setMarkup] = useState(String(config?.markupPct ?? ''));

  useEffect(() => {
    if (config?.tier) setTier(config.tier);
    if (config?.markupPct != null) setMarkup(String(config.markupPct));
  }, [config]);

  const tierDefaultMarkup = tiers?.[tier]?.markupPct;
  const numericMarkup = Number(markup);
  const markupInvalid = markup === '' || !Number.isFinite(numericMarkup) || numericMarkup < 0 || numericMarkup > 100;
  const isOverride = tierDefaultMarkup != null && Number.isFinite(numericMarkup) && numericMarkup !== tierDefaultMarkup;

  // Switching tier pre-fills the new tier's default markup (still editable).
  function changeTier(t: string) {
    setTier(t);
    const def = tiers?.[t]?.markupPct;
    if (def != null) setMarkup(String(def));
  }

  const mutation = useMutation({
    mutationFn: () => adminApi.updateAgencyCommercialConfig(agency.id, tier, Math.round(numericMarkup * 100) / 100),
    onSuccess: onSaved,
    onError: (e) => onError(extractError(e)),
  });

  return (
    <Card title="Commercial terms">
      {config ? (
        <div className="mb-4">
          <Row label="Tier" value={config.tier} />
          <Row label="Payment mode" value={config.paymentMode} />
          <Row label="Credit limit" value={money(Number(config.creditLimit))} />
          <Row label="Payment terms" value={formatPaymentTerms(config.paymentTerms)} />
          <Row label="Markup" value={`${config.markupPct}%`} />
        </div>
      ) : (
        <p className="mb-4 text-sm text-slate-400 dark:text-slate-500">No commercial configuration.</p>
      )}
      <div className="space-y-3 border-t border-slate-100 dark:border-slate-800/40 pt-3">
        <div className="flex items-end gap-2">
          <label className="flex-1 text-sm space-y-1.5">
            <span className="font-semibold text-slate-705 dark:text-slate-300">Tier</span>
            <select
              value={tier}
              onChange={(e) => changeTier(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-blue-500 transition-all"
            >
              {tiers ? (
                Object.keys(tiers).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))
              ) : (
                <option value="A">A</option>
              )}
            </select>
          </label>
          <label className="flex-1 text-sm space-y-1.5">
            <span className="font-semibold text-slate-705 dark:text-slate-300">Markup %</span>
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={markup}
              onChange={(e) => setMarkup(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-blue-500 transition-all"
            />
          </label>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-400 dark:text-slate-500">
            {tierDefaultMarkup != null &&
              (isOverride ? `Overriding tier ${tier} default of ${tierDefaultMarkup}%` : `Tier ${tier} default (${tierDefaultMarkup}%)`)}
          </span>
          <button
            disabled={mutation.isPending || markupInvalid}
            onClick={() => {
              onError(null);
              mutation.mutate();
            }}
            className="rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-bold text-white shadow-xs active:scale-95 transition-all disabled:opacity-50"
          >
            {mutation.isPending ? 'Updating…' : 'Update'}
          </button>
        </div>
      </div>
    </Card>
  );
}

function UsersSection({ agency }: { agency: AgencyDetail }) {
  return (
    <Card title={`Users (${agency.users.length})`}>
      {agency.users.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">No users linked to this agency.</p>
      ) : (
        <ul className="divide-y divide-slate-105 dark:divide-slate-800/40">
          {agency.users.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-800 dark:text-slate-200">{u.name ?? u.email}</p>
                <p className="truncate text-xs text-slate-400 dark:text-slate-505">{u.email}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {u.role}
                </span>
                <StatusBadge status={u.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DocumentsSection({ agency }: { agency: AgencyDetail }) {
  return (
    <Card title={`Documents (${agency.documents.length})`}>
      {agency.documents.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">No documents on file.</p>
      ) : (
        <ul className="divide-y divide-slate-105 dark:divide-slate-800/40">
          {agency.documents.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-805 dark:text-slate-200">{d.fileName ?? d.docType}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                  {d.docType} · {new Date(d.uploadedAt).toLocaleDateString()}
                </p>
              </div>
              <StatusBadge status={d.status} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 dark:bg-slate-950/60 backdrop-blur-xs" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-slate-200/50 dark:border-slate-800/40 bg-white dark:bg-slate-950 p-6 shadow-xl">
        <h3 className="mb-4 text-sm font-bold text-slate-850 dark:text-white">{title}</h3>
        {children}
      </div>
    </div>
  );
}
