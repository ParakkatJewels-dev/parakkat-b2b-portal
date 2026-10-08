import { httpClient } from './httpClient';

/**
 * PDF document downloads. Each hits an endpoint that streams `application/pdf`;
 * we pull it as a blob (auth + refresh handled by the shared client) and trigger
 * a browser save using the server-provided filename.
 */
async function download(url: string, fallbackName: string): Promise<void> {
  const res = await httpClient.get(url, { responseType: 'blob' });
  const disposition = String(res.headers['content-disposition'] ?? '');
  const match = disposition.match(/filename="?([^"]+)"?/);
  const fileName = match?.[1] ?? fallbackName;

  const blobUrl = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(blobUrl);
}

export const downloadInvoicePdf = (invoiceId: string, number?: string) =>
  download(`/finance/invoices/${invoiceId}/pdf`, `${number ?? 'invoice'}.pdf`);

export const downloadCreditStatement = () => download('/finance/statements/credit', 'credit-statement.pdf');

export const downloadAccountStatement = () => download('/finance/statements/account', 'account-statement.pdf');

/** guest = price-free (safe to hand to the customer); agent = internal copy with prices. */
export const downloadVoucher = (bookingId: string, ref?: string, variant: 'guest' | 'agent' = 'guest') =>
  download(
    `/bookings/${bookingId}/voucher?variant=${variant}`,
    `${variant === 'agent' ? 'agent-voucher' : 'voucher'}-${ref ?? bookingId}.pdf`,
  );

// B2B resale layer — agency-branded customer documents (sell price only).
export const downloadCustomerQuote = (bookingId: string, ref?: string) =>
  download(`/bookings/${bookingId}/customer-quote`, `quote-${ref ?? bookingId}.pdf`);

export const downloadCustomerInvoice = (bookingId: string, ref?: string) =>
  download(`/bookings/${bookingId}/customer-invoice`, `customer-invoice-${ref ?? bookingId}.pdf`);
