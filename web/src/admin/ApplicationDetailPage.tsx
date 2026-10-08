import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '../lib/router';
import { AppShell } from '../components/layout/AppShell';
import { Skeleton, SkeletonForm } from '../components/ui/Skeleton';
import * as adminApi from '../api/admin.api';
import type { ApplicationDetail } from '../types/admin';
import { formatPaymentTerms } from '../shared/format';

function StatusPill({ status }: { status: string }) {
  const color =
    status === 'PASSED' || status === 'ACTIVE'
      ? 'bg-green-100 text-green-700'
      : status === 'FAILED' || status === 'REJECTED'
        ? 'bg-red-100 text-red-700'
        : status === 'MANUAL_REVIEW'
          ? 'bg-amber-100 text-amber-700'
          : 'bg-slate-100 text-slate-600';
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${color}`}>{status}</span>;
}

export function ApplicationDetailPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [resubReason, setResubReason] = useState('');
  const [tier, setTier] = useState('A');
  const [signingUrl, setSigningUrl] = useState<string | null>(null);

  const { data: app, isLoading } = useQuery({
    queryKey: ['application', id],
    queryFn: () => adminApi.getApplication(id),
  });

  const { data: tiers } = useQuery({ queryKey: ['tiers'], queryFn: adminApi.listTiers });

  function runAction(fn: () => Promise<unknown>) {
    setError(null);
    return fn()
      .then(() => {
        // Refresh this detail plus everything an action here can change: the
        // applications queue, the agencies list, and the admin summary/badges.
        queryClient.invalidateQueries({ queryKey: ['application', id] });
        queryClient.invalidateQueries({ queryKey: ['applications'] });
        queryClient.invalidateQueries({ queryKey: ['agencies'] });
        queryClient.invalidateQueries({ queryKey: ['admin-summary'] });
      })
      .catch((err) =>
        setError(
          (err as { response?: { data?: { message?: string } } }).response?.data?.message ??
            'Action failed',
        ),
      );
  }

  const mutation = useMutation({ mutationFn: (fn: () => Promise<unknown>) => runAction(fn) });

  if (isLoading || !app) {
    return (
      <AppShell>
        <div className="space-y-3">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-7 w-64" />
          <SkeletonForm sections={2} fields={4} />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Link to="/" className="text-sm text-slate-500 underline">
        ← Back to queue
      </Link>
      <div className="mt-2 flex items-center gap-3">
        <h1 className="text-lg font-semibold text-slate-900">{app.legalName ?? 'Application'}</h1>
        <StatusPill status={app.lifecycleState} />
      </div>

      {error && <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Section title="Business">
          <Row label="Business type" value={app.isIndependent ? 'Independent Agent' : 'Standard Agency'} />
          <Row label="Legal name" value={app.legalName} />
          {!app.isIndependent && <Row label="GSTIN" value={app.gstin} />}
          <Row label="PAN (masked)" value={app.pan} />
          <Row label="Representative" value={app.repName} />
          <Row label="Rep email" value={app.repEmail} />
          <Row label="Bank account (masked)" value={app.bankAccount} />
        </Section>

        <Section title="Verification checks">
          <ul className="space-y-1">
            {app.verifications.map((v) => (
              <li key={v.id} className="flex items-center justify-between text-sm">
                <span>{v.checkType}</span>
                <StatusPill status={v.status} />
              </li>
            ))}
            {app.verifications.length === 0 && (
              <li className="text-sm text-slate-400">No checks yet.</li>
            )}
          </ul>
        </Section>

        <Section title="Documents">
          <ul className="space-y-1">
            {app.documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between text-sm">
                <span>
                  {d.fileName ?? d.docType}{' '}
                  <span className="text-slate-400">({d.docType})</span>
                </span>
                <StatusPill status={d.status} />
              </li>
            ))}
            {app.documents.length === 0 && (
              <li className="text-sm text-slate-400">No documents.</li>
            )}
          </ul>
        </Section>

        {app.agency?.commercialConfigurations[0] && (
          <Section title="Commercial terms">
            <Row label="Tier" value={app.agency.commercialConfigurations[0].tier} />
            <Row label="Payment mode" value={app.agency.commercialConfigurations[0].paymentMode} />
            <Row label="Credit limit" value={`₹${app.agency.commercialConfigurations[0].creditLimit}`} />
            <Row label="Payment terms" value={formatPaymentTerms(app.agency.commercialConfigurations[0].paymentTerms)} />
            <Row label="Markup %" value={app.agency.commercialConfigurations[0].markupPct} />
          </Section>
        )}
      </div>

      <div className="mt-8 space-y-6">
        <ActionsForState
          app={app}
          tiers={tiers}
          tier={tier}
          setTier={setTier}
          rejectReason={rejectReason}
          setRejectReason={setRejectReason}
          resubReason={resubReason}
          setResubReason={setResubReason}
          signingUrl={signingUrl}
          setSigningUrl={setSigningUrl}
          pending={mutation.isPending}
          run={(fn) => mutation.mutate(fn)}
        />
      </div>
    </AppShell>
  );
}

function ActionsForState(props: {
  app: ApplicationDetail;
  tiers: Record<string, unknown> | undefined;
  tier: string;
  setTier: (t: string) => void;
  rejectReason: string;
  setRejectReason: (s: string) => void;
  resubReason: string;
  setResubReason: (s: string) => void;
  signingUrl: string | null;
  setSigningUrl: (u: string | null) => void;
  pending: boolean;
  run: (fn: () => Promise<unknown>) => void;
}) {
  const { app, tiers, tier, setTier, rejectReason, setRejectReason, resubReason, setResubReason, signingUrl, setSigningUrl, pending, run } = props;
  const state = app.lifecycleState;

  return (
    <>
      {state === 'REVIEW' && (
        <div className="rounded-lg border border-slate-200 p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Decision</h3>
          <div className="flex flex-wrap items-end gap-3">
            <button
              disabled={pending}
              onClick={() => run(() => adminApi.approve(app.id))}
              className="rounded bg-green-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Approve
            </button>
            <div>
              <input
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Reason for rejection"
                className="rounded border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                disabled={pending || rejectReason.length < 3}
                onClick={() => run(() => adminApi.reject(app.id, rejectReason))}
                className="ml-2 rounded bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
          <div className="mt-4 flex items-end gap-2">
            <input
              value={resubReason}
              onChange={(e) => setResubReason(e.target.value)}
              placeholder="Re-submission reason"
              className="rounded border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              disabled={pending || resubReason.length < 3}
              onClick={() =>
                run(() => adminApi.requestResubmission(app.id, { reason: resubReason }))
              }
              className="rounded bg-slate-200 px-4 py-2 text-sm font-medium text-slate-800 disabled:opacity-50"
            >
              Request re-submission
            </button>
          </div>
        </div>
      )}

      {(state === 'APPROVED' || state === 'COMMERCIAL_CONFIGURATION') && (
        <div className="rounded-lg border border-slate-200 p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Commercial configuration</h3>
          <div className="flex items-end gap-2">
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value)}
              className="rounded border border-slate-300 px-3 py-2 text-sm"
            >
              {Object.keys(tiers ?? { A: 1 }).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button
              disabled={pending}
              onClick={() => run(() => adminApi.setCommercialConfig(app.id, tier))}
              className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Save terms
            </button>
          </div>
        </div>
      )}

      {state === 'COMMERCIAL_CONFIGURATION' && (
        <div className="rounded-lg border border-slate-200 p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Agreement &amp; activation</h3>
          <div className="flex flex-wrap items-center gap-3">
            <button
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const res = await adminApi.sendAgreement(app.id);
                  setSigningUrl(res.signingUrl);
                })
              }
              className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Generate &amp; send agreement
            </button>
            <button
              disabled={pending}
              onClick={() => run(() => adminApi.activate(app.id))}
              className="rounded bg-green-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Activate (after signing)
            </button>
          </div>
          {signingUrl && (
            <p className="mt-3 text-xs text-slate-500">
              Signing link (dev): <span className="font-mono">{signingUrl}</span>
            </p>
          )}
        </div>
      )}

      {state === 'ACTIVE' && app.agency && (
        <div className="rounded-lg border border-slate-200 p-4">
          <button
            disabled={pending}
            onClick={() => run(() => adminApi.suspendAgency(app.agency!.id))}
            className="rounded bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Suspend agency
          </button>
        </div>
      )}

      {state === 'SUSPENDED' && app.agency && (
        <div className="rounded-lg border border-slate-200 p-4">
          <button
            disabled={pending}
            onClick={() => run(() => adminApi.reactivateAgency(app.agency!.id))}
            className="rounded bg-green-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Reactivate agency
          </button>
        </div>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between py-1 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-900">{value ?? '—'}</span>
    </div>
  );
}
