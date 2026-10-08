import { type FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { Icons } from '../components/layout/icons';
import { SkeletonRows } from '../components/ui/Skeleton';
import * as adminApi from '../api/admin.api';
import type { Agency, CreateAgencyInput } from '../types/admin';
import { formatPaymentTerms } from '../shared/format';

type Tab = 'agencies' | 'pending';

export function AgencyManagementPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'agencies';
  const [showCreate, setShowCreate] = useState(params.get('action') === 'create');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (params.get('action') === 'create') setShowCreate(true);
  }, [params]);

  function setTab(t: Tab) {
    setParams(t === 'agencies' ? {} : { tab: t });
  }

  return (
    <AppShell title="Agency Management">
      {showCreate && (
        <div className="mb-6 rounded-2xl border border-slate-200/50 bg-white/80 dark:border-slate-800/40 dark:bg-slate-900/30 p-5 shadow-xs">
          <div className="mb-4 flex items-center justify-between border-b border-slate-100 dark:border-slate-800/50 pb-2.5">
            <h3 className="font-bold text-slate-800 dark:text-white text-base">Create New Agency</h3>
            <button
              onClick={() => {
                setShowCreate(false);
                setParams(tab === 'agencies' ? {} : { tab });
              }}
              className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-350 transition-colors font-medium"
            >
              ✕ Close section
            </button>
          </div>
          <CreateAgencyForm
            onClose={() => {
              setShowCreate(false);
              setParams(tab === 'agencies' ? {} : { tab });
            }}
            onError={setError}
          />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-xl bg-slate-100 dark:bg-slate-900/60 border border-slate-200/40 dark:border-slate-800/40 p-0.5 text-sm">
          <button onClick={() => setTab('agencies')} className={`rounded-lg px-4 py-2 transition-all ${tab === 'agencies' ? 'bg-white dark:bg-slate-800 font-bold text-slate-800 dark:text-white shadow-xs' : 'text-slate-550 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'}`}>
            Agencies
          </button>
          <button onClick={() => setTab('pending')} className={`rounded-lg px-4 py-2 transition-all ${tab === 'pending' ? 'bg-white dark:bg-slate-800 font-bold text-slate-800 dark:text-white shadow-xs' : 'text-slate-550 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'}`}>
            Pending Registrations
          </button>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-bold text-white shadow-xs active:scale-95 transition-all">
          <Icons.agencies className="h-4 w-4" /> Create Agency
        </button>
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-50 dark:bg-red-950/20 px-3 py-2 text-sm text-red-700 dark:text-red-400">{error}</p>}

      {tab === 'agencies' ? <AgenciesTab onError={setError} /> : <PendingTab onError={setError} />}
    </AppShell>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === 'ACTIVE'
    ? 'bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400'
    : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400';
  return <span className={`rounded-lg px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{status}</span>;
}

function extractError(err: unknown): string {
  return (err as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'Action failed';
}

type StatusFilter = 'all' | 'ACTIVE' | 'SUSPENDED';
type TypeFilter = 'all' | 'standard' | 'independent';

function AgenciesTab({ onError }: { onError: (m: string | null) => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['agencies'], queryFn: adminApi.listAgencies });
  const [confirmDelete, setConfirmDelete] = useState<Agency | null>(null);
  const [editingCommercial, setEditingCommercial] = useState<Agency | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') ?? '');

  useEffect(() => {
    const q = searchParams.get('search');
    if (q != null) {
      setSearch(q);
    }
  }, [searchParams]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['agencies'] });
    queryClient.invalidateQueries({ queryKey: ['admin-summary'] });
  };
  const run = (fn: () => Promise<unknown>) => {
    onError(null);
    fn().then(invalidate).catch((e) => onError(extractError(e)));
  };

  const q = search.trim().toLowerCase();
  const filtered = (data?.items ?? []).filter((a) => {
    if (statusFilter !== 'all' && a.status !== statusFilter) return false;
    if (typeFilter === 'independent' && !a.isIndependent) return false;
    if (typeFilter === 'standard' && a.isIndependent) return false;
    if (q) {
      const haystack = `${a.legalName} ${a.gstin} ${a.contactEmail} ${a.contactPhone}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
  const filtersActive = statusFilter !== 'all' || typeFilter !== 'all' || q.length > 0;

  return (
    <div>
      {activeMenuId && (
        <div className="fixed inset-0 z-40 cursor-default" onClick={() => setActiveMenuId(null)} />
      )}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, GSTIN, email, phone…"
            className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-all"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-blue-500 transition-all"
        >
          <option value="all">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
          className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-blue-500 transition-all"
        >
          <option value="all">All types</option>
          <option value="standard">Standard</option>
          <option value="independent">Independent</option>
        </select>
        {filtersActive && (
          <button
            onClick={() => {
              setSearch('');
              setStatusFilter('all');
              setTypeFilter('all');
            }}
            className="rounded-lg border border-slate-200 dark:border-slate-800 px-3.5 py-2 text-sm text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {!isLoading && (
        <p className="mb-2 text-xs text-slate-400">
          Showing {filtered.length} of {data?.items.length ?? 0} agencies
        </p>
      )}

      <div className="overflow-x-auto lg:overflow-visible rounded-xl border border-slate-200/50 bg-white dark:border-slate-800/40 dark:bg-slate-900/30 shadow-xs">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-xs uppercase tracking-wider text-slate-405 dark:text-slate-500">
            <th className="px-4 py-3">Agency</th>
            <th className="px-4 py-3">GSTIN</th>
            <th className="px-4 py-3">Contact</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/40">
          {isLoading && <SkeletonRows rows={6} cols={5} />}
          {filtered.map((a) => (
            <tr key={a.id} className="border-b border-slate-100 dark:border-slate-800/20 hover:bg-slate-50/50 dark:hover:bg-slate-900/10 transition-colors">
              <td className="px-4 py-3 font-semibold text-slate-800 dark:text-slate-200">
                <div className="flex items-center gap-2">
                  <Link to={`/admin/agencies/${a.id}`} className="text-blue-600 dark:text-blue-400 font-bold hover:underline">
                    {a.legalName}
                  </Link>
                  {a.isIndependent && (
                    <span className="rounded-lg bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 text-[9px] font-extrabold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                      Independent
                    </span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400">
                {a.isIndependent ? <span className="text-slate-400 dark:text-slate-500 font-sans italic">N/A (Aadhaar Only)</span> : a.gstin}
              </td>
              <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{a.contactEmail}</td>
              <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
              <td className="px-4 py-3">
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
                      <button
                        type="button"
                        onClick={() => {
                          setActiveMenuId(null);
                          setEditingCommercial(a);
                        }}
                        className="w-full text-left px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900 rounded-lg transition-colors"
                      >
                        Commercials
                      </button>
                      {a.status === 'ACTIVE' ? (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveMenuId(null);
                            run(() => adminApi.suspendAgency(a.id));
                          }}
                          className="w-full text-left px-2.5 py-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/20 rounded-lg transition-colors"
                        >
                          Suspend
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveMenuId(null);
                            run(() => adminApi.reactivateAgency(a.id));
                          }}
                          className="w-full text-left px-2.5 py-1.5 text-xs font-semibold text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/20 rounded-lg transition-colors"
                        >
                          Activate
                        </button>
                      )}
                      <div className="border-t border-slate-100 dark:border-slate-900 my-1" />
                      <button
                        type="button"
                        onClick={() => {
                          setActiveMenuId(null);
                          setConfirmDelete(a);
                        }}
                        className="w-full text-left px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-lg transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {!isLoading && filtered.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                {data?.items.length ? 'No agencies match your filters.' : 'No agencies yet.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>

      {confirmDelete && (
        <Modal title="Delete agency" onClose={() => setConfirmDelete(null)}>
          <p className="text-sm text-slate-600 dark:text-slate-350">
            Delete <strong>{confirmDelete.legalName}</strong>? This is only allowed if the agency has no bookings,
            invoices, or payments. This cannot be undone.
          </p>
          <div className="mt-5 flex justify-end gap-2.5">
            <button onClick={() => setConfirmDelete(null)} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">Cancel</button>
            <button
              onClick={() => {
                run(() => adminApi.deleteAgency(confirmDelete.id));
                setConfirmDelete(null);
              }}
              className="rounded-lg bg-red-600 hover:bg-red-700 px-4 py-2 text-sm font-bold text-white shadow-xs active:scale-95 transition-all"
            >
              Delete
            </button>
          </div>
        </Modal>
      )}

      {editingCommercial && (
        <ManageCommercialModal
          agency={editingCommercial}
          onClose={() => setEditingCommercial(null)}
          onError={onError}
        />
      )}
    </div>
  );
}

function PendingTab({ onError }: { onError: (m: string | null) => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['applications', 'REVIEW'], queryFn: () => adminApi.listApplications('REVIEW') });
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['applications'] });
    queryClient.invalidateQueries({ queryKey: ['agencies'] });
    queryClient.invalidateQueries({ queryKey: ['admin-summary'] });
  };
  const run = (fn: () => Promise<unknown>) => {
    onError(null);
    fn().then(invalidate).catch((e) => onError(extractError(e)));
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200/50 bg-white dark:border-slate-800/40 dark:bg-slate-900/30 shadow-xs">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-xs uppercase tracking-wider text-slate-405 dark:text-slate-500">
            <th className="px-4 py-3">Agency</th>
            <th className="px-4 py-3">GSTIN</th>
            <th className="px-4 py-3">Submitted</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/40">
          {isLoading && <SkeletonRows rows={5} cols={4} />}
          {data?.items.map((app) => (
            <tr key={app.id} className="border-b border-slate-100 dark:border-slate-800/20 hover:bg-slate-50/50 dark:hover:bg-slate-900/10 transition-colors">
              <td className="px-4 py-3 font-semibold text-slate-800 dark:text-slate-200">
                <div className="flex items-center gap-2">
                  <span>{app.legalName ?? '—'}</span>
                  {app.isIndependent && (
                    <span className="rounded-lg bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 text-[9px] font-extrabold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                      Independent
                    </span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400">
                {app.isIndependent ? <span className="text-slate-400 dark:text-slate-500 font-sans italic">N/A (Aadhaar Only)</span> : (app.gstin ?? '—')}
              </td>
              <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{app.submittedAt ? new Date(app.submittedAt).toLocaleDateString() : '—'}</td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-1.5">
                  <Link to={`/admin/applications/${app.id}`} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors">Open</Link>
                  <button onClick={() => run(() => adminApi.approve(app.id))} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-2.5 py-1 text-xs font-semibold text-green-600 dark:text-green-400 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors">Approve</button>
                  <button onClick={() => { setRejectId(app.id); setReason(''); }} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-2.5 py-1 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors">Reject</button>
                </div>
              </td>
            </tr>
          ))}
          {data?.items.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400 dark:text-slate-500">No pending registrations.</td></tr>}
        </tbody>
      </table>

      {rejectId && (
        <Modal title="Reject registration" onClose={() => setRejectId(null)}>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for rejection (required)"
            rows={3}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
          />
          <div className="mt-5 flex justify-end gap-2.5">
            <button onClick={() => setRejectId(null)} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">Cancel</button>
            <button
              disabled={reason.trim().length < 3}
              onClick={() => {
                run(() => adminApi.reject(rejectId, reason.trim()));
                setRejectId(null);
              }}
              className="rounded-lg bg-red-600 hover:bg-red-700 px-4 py-2 text-sm font-bold text-white shadow-xs active:scale-95 transition-all disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

const EMPTY: CreateAgencyInput = { legalName: '', gstin: '', pan: '', contactEmail: '', contactPhone: '', tier: 'A', isIndependent: false };

function CreateAgencyForm({ onClose, onError }: { onClose: () => void; onError: (m: string | null) => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateAgencyInput>(EMPTY);
  const [isIndependent, setIsIndependent] = useState(false);
  const [registrationProof, setRegistrationProof] = useState<File | null>(null);
  const [addressProof, setAddressProof] = useState<File | null>(null);
  const { data: tiers } = useQuery({ queryKey: ['tiers'], queryFn: adminApi.listTiers });

  const mutation = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('legalName', form.legalName);
      if (!isIndependent && form.gstin) {
        fd.append('gstin', form.gstin);
      }
      fd.append('pan', form.pan);
      fd.append('contactEmail', form.contactEmail);
      fd.append('contactPhone', form.contactPhone);
      fd.append('tier', form.tier);
      fd.append('isIndependent', String(isIndependent));
      if (registrationProof) {
        fd.append('registrationProof', registrationProof);
      }
      if (addressProof) {
        fd.append('addressProof', addressProof);
      }
      return adminApi.createAgency(fd);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agencies'] });
      queryClient.invalidateQueries({ queryKey: ['admin-summary'] });
      onClose();
    },
    onError: (e) => onError(extractError(e)),
  });

  const fields: { key: Exclude<keyof CreateAgencyInput, 'tier' | 'isIndependent'>; label: string; placeholder?: string }[] = [
    { key: 'legalName', label: 'Legal name' },
    ...(!isIndependent ? [{ key: 'gstin' as const, label: 'GSTIN', placeholder: '22AAAAA0000A1Z5' }] : []),
    { key: 'pan', label: 'PAN', placeholder: 'AAAAA0000A' },
    { key: 'contactEmail', label: 'Contact email' },
    { key: 'contactPhone', label: 'Contact phone', placeholder: '10-digit mobile' },
  ];

  function submit(e: FormEvent) {
    e.preventDefault();
    onError(null);
    mutation.mutate();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="col-span-full flex items-center gap-2.5 mb-2.5 text-sm font-semibold text-slate-700 dark:text-slate-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={isIndependent}
            onChange={(e) => setIsIndependent(e.target.checked)}
            className="rounded border-slate-300 dark:border-slate-800 text-blue-600 focus:ring-blue-500 h-4 w-4 bg-white dark:bg-slate-950"
          />
          <span>Register as an Independent Agent (Aadhaar verification only, no GST required)</span>
        </label>

        {fields.map((f) => (
          <label key={f.key} className="block text-sm space-y-1.5">
            <span className="font-semibold text-slate-700 dark:text-slate-300">{f.label}</span>
            <input
              value={form[f.key] ?? ''}
              placeholder={f.placeholder}
              onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              required
              className="w-full rounded-lg border border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
            />
          </label>
        ))}
        <label className="block text-sm space-y-1.5">
          <span className="font-semibold text-slate-700 dark:text-slate-300">Commercial Tier</span>
          <select
            value={form.tier}
            onChange={(e) => setForm({ ...form, tier: e.target.value })}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
            required
          >
            {tiers && Object.keys(tiers).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
            {!tiers && <option value="A">A</option>}
          </select>
        </label>
        <label className="block text-sm space-y-1.5">
          <span className="font-semibold text-slate-700 dark:text-slate-300">GST Registration Proof</span>
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            onChange={(e) => setRegistrationProof(e.target.files?.[0] || null)}
            className="w-full text-xs text-slate-500 dark:text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-slate-100 dark:file:bg-slate-800 file:text-slate-700 dark:file:text-slate-300 hover:file:bg-slate-200 dark:hover:file:bg-slate-700 transition-all cursor-pointer"
          />
        </label>
        <label className="block text-sm space-y-1.5">
          <span className="font-semibold text-slate-700 dark:text-slate-300">Address Proof</span>
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            onChange={(e) => setAddressProof(e.target.files?.[0] || null)}
            className="w-full text-xs text-slate-500 dark:text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-slate-100 dark:file:bg-slate-800 file:text-slate-700 dark:file:text-slate-300 hover:file:bg-slate-200 dark:hover:file:bg-slate-700 transition-all cursor-pointer"
          />
        </label>
      </div>
      <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800/40">
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-750 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">Cancel</button>
        <button type="submit" disabled={mutation.isPending} className="rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-bold text-white shadow-xs active:scale-95 transition-all disabled:opacity-50">
          {mutation.isPending ? 'Creating…' : 'Create agency'}
        </button>
      </div>
    </form>
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

function ManageCommercialModal({
  agency,
  onClose,
  onError,
}: {
  agency: Agency;
  onClose: () => void;
  onError: (m: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const { data: tiers } = useQuery({ queryKey: ['tiers'], queryFn: adminApi.listTiers });

  const { data: detail, isLoading } = useQuery({
    queryKey: ['agency', agency.id],
    queryFn: () => adminApi.getAgencyById(agency.id),
  });

  const [selectedTier, setSelectedTier] = useState('A');

  useEffect(() => {
    if (detail?.commercialConfigurations?.[0]) {
      setSelectedTier(detail.commercialConfigurations[0].tier);
    }
  }, [detail]);

  const mutation = useMutation({
    mutationFn: () => adminApi.updateAgencyCommercialConfig(agency.id, selectedTier),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agencies'] });
      onClose();
    },
    onError: (e) => onError(extractError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    onError(null);
    mutation.mutate();
  }

  const currentTier = detail?.commercialConfigurations?.[0];

  return (
    <Modal title="Manage Agency Commercials" onClose={onClose}>
      {isLoading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400 py-4 text-center">Loading configurations...</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Agency</p>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-0.5">{agency.legalName}</p>
          </div>

          {currentTier && (
            <div className="rounded-xl bg-slate-50/50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800/65 p-3.5 text-xs text-slate-600 dark:text-slate-400 space-y-2">
              <p className="font-bold text-slate-750 dark:text-slate-200 text-sm mb-2 border-b border-slate-200/60 dark:border-slate-800/60 pb-1">Current Configuration</p>
              <p className="flex justify-between"><span>Tier:</span> <span className="font-semibold text-slate-800 dark:text-white">{currentTier.tier}</span></p>
              <p className="flex justify-between"><span>Payment Mode:</span> <span className="font-semibold text-slate-800 dark:text-white">{currentTier.paymentMode}</span></p>
              <p className="flex justify-between"><span>Credit Limit:</span> <span className="font-semibold text-slate-800 dark:text-white">₹{Number(currentTier.creditLimit).toLocaleString()}</span></p>
              <p className="flex justify-between"><span>Payment Terms:</span> <span className="font-semibold text-slate-800 dark:text-white">{formatPaymentTerms(currentTier.paymentTerms)}</span></p>
              <p className="flex justify-between"><span>Markup:</span> <span className="font-semibold text-slate-800 dark:text-white">{currentTier.markupPct}%</span></p>
            </div>
          )}

          <label className="block text-sm space-y-1.5">
            <span className="font-semibold text-slate-700 dark:text-slate-350">Select New Tier</span>
            <select
              value={selectedTier}
              onChange={(e) => setSelectedTier(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-blue-500 transition-all"
              required
            >
              {tiers && Object.keys(tiers).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
              {!tiers && <option value="A">A</option>}
            </select>
          </label>

          <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800/40 mt-4">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-750 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-bold text-white shadow-xs active:scale-95 transition-all disabled:opacity-50">
              {mutation.isPending ? 'Updating…' : 'Update Commercials'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
