import { z } from 'zod';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

const planEnum = z.enum(['EP', 'CP', 'MAP', 'AP']);
const stayTypeEnum = z.enum(['OVERNIGHT', 'DAY_USE']);

// v3 §2.2 — child ages as a CSV query param (e.g. "4,9"), parsed to number[].
const childAgesCsv = z
  .string()
  .optional()
  .transform((s) => (s ? s.split(',').map((x) => Number(x.trim())).filter((n) => Number.isFinite(n)) : undefined))
  .refine((arr) => !arr || arr.every((n) => n >= 0 && n <= 17), { message: 'Child ages must be between 0 and 17' });

export const availabilityQuerySchema = z.object({
  resortId: z.string().min(1),
  checkIn: dateString,
  checkOut: dateString.optional(),
  stayType: stayTypeEnum.optional(),
  guests: z.coerce.number().int().positive().max(20),
  adults: z.coerce.number().int().positive().max(20).optional(),
  children: z.coerce.number().int().min(0).max(20).optional(),
  childAges: childAgesCsv,
  extraBeds: z.coerce.number().int().min(0).max(10).optional(),
});

const guestSchema = z.object({
  name: z.string().max(120).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().max(200).optional().or(z.literal('')),
  specialRequests: z.string().max(500).optional(),
  idType: z.string().max(40).optional(),
  idNumber: z.string().max(40).optional(),
  roomingList: z.array(z.string().max(120)).max(20).optional(),
});

export const createBookingSchema = z.object({
  resortId: z.string().min(1),
  roomTypeId: z.string().min(1),
  checkIn: dateString,
  checkOut: dateString.optional(), // optional for DAY_USE (same-day)
  stayType: stayTypeEnum.optional(), // default OVERNIGHT
  guests: z.number().int().positive().max(20),
  plan: planEnum.optional(),
  adults: z.number().int().positive().max(20).optional(),
  children: z.number().int().min(0).max(20).optional(),
  childAges: z.array(z.number().int().min(0).max(17)).max(20).optional(), // v3 §2.2
  extraBeds: z.number().int().min(0).max(10).optional(),
  // B2B resale layer — per-booking override of the agency's default resale markup.
  resaleMarkupPct: z.number().min(0).max(500).optional(),
  guest: guestSchema.optional(),
});

export const createGroupBookingSchema = z.object({
  lines: z.array(createBookingSchema).min(1).max(10),
});

export const bookingIdParamSchema = z.object({ id: z.string().uuid() });
// guest = price-free (safe for the end customer); agent = internal copy with prices.
export const voucherQuerySchema = z.object({ variant: z.enum(['guest', 'agent']).optional() });
export const groupIdParamSchema = z.object({ groupId: z.string().uuid() });
export const resortCancelSchema = z.object({ reason: z.string().min(1).max(500) });

export const listBookingsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});
