import type { Booking, Agency } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/apiError';
import { getCheckInOutTimes } from '../settings/settings.service';
import {
  renderPdf,
  drawHeader,
  drawMetaColumns,
  drawFooter,
  dateStr,
  money,
  INK,
  MUTED,
  LINE,
  ACCENT_BG,
  type CompanyProfile,
} from '../../lib/pdf/pdf';
import type { VoucherScope } from './voucher.service';

/**
 * B2B resale layer — customer-facing documents. These are issued under the
 * AGENCY's identity (white-label) and show only the agent's SELL price; the
 * agency's buy price (agencyPrice) must never appear on them.
 */

/** The agency presented as the issuing business in the PDF header. */
function agencyIdentity(agency: Agency): CompanyProfile {
  return {
    name: agency.legalName,
    addressLines: [],
    gstin: agency.gstin,
    email: agency.contactEmail,
    phone: agency.contactPhone,
    website: '',
  };
}

/** Sell price with fallback for pre-feature bookings (no markup ⇒ sell = buy). */
function sellPriceOf(booking: Booking): number {
  return Number(booking.sellPrice ?? booking.agencyPrice);
}

type BookingWithAgency = Booking & { agency: Agency };

async function loadScoped(bookingId: string, scope: VoucherScope): Promise<BookingWithAgency> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, include: { agency: true } });
  if (!booking) throw ApiError.notFound('Booking not found');
  if (scope.agencyId && booking.agencyId !== scope.agencyId) throw ApiError.forbidden('Booking belongs to another agency');
  if (scope.agentId && booking.agentId !== scope.agentId) throw ApiError.forbidden('Booking belongs to another agent');
  return booking;
}

/** Shared stay band + guest block used by both customer documents. */
function drawStayAndGuest(doc: PDFKit.PDFDocument, booking: BookingWithAgency): void {
  doc.moveDown(0.3);
  const bandY = doc.y;
  doc.rect(48, bandY, 499, 54).fill(ACCENT_BG);
  const cell = (label: string, value: string, x: number, w: number) => {
    doc.fillColor(MUTED).fontSize(8).font('Helvetica-Bold').text(label.toUpperCase(), x + 10, bandY + 10, { width: w - 20 });
    doc.fillColor(INK).fontSize(12).font('Helvetica-Bold').text(value, x + 10, bandY + 24, { width: w - 20 });
  };
  if (booking.stayType === 'DAY_USE') {
    cell('Day-use date', dateStr(booking.checkIn), 48, 200);
    cell('Guests', String(booking.guests), 248, 150);
    cell('Occupancy', `${booking.adults}A · ${booking.children}C`, 398, 149);
  } else {
    cell('Check-in', dateStr(booking.checkIn), 48, 150);
    cell('Check-out', dateStr(booking.checkOut), 198, 150);
    cell('Nights', String(booking.nights), 348, 90);
    cell('Guests', String(booking.guests), 438, 109);
  }
  doc.y = bandY + 66;
  doc.x = 48;

  doc.fillColor(MUTED).fontSize(8).font('Helvetica-Bold').text('GUEST');
  doc.moveDown(0.2);
  doc.fillColor(INK).fontSize(10).font('Helvetica');
  doc.text(booking.leadGuestName ?? '—');
  if (booking.leadGuestPhone) doc.text(booking.leadGuestPhone);
  if (booking.leadGuestEmail) doc.text(booking.leadGuestEmail);
}

/** Right-aligned total row showing the SELL price only. */
function drawSellTotal(doc: PDFKit.PDFDocument, label: string, amount: number): void {
  doc.moveDown(0.8);
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor(LINE).lineWidth(1).stroke();
  doc.moveDown(0.5);
  doc.fillColor(MUTED).fontSize(11).font('Helvetica').text(label, 320, doc.y, { width: 130 });
  doc.fillColor(INK).fontSize(13).font('Helvetica-Bold').text(money(amount), 450, doc.y - 15, { width: 97, align: 'right' });
  doc.y += 24;
  doc.x = 48;
}

/**
 * Customer quotation — generated from a hold or any live booking so the agent
 * can send their customer a priced offer before (or after) paying the portal.
 */
export async function renderCustomerQuotePdf(bookingId: string, scope: VoucherScope): Promise<{ buffer: Buffer; fileName: string }> {
  const booking = await loadScoped(bookingId, scope);
  if (booking.state === 'CANCELLED' || booking.state === 'EXPIRED') {
    throw ApiError.conflict('Cannot generate a quotation for a cancelled or expired booking');
  }

  const ref = booking.correlationId.slice(0, 8).toUpperCase();
  const buffer = await renderPdf((doc) => {
    drawHeader(doc, agencyIdentity(booking.agency), 'QUOTATION', `Ref: Q-${ref}`);

    drawMetaColumns(
      doc,
      [
        ['Quotation date', dateStr(new Date())],
        ['Resort', booking.resortName],
        ['Room type', booking.roomTypeName],
        ['Rate plan', booking.ratePlan],
      ],
      [
        ['Quotation ref', `Q-${ref}`],
        ['Prepared for', booking.leadGuestName ?? 'Guest'],
        ['Prepared by', booking.agency.legalName],
        // A pay-first hold expires; the offer should not outlive the hold.
        ['Valid until', booking.holdExpiresAt ? dateStr(booking.holdExpiresAt) : dateStr(booking.checkIn)],
      ],
    );

    drawStayAndGuest(doc, booking);
    drawSellTotal(doc, 'Total price', sellPriceOf(booking));

    const times = getCheckInOutTimes();
    doc.fillColor(MUTED).fontSize(8).font('Helvetica').text(
      `This quotation is issued by ${booking.agency.legalName}. Price is for the stay as described above; standard check-in from ${times.checkIn}, check-out by ${times.checkOut}. Availability is not guaranteed until the booking is confirmed.`,
      48,
      doc.y,
      { width: 499 },
    );

    drawFooter(doc, `${booking.agency.legalName} · Quotation · Q-${ref}`);
  });

  return { buffer, fileName: `quote-${ref}.pdf` };
}

/**
 * Customer invoice — issued by the agency to their customer for a confirmed
 * booking, at the agent's sell price.
 */
export async function renderCustomerInvoicePdf(bookingId: string, scope: VoucherScope): Promise<{ buffer: Buffer; fileName: string }> {
  const booking = await loadScoped(bookingId, scope);
  const invoiceable = ['CONFIRMED', 'COMMITTED', 'PAID', 'CONFIRMED_ON_CREDIT', 'COMMIT_FAILED'];
  if (!invoiceable.includes(booking.state) && !booking.committedAt) {
    throw ApiError.conflict('A customer invoice is available only for a confirmed booking');
  }

  const ref = booking.correlationId.slice(0, 8).toUpperCase();
  const buffer = await renderPdf((doc) => {
    drawHeader(doc, agencyIdentity(booking.agency), 'INVOICE', `Ref: CI-${ref}`);

    drawMetaColumns(
      doc,
      [
        ['Invoice date', dateStr(new Date())],
        ['Resort', booking.resortName],
        ['Room type', booking.roomTypeName],
        ['Rate plan', booking.ratePlan],
      ],
      [
        ['Invoice ref', `CI-${ref}`],
        ['Billed to', booking.leadGuestName ?? 'Guest'],
        ['Issued by', booking.agency.legalName],
        ['Booking ref', ref],
      ],
    );

    drawStayAndGuest(doc, booking);
    drawSellTotal(doc, 'Total amount', sellPriceOf(booking));

    doc.fillColor(MUTED).fontSize(8).font('Helvetica').text(
      `This invoice is issued by ${booking.agency.legalName} (GSTIN: ${booking.agency.gstin}) for the stay described above. Please quote the invoice reference in any correspondence.`,
      48,
      doc.y,
      { width: 499 },
    );

    drawFooter(doc, `${booking.agency.legalName} · Invoice · CI-${ref}`);
  });

  return { buffer, fileName: `customer-invoice-${ref}.pdf` };
}
