import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/apiError';
import { getCompanyProfile } from '../../config/company';
import { getCheckInOutTimes } from '../settings/settings.service';
import { renderPdf, drawHeader, drawMetaColumns, drawFooter, dateStr, money, INK, MUTED, LINE, ACCENT_BG } from '../../lib/pdf/pdf';

export interface VoucherScope {
  agencyId?: string; // restrict to this agency (AGENCY/AGENT)
  agentId?: string; // further restrict to this agent (AGENT)
}

/**
 * B2B resale layer — two voucher variants:
 * - 'guest': price-free, safe to hand to the end customer (default).
 * - 'agent': internal copy with the agency's buy price, sell price and profit.
 */
export type VoucherVariant = 'guest' | 'agent';

/** Booking confirmation voucher — printable proof of a committed reservation. */
export async function renderVoucherPdf(
  bookingId: string,
  scope: VoucherScope,
  variant: VoucherVariant = 'guest',
): Promise<{ buffer: Buffer; fileName: string }> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { agency: true, agent: { select: { name: true, email: true } } },
  });
  if (!booking) throw ApiError.notFound('Booking not found');
  if (scope.agencyId && booking.agencyId !== scope.agencyId) throw ApiError.forbidden('Booking belongs to another agency');
  if (scope.agentId && booking.agentId !== scope.agentId) throw ApiError.forbidden('Booking belongs to another agent');

  // Only confirmed/committed bookings have a meaningful voucher.
  const confirmable = ['CONFIRMED', 'COMMITTED', 'PAID', 'CONFIRMED_ON_CREDIT', 'COMMIT_FAILED'];
  const isConfirmed = confirmable.includes(booking.state) || !!booking.committedAt || !!booking.crsBookingRef;

  const company = getCompanyProfile();
  const buffer = await renderPdf((doc) => {
    drawHeader(
      doc,
      company,
      'BOOKING VOUCHER',
      variant === 'agent' ? 'Agent copy — internal, not for guests' : isConfirmed ? 'Confirmed reservation' : `Status: ${booking.state}`,
    );

    drawMetaColumns(
      doc,
      [
        ['Booking reference', booking.correlationId.slice(0, 8).toUpperCase()],
        ['Resort', booking.resortName],
        ['Room type', booking.roomTypeName],
        ['Rate plan', booking.ratePlan],
      ],
      [
        ['CRS ref', booking.crsBookingRef ?? 'Pending sync'],
        ['Booked by', booking.agency.legalName],
        ['Agent', booking.agent.name ?? booking.agent.email],
        ['Status', booking.state],
      ],
    );

    // Stay band
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

    // Guest details
    doc.fillColor(MUTED).fontSize(8).font('Helvetica-Bold').text('LEAD GUEST');
    doc.moveDown(0.2);
    doc.fillColor(INK).fontSize(10).font('Helvetica');
    doc.text(booking.leadGuestName ?? '—');
    if (booking.leadGuestPhone) doc.text(booking.leadGuestPhone);
    if (booking.leadGuestEmail) doc.text(booking.leadGuestEmail);
    if (booking.guestIdType) doc.fillColor(MUTED).fontSize(9).text(`ID: ${booking.guestIdType} ****${booking.guestIdLast4 ?? ''}`);
    if (booking.specialRequests) {
      doc.moveDown(0.3);
      doc.fillColor(MUTED).fontSize(8).font('Helvetica-Bold').text('SPECIAL REQUESTS');
      doc.fillColor(INK).fontSize(9).font('Helvetica').text(booking.specialRequests, { width: 499 });
    }

    // B2B resale layer — the GUEST voucher stays price-free (printing agencyPrice
    // would leak the agent's buy price to their customer). The AGENT copy carries
    // the full money picture for internal records.
    doc.moveDown(0.8);
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor(LINE).lineWidth(1).stroke();

    if (variant === 'agent') {
      const row = (label: string, value: string, bold = false) => {
        doc.moveDown(0.4);
        doc.fillColor(MUTED).fontSize(9).font('Helvetica').text(label, 320, doc.y, { width: 130 });
        doc.fillColor(INK).fontSize(bold ? 13 : 10).font('Helvetica-Bold').text(value, 450, doc.y - (bold ? 15 : 12), { width: 97, align: 'right' });
      };
      doc.moveDown(0.1);
      row('Payment mode', booking.paymentMode);
      row('Your price', money(Number(booking.agencyPrice)), true);
      if (booking.sellPrice != null) {
        row(`Customer price (+${Number(booking.resaleMarkupPct ?? 0)}%)`, money(Number(booking.sellPrice)));
        row('Your profit', money(Number(booking.sellPrice) - Number(booking.agencyPrice)));
      }
      doc.y += 24;
    } else {
      doc.y += 12;
    }
    doc.x = 48;
    const times = getCheckInOutTimes();
    doc.fillColor(MUTED).fontSize(8).font('Helvetica').text(
      `Standard check-in from ${times.checkIn}, check-out by ${times.checkOut}. Present this voucher and a valid photo ID at the resort front desk.`,
      48,
      doc.y,
      { width: 499 },
    );

    drawFooter(
      doc,
      `${company.name} · ${variant === 'agent' ? 'Agent voucher (internal)' : 'Booking voucher'} · ${booking.correlationId.slice(0, 8).toUpperCase()}`,
    );
  });

  const ref = booking.correlationId.slice(0, 8).toUpperCase();
  return { buffer, fileName: variant === 'agent' ? `agent-voucher-${ref}.pdf` : `voucher-${ref}.pdf` };
}
