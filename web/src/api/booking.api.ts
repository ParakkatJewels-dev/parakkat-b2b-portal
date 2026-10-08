import { httpClient } from './httpClient';
import type { Booking, BookingState, PricedRoomType, RatePlan, Resort } from '../types/booking';

export async function listResorts(): Promise<Resort[]> {
  const res = await httpClient.get('/catalog/resorts');
  return res.data.resorts;
}

/** Dateless room-catalog browse (room-first flow). */
export interface BrowseRoom {
  resortId: string;
  resortName: string;
  location: string;
  roomTypeId: string;
  roomTypeName: string;
  maxOccupancy: number;
  indicativePricePerNight: number;
}

export async function browseRooms(): Promise<BrowseRoom[]> {
  const res = await httpClient.get('/catalog/rooms');
  return res.data.rooms;
}

export interface AvailabilityParams {
  resortId: string;
  checkIn: string;
  checkOut?: string; // optional for DAY_USE (same-day)
  stayType?: 'OVERNIGHT' | 'DAY_USE'; // v4 §1 — default OVERNIGHT
  guests: number;
  adults?: number;
  children?: number;
  childAges?: number[]; // v3 §2.2
  extraBeds?: number;
}

export async function searchAvailability(params: AvailabilityParams): Promise<PricedRoomType[]> {
  // v3 §2.2 — child ages travel as a CSV query param (e.g. childAges=4,9).
  const { childAges, ...rest } = params;
  const query = { ...rest, ...(childAges && childAges.length ? { childAges: childAges.join(',') } : {}) };
  const res = await httpClient.get('/catalog/availability', { params: query });
  return res.data.roomTypes;
}

export interface GuestInput {
  name?: string;
  phone?: string;
  email?: string;
  specialRequests?: string;
  idType?: string;
  idNumber?: string;
  roomingList?: string[];
}

export interface CreateBookingInput extends AvailabilityParams {
  // childAges (v3 §2.2) is inherited; in the POST body it is sent as a JSON array.
  roomTypeId: string;
  plan?: RatePlan;
  // B2B resale layer — per-booking override of the agency default markup.
  resaleMarkupPct?: number;
  guest?: GuestInput;
}

export async function createBooking(input: CreateBookingInput): Promise<Booking> {
  const res = await httpClient.post('/bookings', input);
  return res.data;
}

export interface GroupBookingResult {
  groupId: string | null;
  bookings: Booking[];
}

/** v3 §4 — create a multi-room group booking (aggregate credit gate). */
export async function createGroupBooking(lines: CreateBookingInput[]): Promise<GroupBookingResult> {
  const res = await httpClient.post('/bookings/group', { lines });
  return res.data;
}

/** Pay all awaiting-payment lines of a group in one checkout. */
export async function payGroup(groupId: string): Promise<{ bookings: Booking[] }> {
  const res = await httpClient.post(`/bookings/group/${groupId}/pay`);
  return res.data;
}

export async function payBooking(id: string): Promise<Booking> {
  const res = await httpClient.post(`/bookings/${id}/pay`);
  return res.data;
}

export async function cancelBooking(id: string): Promise<Booking> {
  const res = await httpClient.post(`/bookings/${id}/cancel`);
  return res.data;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listBookings(): Promise<Paged<Booking>> {
  const res = await httpClient.get('/bookings');
  return res.data;
}

export interface AdminBookingRow extends Booking {
  agencyName: string;
}

export async function listAllBookings(page = 1, pageSize = 100): Promise<Paged<AdminBookingRow>> {
  const res = await httpClient.get('/bookings/admin', { params: { page, pageSize } });
  return res.data;
}

/** v3 §7.2 — admin records a no-show (policy charge applied). */
export async function adminNoShow(id: string): Promise<Booking> {
  return (await httpClient.post(`/bookings/admin/${id}/no-show`)).data;
}

/** v3 §7.3 — admin cancels on the resort's behalf (full refund + reason). */
export async function adminResortCancel(id: string, reason: string): Promise<Booking> {
  return (await httpClient.post(`/bookings/admin/${id}/resort-cancel`, { reason })).data;
}

// --- v3 §5.2 — commit-failure / rebook queue (admin) ---
export interface RebookTaskRow {
  id: string;
  bookingId: string;
  status: 'PENDING' | 'ABANDONED';
  attempts: number;
  lastError: string | null;
  createdAt: string;
  agencyName: string;
  resortName: string;
  roomTypeName: string;
  paymentMode: 'PREPAY' | 'CREDIT';
  agencyPrice: string;
  checkIn: string;
  checkOut: string;
  bookingState: BookingState;
}

export async function listRebookQueue(): Promise<{ items: RebookTaskRow[] }> {
  return (await httpClient.get('/bookings/admin/rebook-queue')).data;
}

export async function runRebookQueue(): Promise<{ resolved: number; stillPending: number; abandoned: number }> {
  return (await httpClient.post('/bookings/admin/rebook/run')).data;
}

export async function retryRebook(bookingId: string): Promise<Booking> {
  return (await httpClient.post(`/bookings/admin/rebook/${bookingId}/retry`)).data;
}

export interface GuestBooking {
  id: string;
  resortName: string;
  checkIn: string;
  checkOut: string;
  state: BookingState;
  agencyPrice: number;
}

export interface GuestSummary {
  key: string;
  name: string;
  email: string | null;
  phone: string | null;
  stays: number;
  lastStay: string | null;
  totalSpend: number;
  frequent: boolean;
  bookings: GuestBooking[];
}

/** Guests derived from bookings' lead-guest data (agency-wide, or agent-scoped). */
export async function listGuests(): Promise<{ guests: GuestSummary[]; totalStays: number }> {
  return (await httpClient.get('/bookings/guests')).data;
}
