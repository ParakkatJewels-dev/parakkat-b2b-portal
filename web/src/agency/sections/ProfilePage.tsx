import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '../../components/layout/AppShell';
import { Badge, Button, Input, PageHeader, Tabs } from '../../components/ui/kit';
import { formatPaymentTerms } from '../../shared/format';
import * as agencyApi from '../../api/agency.api';

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN') : '—');
const DOC_TONE: Record<string, 'green' | 'amber' | 'red' | 'slate'> = { VERIFIED: 'green', APPROVED: 'green', UPLOADED: 'amber', PENDING: 'amber', REJECTED: 'red' };

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-2 text-sm last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-900">{value ?? '—'}</span>
    </div>
  );
}

/**
 * B2B resale layer — the agency's default markup over its buy price. Agents see
 * it prefilled at booking time and may override per booking.
 */
function ResaleMarkupCard({ current }: { current: string }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(current);
  const [saved, setSaved] = useState(false);
  const saveM = useMutation({
    mutationFn: (pct: number) => agencyApi.updateResaleMarkup(pct),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      qc.invalidateQueries({ queryKey: ['my-agency'] });
      qc.invalidateQueries({ queryKey: ['resale-markup'] });
    },
  });
  const parsed = Number(value);
  const valid = value.trim() !== '' && Number.isFinite(parsed) && parsed >= 0 && parsed <= 500;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-2 text-sm font-semibold text-slate-700">Your selling markup</div>
      <p className="mb-3 text-xs text-slate-500 leading-relaxed">
        Added on top of the price you pay to make the customer price shown on quotes and invoices.
        The difference is your profit. Agents can adjust it per booking.
      </p>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={0}
          max={500}
          step="0.5"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-24 text-right"
        />
        <span className="text-sm font-semibold text-slate-500">%</span>
        <Button variant="primary" disabled={!valid || saveM.isPending} onClick={() => saveM.mutate(parsed)}>
          {saveM.isPending ? 'Saving…' : 'Save'}
        </Button>
        {saved && <span className="text-xs font-semibold text-emerald-600">Saved ✓</span>}
      </div>
      {!valid && value.trim() !== '' && <p className="mt-2 text-xs text-red-500">Markup must be between 0 and 500.</p>}
      {saveM.isError && <p className="mt-2 text-xs text-red-500">Could not save — please try again.</p>}
    </div>
  );
}

export function ProfilePage() {
  const [tab, setTab] = useState('company');
  const { data: a, isLoading } = useQuery({ queryKey: ['my-agency'], queryFn: agencyApi.getMyAgency });

  return (
    <AppShell>
      <PageHeader title="Profile & Company" subtitle="Your company information and verification documents." />

      <Tabs
        tabs={[
          { key: 'company', label: 'Company Information' },
          { key: 'documents', label: 'Documents', count: a?.documents.length ?? 0 },
        ]}
        active={tab}
        onChange={setTab}
      />

      {isLoading && <div className="h-40 animate-pulse rounded-xl border border-slate-200 bg-white" />}

      {a && tab === 'company' && (
        <div className="grid max-w-3xl gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-2 text-sm font-semibold text-slate-700">Company details</div>
            <Row label="Legal name" value={a.legalName} />
            <Row label="Business type" value={a.isIndependent ? 'Independent Agent' : 'Standard Agency'} />
            <Row label="Contact email" value={a.contactEmail} />
            <Row label="Contact phone" value={a.contactPhone} />
            <Row label="Status" value={<Badge tone={a.status === 'ACTIVE' ? 'green' : 'red'}>{a.status}</Badge>} />
            <Row label="Member since" value={fmtDate(a.createdAt)} />
          </div>
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="mb-2 text-sm font-semibold text-slate-700">Tax details</div>
              {!a.isIndependent && <Row label="GSTIN" value={<span className="font-mono text-xs">{a.gstin}</span>} />}
              <Row label="PAN" value={<span className="font-mono text-xs">{a.pan}</span>} />
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="mb-2 text-sm font-semibold text-slate-700">Commercial terms</div>
              {a.commercial ? (
                <>
                  <Row label="Tier" value={a.commercial.tier} />
                  <Row label="Payment mode" value={a.commercial.paymentMode} />
                  <Row label="Credit limit" value={`₹${Number(a.commercial.creditLimit).toLocaleString('en-IN')}`} />
                  <Row label="Payment terms" value={formatPaymentTerms(a.commercial.paymentTerms)} />
                  <Row label="Markup" value={`${a.commercial.markupPct}%`} />
                </>
              ) : (
                <p className="text-sm text-slate-400">No commercial configuration.</p>
              )}
            </div>
            <ResaleMarkupCard current={a.defaultResaleMarkupPct} />
          </div>
          <p className="text-xs text-slate-400 lg:col-span-2">Company and tax details are set during onboarding and managed by the Parakkat admin team. Contact support to request a change.</p>
        </div>
      )}

      {a && tab === 'documents' && (
        <div className="space-y-2">
          {a.documents.map((d) => (
            <div key={d.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3">
              <div>
                <div className="font-medium text-slate-800">{d.fileName ?? d.docType}</div>
                <div className="text-xs text-slate-400">{d.docType} · uploaded {fmtDate(d.uploadedAt)}</div>
              </div>
              <Badge tone={DOC_TONE[d.status] ?? 'slate'}>{d.status}</Badge>
            </div>
          ))}
          {a.documents.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">No documents on file.</div>
          )}
        </div>
      )}
    </AppShell>
  );
}
