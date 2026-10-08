import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '../../lib/router';
import { AppShell } from '../../components/layout/AppShell';
import { Badge, Button, DataTable, Field, Input, Modal, PageHeader, SearchInput, Select, Stat, Tabs, Toolbar, inr, type Column, type Tone } from '../../components/ui/kit';
import { SkeletonRows } from '../../components/ui/Skeleton';
import * as adminApi from '../../api/admin.api';
import type { AdminInvoice, AdminRefund, CreditAgencyBalance, SettlementMethod } from '../../api/admin.api';
import * as dashboardApi from '../../api/dashboard.api';
import type { AdminPayment } from '../../api/dashboard.api';
import * as documentsApi from '../../api/documents.api';

const PAY_TONE: Record<AdminPayment['status'], Tone> = { SUCCEEDED: 'green', PENDING: 'amber', FAILED: 'red', REFUNDED: 'violet', CHARGEBACK: 'red' };
const INV_TONE: Record<AdminInvoice['status'], Tone> = { PAID: 'green', ISSUED: 'amber', PARTIALLY_PAID: 'blue', VOID: 'slate', REFUNDED: 'violet' };
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN') : '—');

function LoadableTable<T>({ loading, columns, rows, rowKey, empty }: { loading: boolean; columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; empty: string }) {
  if (loading) {
    return (
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm"><tbody><SkeletonRows rows={6} cols={columns.length} /></tbody></table>
      </div>
    );
  }
  return <DataTable columns={columns} rows={rows} rowKey={rowKey} empty={empty} />;
}

export function AdminFinancePage() {
  const [tab, setTab] = useState('settlements');
  const [dlError, setDlError] = useState<string | null>(null);
  const downloadInvoice = (i: AdminInvoice) => {
    setDlError(null);
    documentsApi.downloadInvoicePdf(i.id, i.number).catch((e) =>
      setDlError((e as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'Could not download invoice PDF'),
    );
  };

  const paymentsQ = useQuery({ queryKey: ['admin-payments'], queryFn: dashboardApi.listPayments });
  const creditQ = useQuery({ queryKey: ['settlement-agencies'], queryFn: () => adminApi.listSettlementAgencies() });
  const invoicesQ = useQuery({ queryKey: ['admin-invoices'], queryFn: adminApi.listAllInvoices });
  const refundsQ = useQuery({ queryKey: ['admin-refunds'], queryFn: adminApi.listRefunds });

  const payments = paymentsQ.data?.items ?? [];
  const credit = creditQ.data ?? [];
  const invoices = invoicesQ.data ?? [];
  const refunds = refundsQ.data ?? [];

  const collected = payments.filter((p) => p.status === 'SUCCEEDED' && !p.chargedBack).reduce((s, p) => s + p.amount, 0);
  const pending = payments.filter((p) => p.status === 'PENDING').reduce((s, p) => s + p.amount, 0);
  const outstanding = credit.reduce((s, c) => s + c.outstanding, 0);

  const payCols: Column<AdminPayment>[] = [
    { header: 'Agency', render: (p) => p.agencyName },
    { header: 'Invoice', className: 'font-mono text-xs text-slate-600', render: (p) => p.invoiceNumber ?? '—' },
    { header: 'Amount', align: 'right', className: 'font-medium text-slate-800', render: (p) => inr(p.amount) },
    { header: 'Ref', className: 'font-mono text-xs text-slate-400', render: (p) => p.gatewayRef ?? '—' },
    { header: 'Date', render: (p) => fmtDate(p.createdAt) },
    { header: 'Status', render: (p) => (p.chargedBack ? <Badge tone="red">Charged back</Badge> : <Badge tone={PAY_TONE[p.status]}>{p.status}</Badge>) },
  ];

  const creditCols: Column<CreditAgencyBalance>[] = [
    {
      header: 'Agency',
      render: (c) => (
        <Link to={`/admin/agencies/${c.agencyId}`} className="block hover:underline">
          <div className="font-medium text-slate-800">{c.legalName}</div>
          {c.gstin && <div className="font-mono text-xs text-slate-400">{c.gstin}</div>}
        </Link>
      ),
    },
    { header: 'Limit', align: 'right', render: (c) => inr(c.creditLimit) },
    { header: 'Outstanding', align: 'right', className: 'font-medium text-red-600', render: (c) => inr(c.outstanding) },
    {
      header: 'Utilization',
      render: (c) => {
        const pct = c.creditLimit > 0 ? Math.min(100, Math.round((c.outstanding / c.creditLimit) * 100)) : 0;
        return (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full ${pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs text-slate-500">{pct}%</span>
          </div>
        );
      },
    },
    { header: 'Available', align: 'right', className: 'font-medium text-green-600', render: (c) => inr(c.available) },
    { header: 'Status', render: (c) => <Badge tone={c.status === 'ACTIVE' ? 'green' : 'red'}>{c.status}</Badge> },
  ];

  const invCols: Column<AdminInvoice>[] = [
    { header: 'Invoice', className: 'font-mono text-xs text-slate-600', render: (i) => i.number },
    { header: 'Agency', render: (i) => i.agencyName },
    { header: 'Amount', align: 'right', className: 'font-medium text-slate-800', render: (i) => inr(i.amount) },
    { header: 'Paid', align: 'right', render: (i) => inr(i.amountPaid) },
    { header: 'Mode', render: (i) => <Badge tone={i.paymentMode === 'CREDIT' ? 'blue' : 'slate'}>{i.paymentMode}</Badge> },
    { header: 'Due', render: (i) => <span className={i.overdue ? 'font-medium text-red-600' : 'text-slate-500'}>{fmtDate(i.dueDate)}</span> },
    { header: 'Status', render: (i) => <Badge tone={i.overdue ? 'red' : INV_TONE[i.status]}>{i.overdue ? 'Overdue' : i.status}</Badge> },
    { header: 'PDF', align: 'right', render: (i) => <Button variant="ghost" onClick={() => downloadInvoice(i)}>Download</Button> },
  ];

  const refundCols: Column<AdminRefund>[] = [
    { header: 'Type', render: (r) => <Badge tone={r.type === 'Chargeback' ? 'red' : 'violet'}>{r.type}</Badge> },
    { header: 'Agency', render: (r) => r.agencyName },
    { header: 'Invoice', className: 'font-mono text-xs text-slate-600', render: (r) => r.invoiceNumber ?? '—' },
    { header: 'Amount', align: 'right', className: 'font-medium text-slate-800', render: (r) => inr(r.amount) },
    { header: 'Ref', className: 'font-mono text-xs text-slate-400', render: (r) => r.gatewayRef ?? '—' },
    { header: 'Date', render: (r) => fmtDate(r.createdAt) },
  ];

  return (
    <AppShell>
      <PageHeader
        title="Finance"
        subtitle="Payments, credit, invoices and refunds across all agencies."
        actions={<Button variant="primary" onClick={() => setTab('settlements')}>+ Record Settlement</Button>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Collected" value={inr(collected)} tone="green" />
        <Stat label="Pending" value={inr(pending)} tone="amber" />
        <Stat label="Outstanding" value={inr(outstanding)} tone="red" />
        <Stat label="Refunds / chargebacks" value={refunds.length} tone="violet" />
      </div>

      <Tabs
        tabs={[
          { key: 'settlements', label: 'Settlements' },
          { key: 'payments', label: 'Payments', count: payments.length },
          { key: 'credit', label: 'Credit', count: credit.length },
          { key: 'invoices', label: 'Invoices', count: invoices.length },
          { key: 'refunds', label: 'Refunds', count: refunds.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'settlements' && <SettlementsTab />}
      {tab === 'payments' && <LoadableTable loading={paymentsQ.isLoading} columns={payCols} rows={payments} rowKey={(p) => p.id} empty="No payments yet." />}
      {tab === 'credit' && <LoadableTable loading={creditQ.isLoading} columns={creditCols} rows={credit} rowKey={(c) => c.agencyId} empty="No credit agencies." />}
      {tab === 'invoices' && (
        <>
          {dlError && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{dlError}</p>}
          <LoadableTable loading={invoicesQ.isLoading} columns={invCols} rows={invoices} rowKey={(i) => i.id} empty="No invoices yet." />
        </>
      )}
      {tab === 'refunds' && <LoadableTable loading={refundsQ.isLoading} columns={refundCols} rows={refunds} rowKey={(r) => r.id} empty="No refunds or chargebacks." />}
    </AppShell>
  );
}

const METHOD_LABELS: Record<SettlementMethod, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank transfer',
  CHEQUE: 'Cheque',
  UPI: 'UPI',
  OTHER: 'Other',
};

function extractError(err: unknown): string {
  return (err as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'Action failed';
}

function SettlementsTab() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<CreditAgencyBalance | null>(null);
  const [historyFor, setHistoryFor] = useState<CreditAgencyBalance | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: agencies = [], isLoading } = useQuery({
    queryKey: ['settlement-agencies'],
    queryFn: () => adminApi.listSettlementAgencies(),
  });

  const applyM = useMutation({
    mutationFn: (agencyId: string) => adminApi.applyAgencyAdvance(agencyId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settlement-agencies'] });
      qc.invalidateQueries({ queryKey: ['reconciliation'] });
    },
    onError: (e) => setError(extractError(e)),
  });

  const rows = useMemo(
    () => agencies.filter((a) => [a.legalName, a.gstin ?? ''].some((f) => f.toLowerCase().includes(q.toLowerCase()))),
    [agencies, q],
  );

  const columns: Column<CreditAgencyBalance>[] = [
    {
      header: 'Agency',
      render: (a) => (
        <div>
          <div className="font-medium text-slate-800">{a.legalName}</div>
          {a.gstin && <div className="font-mono text-xs text-slate-400">{a.gstin}</div>}
        </div>
      ),
    },
    { header: 'Credit limit', align: 'right', render: (a) => inr(a.creditLimit) },
    { header: 'Outstanding', align: 'right', className: 'font-medium text-red-600', render: (a) => inr(a.outstanding) },
    { header: 'Available', align: 'right', className: 'font-medium text-green-600', render: (a) => inr(a.available) },
    {
      header: 'Advance',
      align: 'right',
      render: (a) => (a.advance > 0 ? <span className="font-medium text-blue-600">{inr(a.advance)}</span> : <span className="text-slate-300">—</span>),
    },
    {
      header: 'Actions',
      align: 'right',
      render: (a) => (
        <div className="flex justify-end gap-1.5">
          <Button variant="primary" onClick={() => { setError(null); setSelected(a); }}>Record payment</Button>
          {a.advance > 0 && a.outstanding > 0 && (
            <Button variant="secondary" disabled={applyM.isPending} onClick={() => { setError(null); applyM.mutate(a.agencyId); }}>Apply advance</Button>
          )}
          <Button variant="ghost" onClick={() => setHistoryFor(a)}>History</Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="Search agency by name or GSTIN…" />
      </Toolbar>

      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {isLoading ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm"><tbody><SkeletonRows rows={5} cols={6} /></tbody></table>
        </div>
      ) : (
        <DataTable columns={columns} rows={rows} rowKey={(a) => a.agencyId} empty="No credit agencies found." />
      )}

      {selected && <SettlementModal agency={selected} onClose={() => setSelected(null)} />}
      {historyFor && <HistoryModal agency={historyFor} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}

function HistoryModal({ agency, onClose }: { agency: CreditAgencyBalance; onClose: () => void }) {
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['settlement-history', agency.agencyId],
    queryFn: () => adminApi.getSettlementHistory(agency.agencyId),
  });

  return (
    <Modal title={`Settlement history · ${agency.legalName}`} onClose={onClose} wide footer={<Button variant="primary" onClick={onClose}>Close</Button>}>
      {isLoading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : history.length === 0 ? (
        <p className="text-sm text-slate-400">No offline settlements recorded yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {history.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="font-medium text-slate-800">{inr(h.amount)}</div>
                <div className="truncate text-xs text-slate-400">
                  {new Date(h.createdAt).toLocaleString()}
                  {h.reference ? ` · ${h.reference}` : ''}
                </div>
              </div>
              <div className="shrink-0 text-right">
                {h.unapplied ? (
                  <Badge tone="blue">Advance (unapplied)</Badge>
                ) : (
                  <span className="text-xs text-slate-500">{h.invoiceNumber ?? 'Applied'}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function SettlementModal({ agency, onClose }: { agency: CreditAgencyBalance; onClose: () => void }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState(agency.outstanding > 0 ? String(agency.outstanding) : '');
  const [method, setMethod] = useState<SettlementMethod>('CASH');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ applied: number; advanceRecorded: number; available: number; advance: number } | null>(null);

  const numericAmount = Number(amount);
  const invalid = !Number.isFinite(numericAmount) || numericAmount <= 0;
  const overpay = Number.isFinite(numericAmount) ? Math.max(0, Math.round((numericAmount - agency.outstanding) * 100) / 100) : 0;

  const save = useMutation({
    mutationFn: () =>
      adminApi.recordSettlement({
        agencyId: agency.agencyId,
        amount: Math.round(numericAmount * 100) / 100,
        method,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['settlement-agencies'] });
      qc.invalidateQueries({ queryKey: ['reconciliation'] });
      qc.invalidateQueries({ queryKey: ['admin-payments'] });
      setDone({ applied: r.applied, advanceRecorded: r.advanceRecorded, available: r.balance.available, advance: r.balance.advance });
    },
    onError: (e) => setError(extractError(e)),
  });

  if (done) {
    return (
      <Modal title="Settlement recorded" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
        <p className="text-sm text-slate-600">
          Recorded against <strong>{agency.legalName}</strong>: <strong>{inr(done.applied)}</strong> applied to invoices
          {done.advanceRecorded > 0 && <> and <strong>{inr(done.advanceRecorded)}</strong> parked as advance credit</>}.
        </p>
        <div className="mt-3 rounded-lg border border-green-100 bg-green-50 p-3 text-sm text-green-800">
          Available credit is now <strong>{inr(done.available)}</strong>
          {done.advance > 0 && <> · advance balance <strong>{inr(done.advance)}</strong></>}.
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={`Record payment · ${agency.legalName}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={save.isPending || invalid} onClick={() => { setError(null); save.mutate(); }}>
            {save.isPending ? 'Recording…' : 'Record payment'}
          </Button>
        </>
      }
    >
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mb-3 grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs uppercase tracking-wide text-slate-400">Outstanding</div>
          <div className="mt-0.5 text-lg font-semibold text-red-600">{inr(agency.outstanding)}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs uppercase tracking-wide text-slate-400">Available</div>
          <div className="mt-0.5 text-lg font-semibold text-green-600">{inr(agency.available)}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs uppercase tracking-wide text-slate-400">Advance</div>
          <div className="mt-0.5 text-lg font-semibold text-blue-600">{inr(agency.advance)}</div>
        </div>
      </div>

      <div className="space-y-3">
        <Field label="Amount received" hint="Amount above the outstanding balance is saved as advance credit.">
          <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        {overpay > 0 && (
          <p className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
            {inr(agency.outstanding)} clears the outstanding balance; the remaining <strong>{inr(overpay)}</strong> will be held as advance credit.
          </p>
        )}
        <Field label="Method">
          <Select
            value={method}
            onChange={(v) => setMethod(v as SettlementMethod)}
            options={(Object.keys(METHOD_LABELS) as SettlementMethod[]).map((m) => ({ value: m, label: METHOD_LABELS[m] }))}
          />
        </Field>
        <Field label="Reference (optional)" hint="Cheque no., UTR, receipt no., etc.">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. UTR-2287391" />
        </Field>
        <Field label="Note (optional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Internal note" />
        </Field>
        <p className="text-xs text-slate-400">
          The amount is applied to this agency&apos;s oldest unpaid credit invoices first, reducing outstanding and freeing up their credit.
        </p>
      </div>
    </Modal>
  );
}
