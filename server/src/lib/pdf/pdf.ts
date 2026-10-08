import PDFDocument from 'pdfkit';

/**
 * Thin wrapper around PDFKit so document services just describe content and get
 * a Buffer back (streamed to the HTTP response by the controller). Pure JS — no
 * headless browser or native deps — so invoice/voucher generation is
 * deterministic and safe to run in-process.
 */
export type PdfBuilder = (doc: PDFKit.PDFDocument) => void;

export function renderPdf(build: PdfBuilder): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      build(doc);
      doc.end();
    } catch (err) {
      reject(err as Error);
    }
  });
}

// --- shared palette / helpers -------------------------------------------------

export const INK = '#0f172a'; // slate-900
export const MUTED = '#64748b'; // slate-500
export const LINE = '#e2e8f0'; // slate-200
export const BRAND = '#1d4ed8'; // blue-700
export const ACCENT_BG = '#f1f5f9'; // slate-100

// PDFKit's built-in Helvetica (WinAnsi) has no ₹ (U+20B9) glyph, so use the
// unambiguous ASCII "Rs." prefix on generated documents.
export const money = (n: number): string =>
  'Rs. ' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const dateStr = (d: Date | string | null | undefined): string =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export interface CompanyProfile {
  name: string;
  addressLines: string[];
  gstin: string;
  email: string;
  phone: string;
  website: string;
}

/** Page header: company identity on the left, document title/meta on the right.
 *  Empty identity fields are skipped — a document must never carry a fabricated
 *  GSTIN or phone just to fill the line. */
export function drawHeader(doc: PDFKit.PDFDocument, company: CompanyProfile, title: string, subtitle?: string): void {
  const top = doc.y;
  doc.fillColor(BRAND).fontSize(20).font('Helvetica-Bold').text(company.name, 48, top);
  doc.fillColor(MUTED).fontSize(8).font('Helvetica');
  company.addressLines.forEach((l) => doc.text(l));
  if (company.gstin) doc.text(`GSTIN: ${company.gstin}`);
  const contact = [company.email, company.phone].filter(Boolean).join('  ·  ');
  if (contact) doc.text(contact);

  doc.fillColor(INK).fontSize(18).font('Helvetica-Bold').text(title, 320, top, { width: 227, align: 'right' });
  if (subtitle) doc.fillColor(MUTED).fontSize(9).font('Helvetica').text(subtitle, 320, doc.y + 2, { width: 227, align: 'right' });

  doc.moveTo(48, 132).lineTo(547, 132).strokeColor(LINE).lineWidth(1).stroke();
  doc.y = 148;
  doc.x = 48;
}

/** A two-column meta block (label/value pairs) laid out side by side. */
export function drawMetaColumns(doc: PDFKit.PDFDocument, left: [string, string][], right: [string, string][]): void {
  const startY = doc.y;
  const render = (rows: [string, string][], x: number) => {
    let y = startY;
    for (const [label, value] of rows) {
      doc.fillColor(MUTED).fontSize(8).font('Helvetica').text(label.toUpperCase(), x, y, { width: 240 });
      doc.fillColor(INK).fontSize(10).font('Helvetica-Bold').text(value, x, y + 10, { width: 240 });
      y += 30;
    }
    return y;
  };
  const leftEnd = render(left, 48);
  const rightEnd = render(right, 310);
  doc.y = Math.max(leftEnd, rightEnd) + 6;
  doc.x = 48;
}

/** Footer stamped on every buffered page (page numbers + note). */
export function drawFooter(doc: PDFKit.PDFDocument, note: string): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Writing inside the bottom-margin band would otherwise trigger an automatic
    // page break; zero the bottom margin for the duration of the footer write.
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 34;
    doc.fillColor(MUTED).fontSize(7.5).font('Helvetica');
    doc.text(note, 48, y, { width: 400, lineBreak: false });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, 400, y, { width: 147, align: 'right', lineBreak: false });
  }
}
