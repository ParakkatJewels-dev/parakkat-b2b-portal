import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '../lib/router';
import { SkeletonTable } from '../components/ui/Skeleton';
import { Badge, PageHeader, SearchInput, Stat, Toolbar, type Tone } from '../components/ui/kit';
import { Icons } from '../components/layout/icons';
import * as adminApi from '../api/admin.api';
import type { ApplicationListItem } from '../types/admin';
import type { LifecycleState } from '../types/onboarding';

type QueueState = LifecycleState | 'ALL';

const STATES: { key: QueueState; label: string }[] = [
  { key: 'REVIEW', label: 'Manual Review' },
  { key: 'VERIFICATION', label: 'Verification' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'COMMERCIAL_CONFIGURATION', label: 'Commercial' },
  { key: 'ACTIVE', label: 'Active' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'SUSPENDED', label: 'Suspended' },
  { key: 'ALL', label: 'All' },
];

const STATE_COPY: Record<QueueState, { label: string; tone: Tone; next: string }> = {
  ALL: { label: 'All', tone: 'slate', next: 'Inspect' },
  DRAFT: { label: 'Draft', tone: 'slate', next: 'Awaiting submit' },
  VERIFICATION: { label: 'Verification', tone: 'sky', next: 'Check proofs' },
  REVIEW: { label: 'Review', tone: 'amber', next: 'Decide' },
  APPROVED: { label: 'Approved', tone: 'green', next: 'Set terms' },
  COMMERCIAL_CONFIGURATION: { label: 'Commercial', tone: 'violet', next: 'Agreement' },
  ACTIVE: { label: 'Active', tone: 'green', next: 'Monitor' },
  REJECTED: { label: 'Rejected', tone: 'red', next: 'Closed' },
  SUSPENDED: { label: 'Suspended', tone: 'red', next: 'Review access' },
};

function stateMeta(state: QueueState) {
  return STATE_COPY[state] ?? STATE_COPY.ALL;
}

function dateLabel(value: string | null) {
  if (!value) return 'Not submitted';
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(
    new Date(value),
  );
}

function ageLabel(value: string | null) {
  if (!value) return 'Draft';
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000));
  if (days === 0) return 'Today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

function countByState(items: ApplicationListItem[], state: QueueState) {
  if (state === 'ALL') return items.length;
  return items.filter((item) => item.lifecycleState === state).length;
}

export function ApplicationsQueue() {
  const [state, setState] = useState<QueueState>('REVIEW');
  const [query, setQuery] = useState('');

  const selectedState = state === 'ALL' ? undefined : state;
  const { data, isLoading, isError } = useQuery({
    queryKey: ['applications', state, 100],
    queryFn: () => adminApi.listApplications(selectedState, 1, 100),
  });
  const { data: summaryData } = useQuery({
    queryKey: ['applications', 'summary', 100],
    queryFn: () => adminApi.listApplications(undefined, 1, 100),
    staleTime: 60_000,
  });

  const summaryItems = summaryData?.items ?? data?.items ?? [];
  const items = data?.items ?? [];
  const total = state === 'ALL' ? (summaryData?.total ?? data?.total ?? 0) : (data?.total ?? 0);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((app) =>
      [app.legalName, app.gstin, app.lifecycleState]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [items, query]);

  const submitted = summaryItems.filter((app) => app.submittedAt).length;
  const pendingReview = countByState(summaryItems, 'REVIEW');
  const inVerification = countByState(summaryItems, 'VERIFICATION');
  const independent = summaryItems.filter((app) => app.isIndependent).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="eKYC & Documents"
        subtitle="Review onboarding proofs, identity checks and activation readiness."
        actions={
          <Link
            to="/admin/agencies?action=create"
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Icons.agencies className="h-4 w-4" />
            Create agency
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Manual review" value={pendingReview} tone="amber" hint="Applications needing a decision" />
        <Stat label="Verification" value={inVerification} tone="sky" hint="KYB checks still in progress" />
        <Stat label="Submitted" value={submitted} tone="blue" hint="Received from onboarding" />
        <Stat label="Independent agents" value={independent} tone="violet" hint="Aadhaar-led registration path" />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3">
          <Toolbar>
            <SearchInput value={query} onChange={setQuery} placeholder="Search name, GSTIN or state..." />
            <div className="flex flex-1 flex-wrap justify-start gap-1 md:justify-end">
              {STATES.map((s) => {
                const active = state === s.key;
                const meta = stateMeta(s.key);
                const count = countByState(summaryItems, s.key);
                return (
                  <button
                    key={s.key}
                    onClick={() => setState(s.key)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? 'border-blue-200 bg-blue-50 text-blue-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <span>{s.label}</span>
                    <span className={`rounded-full px-1.5 text-[11px] ${active ? 'bg-blue-100' : 'bg-slate-100'}`}>
                      {s.key === 'ALL' ? (summaryData?.total ?? count) : count}
                    </span>
                    <span className="sr-only">{meta.label}</span>
                  </button>
                );
              })}
            </div>
          </Toolbar>
        </div>

        <div className="px-4 py-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">{stateMeta(state).label} queue</h2>
              <p className="text-xs text-slate-500">
                {filteredItems.length} visible of {total} application{total === 1 ? '' : 's'}
              </p>
            </div>
            <Badge tone={stateMeta(state).tone}>{stateMeta(state).next}</Badge>
          </div>

          {isLoading && <SkeletonTable rows={6} cols={6} />}
          {isError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              Failed to load applications.
            </div>
          )}

          {data && !isLoading && (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[780px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3 font-medium">Applicant</th>
                    <th className="px-4 py-3 font-medium">Verification path</th>
                    <th className="px-4 py-3 font-medium">GSTIN</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Submitted</th>
                    <th className="px-4 py-3 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((app) => (
                    <ApplicationRow key={app.id} app={app} />
                  ))}
                  {filteredItems.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                        No applications match this view.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ApplicationRow({ app }: { app: ApplicationListItem }) {
  const meta = stateMeta(app.lifecycleState);
  const path = app.isIndependent ? 'Aadhaar + PAN' : 'GST + PAN + Aadhaar';

  return (
    <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
      <td className="px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
            <Icons.shield className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium text-slate-900">{app.legalName ?? 'Unnamed application'}</div>
            <div className="mt-0.5 text-xs text-slate-400">Opened {ageLabel(app.createdAt)}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={app.isIndependent ? 'violet' : 'blue'}>{app.isIndependent ? 'Independent' : 'Agency'}</Badge>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{path}</span>
        </div>
      </td>
      <td className="px-4 py-3 font-mono text-xs text-slate-500">
        {app.isIndependent ? <span className="font-sans italic text-slate-400">Not required</span> : (app.gstin ?? '—')}
      </td>
      <td className="px-4 py-3">
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </td>
      <td className="px-4 py-3">
        <div className="text-slate-700">{dateLabel(app.submittedAt)}</div>
        <div className="text-xs text-slate-400">{ageLabel(app.submittedAt)}</div>
      </td>
      <td className="px-4 py-3 text-right">
        <Link
          to={`/admin/applications/${app.id}`}
          className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Open review
        </Link>
      </td>
    </tr>
  );
}
