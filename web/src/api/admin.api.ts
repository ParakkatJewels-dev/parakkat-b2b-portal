import { httpClient } from './httpClient';
import type {
  Agency,
  AgencyDetail,
  ApplicationDetail,
  ApplicationListItem,
  AuditLogEntry,
  CreateAgencyInput,
  ReportSummary,
  TierPreset,
  UpdateAgencyInput,
} from '../types/admin';
import type { LifecycleState } from '../types/onboarding';

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listApplications(
  lifecycleState?: LifecycleState,
  page = 1,
  pageSize = 20,
): Promise<Paged<ApplicationListItem>> {
  const res = await httpClient.get('/applications', { params: { lifecycleState, page, pageSize } });
  return res.data;
}

export async function getApplication(id: string): Promise<ApplicationDetail> {
  const res = await httpClient.get(`/applications/${id}`);
  return res.data;
}

export async function approve(id: string): Promise<void> {
  await httpClient.post(`/applications/${id}/approve`);
}

export async function reject(id: string, reason: string): Promise<void> {
  await httpClient.post(`/applications/${id}/reject`, { reason });
}

export async function requestResubmission(
  id: string,
  payload: { checkTypes?: string[]; documentIds?: string[]; reason: string },
): Promise<void> {
  await httpClient.post(`/applications/${id}/request-resubmission`, payload);
}

export interface CommercialOverrides {
  paymentMode?: 'PREPAY' | 'CREDIT';
  creditLimit?: number;
  paymentTerms?: string;
  markupPct?: number;
}

export async function setCommercialConfig(
  id: string,
  tier: string,
  overrides?: CommercialOverrides,
): Promise<void> {
  await httpClient.post(`/applications/${id}/commercial-config`, { tier, overrides });
}

export async function sendAgreement(id: string): Promise<{ signingUrl: string }> {
  const res = await httpClient.post(`/applications/${id}/agreement/send`);
  return res.data;
}

export async function activate(id: string): Promise<void> {
  await httpClient.post(`/applications/${id}/activate`);
}

export async function suspendAgency(agencyId: string): Promise<void> {
  await httpClient.post(`/agencies/${agencyId}/suspend`);
}

export async function reactivateAgency(agencyId: string): Promise<void> {
  await httpClient.post(`/agencies/${agencyId}/reactivate`);
}

export async function listAgencies(): Promise<Paged<Agency>> {
  const res = await httpClient.get('/agencies', { params: { pageSize: 100 } });
  return res.data;
}

export async function createAgency(input: CreateAgencyInput | FormData): Promise<Agency> {
  const res = await httpClient.post('/agencies', input);
  return res.data;
}

export async function deleteAgency(id: string): Promise<void> {
  await httpClient.delete(`/agencies/${id}`);
}

export async function getAgencyById(id: string): Promise<Agency> {
  const res = await httpClient.get(`/agencies/${id}`);
  return res.data;
}

export async function getAgencyDetail(id: string): Promise<AgencyDetail> {
  const res = await httpClient.get(`/agencies/${id}/detail`);
  return res.data;
}

export async function updateAgency(id: string, input: UpdateAgencyInput): Promise<Agency> {
  const res = await httpClient.patch(`/agencies/${id}`, input);
  return res.data;
}

export async function updateAgencyCommercialConfig(agencyId: string, tier: string, markupPct?: number): Promise<void> {
  await httpClient.post(`/agencies/${agencyId}/commercial-config`, { tier, ...(markupPct != null ? { markupPct } : {}) });
}

export async function listTiers(): Promise<Record<string, TierPreset>> {
  const res = await httpClient.get('/commercial/tiers');
  return res.data.tiers;
}

export async function updateTiers(tiers: Record<string, TierPreset>): Promise<Record<string, TierPreset>> {
  const res = await httpClient.post('/commercial/tiers', { tiers });
  return res.data.tiers;
}

export interface AuditFilters {
  entityType?: string;
  event?: string;
  actorRole?: string;
  correlationId?: string;
  page?: number;
}

export async function getAuditLogs(filters: AuditFilters): Promise<Paged<AuditLogEntry>> {
  const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
  const res = await httpClient.get('/audit-logs', { params });
  return res.data;
}

export async function getReportSummary(from?: string, to?: string): Promise<ReportSummary> {
  const res = await httpClient.get('/reports/summary', { params: { from, to } });
  return res.data;
}

// --- Offline settlements (credit AR) -----------------------------------------
export interface CreditAgencyBalance {
  agencyId: string;
  legalName: string;
  gstin: string | null;
  status: string;
  creditLimit: number;
  outstanding: number;
  available: number;
  advance: number;
  openInvoices: number;
}

export type SettlementMethod = 'CASH' | 'BANK_TRANSFER' | 'CHEQUE' | 'UPI' | 'OTHER';

export interface RecordSettlementInput {
  agencyId: string;
  amount: number;
  method: SettlementMethod;
  reference?: string;
  note?: string;
}

export interface SettlementBalance {
  outstanding: number;
  creditLimit: number;
  available: number;
  advance: number;
}

export interface SettlementResult {
  applied: number;
  advanceRecorded: number;
  allocations: { invoiceId: string; number: string; applied: number; fullySettled: boolean }[];
  balance: SettlementBalance;
}

export interface SettlementHistoryEntry {
  id: string;
  amount: number;
  reference: string | null;
  invoiceNumber: string | null;
  unapplied: boolean;
  createdAt: string;
}

export async function listSettlementAgencies(search?: string): Promise<CreditAgencyBalance[]> {
  const res = await httpClient.get('/finance/settlements/agencies', { params: search ? { search } : {} });
  return res.data.items;
}

export interface AdminInvoice {
  id: string;
  number: string;
  agencyName: string;
  amount: number;
  amountPaid: number;
  paymentMode: 'PREPAY' | 'CREDIT';
  status: 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'VOID' | 'REFUNDED';
  overdue: boolean;
  dueDate: string | null;
  issuedAt: string;
}

export interface AdminRefund {
  id: string;
  agencyName: string;
  invoiceNumber: string | null;
  amount: number;
  type: 'Refund' | 'Chargeback';
  gatewayRef: string | null;
  createdAt: string;
}

export async function listAllInvoices(): Promise<AdminInvoice[]> {
  return (await httpClient.get('/finance/invoices/all', { params: { pageSize: 100 } })).data.items;
}

export async function listRefunds(): Promise<AdminRefund[]> {
  return (await httpClient.get('/finance/refunds', { params: { pageSize: 100 } })).data.items;
}

// --- CRS sync (CRS/CRS outbox) -----------------------------------------
export interface CrsEvent {
  id: string;
  eventType: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  correlationId: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}
export interface CrsStatus {
  counts: { pending: number; sent: number; failed: number; total: number };
  events: CrsEvent[];
}

export async function getCrsStatus(): Promise<CrsStatus> {
  return (await httpClient.get('/finance/crs/status')).data;
}

export async function flushCrs(): Promise<{ sent?: number; failed?: number } & Record<string, unknown>> {
  return (await httpClient.post('/finance/crs/flush')).data;
}

export interface Reconciliation {
  committedWithoutAxisRef: number;
  committedWithoutInvoice: number;
  pendingCrsEvents: number;
  failedCrsEvents: number;
  paymentsAwaitingSettlement: number;
  unmatchedPayments: number;
  openChargebacks: number;
  invoiceLedgerMismatches: number;
  generatedAt: string;
  clean: boolean;
}

export async function getReconciliation(): Promise<Reconciliation> {
  return (await httpClient.get('/finance/reconciliation')).data;
}

export async function recordSettlement(input: RecordSettlementInput): Promise<SettlementResult> {
  const res = await httpClient.post('/finance/settlements', input);
  return res.data;
}

export async function applyAgencyAdvance(agencyId: string): Promise<{ applied: number; balance: SettlementBalance }> {
  const res = await httpClient.post(`/finance/settlements/agencies/${agencyId}/apply-advance`);
  return res.data;
}

export async function getSettlementHistory(agencyId: string): Promise<SettlementHistoryEntry[]> {
  const res = await httpClient.get(`/finance/settlements/agencies/${agencyId}/history`);
  return res.data.items;
}
