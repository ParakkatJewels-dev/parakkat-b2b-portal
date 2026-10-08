import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from '../lib/router';
import { AppShell } from '../components/layout/AppShell';
import { useAuth } from '../hooks/useAuth';
import { Badge, Button, Field, Input, PageHeader, Select, inr } from '../components/ui/kit';
import { Icons } from '../components/layout/icons';
import * as bookingApi from '../api/booking.api';
import * as agencyApi from '../api/agency.api';
import type { BrowseRoom } from '../api/booking.api';
import type { PricedRoomType, RatePlan } from '../types/booking';

const PLAN_ORDER: RatePlan[] = ['EP', 'CP', 'MAP', 'AP'];
const PLAN_LABEL: Record<RatePlan, string> = { EP: 'EP · Room only', CP: 'CP · Breakfast', MAP: 'MAP · Half board', AP: 'AP · Full board' };
const GRADIENTS = ['from-sky-100 to-blue-100 dark:from-sky-950/30 dark:to-blue-950/30', 'from-emerald-100 to-green-100 dark:from-emerald-950/30 dark:to-green-950/30', 'from-amber-100 to-orange-100 dark:from-amber-950/30 dark:to-orange-950/30', 'from-violet-100 to-purple-100 dark:from-violet-950/30 dark:to-purple-950/30'];

function gradientFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}
const cheapestPlan = (rt: PricedRoomType): RatePlan => rt.plans.reduce((a, b) => (a.priceTotal <= b.priceTotal ? a : b)).plan;
const sortedPlans = (rt: PricedRoomType) => [...rt.plans].sort((a, b) => PLAN_ORDER.indexOf(a.plan) - PLAN_ORDER.indexOf(b.plan));

// Stay-date guardrails
const MAX_ADVANCE_DAYS = 365;
const MAX_STAY_NIGHTS = 30;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayStr = () => ymd(new Date());
function addDaysStr(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00`);
  d.setDate(d.getDate() + days);
  return ymd(d);
}
function nightsBetweenStr(checkIn: string, checkOut: string): number {
  return Math.round((new Date(`${checkOut}T00:00:00`).getTime() - new Date(`${checkIn}T00:00:00`).getTime()) / 86400000);
}
function datesOverlapStr(s1: string, e1: string, s2: string, e2: string): boolean {
  return s1 < e2 && e1 > s2;
}

const roomKey = (resortId: string, roomTypeId: string) => `${resortId}::${roomTypeId}`;

type StayType = 'OVERNIGHT' | 'DAY_USE';

interface Occupancy {
  stayType: StayType;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  childAges: number[];
  extraBeds: number;
}

interface CartLine {
  key: string;
  resortId: string;
  resortName: string;
  roomTypeId: string;
  roomTypeName: string;
  plan: RatePlan;
  stayType: StayType;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  childAges: number[];
  extraBeds: number;
  nights: number;
  priceTotal: number;
}

export function SearchPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const myBookingsPath = user?.role === 'AGENT' ? '/agent/bookings' : '/agency/bookings';

  const { data: rooms = [], isLoading } = useQuery({ queryKey: ['browse-rooms'], queryFn: bookingApi.browseRooms });

  const [destination, setDestination] = useState('all');
  const [searchParams] = useSearchParams();
  const [searchText, setSearchText] = useState(searchParams.get('search') ?? '');

  useEffect(() => {
    const q = searchParams.get('search');
    if (q != null) {
      setSearchText(q);
    }
  }, [searchParams]);
  const [occ, setOcc] = useState<Occupancy>({ stayType: 'OVERNIGHT', checkIn: '', checkOut: '', adults: 2, children: 0, childAges: [], extraBeds: 0 });
  const isDayUse = occ.stayType === 'DAY_USE';

  // Availability result
  const [searched, setSearched] = useState<{ occ: Occupancy; avail: Record<string, PricedRoomType> } | null>(null);
  const [searching, setSearching] = useState(false);
  const [chosenPlan, setChosenPlan] = useState<Record<string, RatePlan>>({});
  const [notice, setNotice] = useState<string | null>(null);

  // Cart / checkout
  const [cart, setCart] = useState<CartLine[]>([]);
  const [guest, setGuest] = useState({ name: '', phone: '', email: '', idType: '', idNumber: '' });
  const [result, setResult] = useState<bookingApi.GroupBookingResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // B2B resale layer — the agency default prefills the control; typing a value
  // overrides it for this booking only (empty = use the default).
  const { data: resaleDefault } = useQuery({ queryKey: ['resale-markup'], queryFn: agencyApi.getResaleMarkup });
  const [resalePctInput, setResalePctInput] = useState('');
  const defaultResalePct = Number(resaleDefault?.defaultResaleMarkupPct ?? 0);
  const parsedOverride = resalePctInput.trim() === '' ? null : Number(resalePctInput);
  const overrideValid = parsedOverride === null || (Number.isFinite(parsedOverride) && parsedOverride >= 0 && parsedOverride <= 500);
  const effectiveResalePct = overrideValid && parsedOverride !== null ? parsedOverride : defaultResalePct;

  // Occupancy counters popover state
  const [showOccPopover, setShowOccPopover] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);

  // Custom Calendar state
  const [showCalendarPopover, setShowCalendarPopover] = useState(false);
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);

  const refreshAll = () => ['bookings', 'balance', 'invoices', 'agency-summary', 'agent-summary'].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));

  function updateOcc(patch: Partial<Occupancy>) {
    setOcc((o) => ({ ...o, ...patch }));
    setSearched(null);
    setNotice(null);
  }
  function setChildren(n: number) {
    const count = Math.max(0, Math.min(20, n));
    setOcc((o) => ({ ...o, children: count, childAges: Array.from({ length: count }, (_, i) => o.childAges[i] ?? 5) }));
    setSearched(null);
  }

  const adjustAdults = (amount: number) => {
    const val = Math.max(1, Math.min(20, occ.adults + amount));
    updateOcc({ adults: val });
  };
  const adjustChildren = (amount: number) => {
    const val = Math.max(0, Math.min(20, occ.children + amount));
    setChildren(val);
  };
  const adjustExtraBeds = (amount: number) => {
    const val = Math.max(0, Math.min(10, occ.extraBeds + amount));
    updateOcc({ extraBeds: val });
  };

  const friendlyDate = (dateStr: string) => {
    if (!dateStr) return 'Choose date';
    const d = new Date(`${dateStr}T00:00:00`);
    return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  };

  const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const startDayOfWeek = (year: number, month: number) => new Date(year, month, 1).getDay();

  const handleDayClick = (dateStr: string) => {
    if (!occ.checkIn || (occ.checkIn && occ.checkOut)) {
      updateOcc({ checkIn: dateStr, checkOut: '' });
      if (isDayUse) {
        updateOcc({ checkIn: dateStr, checkOut: dateStr });
        setShowCalendarPopover(false);
      }
    } else {
      if (dateStr < occ.checkIn) {
        updateOcc({ checkIn: dateStr, checkOut: '' });
      } else if (dateStr === occ.checkIn) {
        if (isDayUse) {
          updateOcc({ checkOut: dateStr });
          setShowCalendarPopover(false);
        } else {
          setNotice('Overnight stay requires at least 1 night. Check-out must be after check-in.');
        }
      } else {
        updateOcc({ checkOut: dateStr });
        setShowCalendarPopover(false);
      }
    }
  };

  const renderCalendar = () => {
    const todayMidnight = new Date();
    todayMidnight.setHours(0,0,0,0);
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + MAX_ADVANCE_DAYS);
    maxDate.setHours(0,0,0,0);

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const days = [];
    const totalDays = daysInMonth(calYear, calMonth);
    const startOfWeek = startDayOfWeek(calYear, calMonth);

    const prevMonthDays = daysInMonth(calYear, calMonth - 1);
    for (let i = startOfWeek - 1; i >= 0; i--) {
      const pDay = prevMonthDays - i;
      const prevDate = new Date(calYear, calMonth - 1, pDay);
      days.push({ date: prevDate, isCurrentMonth: false, label: pDay });
    }

    for (let d = 1; d <= totalDays; d++) {
      const currentDate = new Date(calYear, calMonth, d);
      days.push({ date: currentDate, isCurrentMonth: true, label: d });
    }

    const prevMonth = () => {
      if (calMonth === 0) {
        setCalMonth(11);
        setCalYear(calYear - 1);
      } else {
        setCalMonth(calMonth - 1);
      }
    };

    const nextMonth = () => {
      if (calMonth === 11) {
        setCalMonth(0);
        setCalYear(calYear + 1);
      } else {
        setCalMonth(calMonth + 1);
      }
    };

    return (
      <div className="w-80 p-4 bg-white dark:bg-slate-950 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3 border-b border-slate-100 dark:border-slate-805 pb-2">
          <button type="button" onClick={prevMonth} className="p-1 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900 text-slate-500">
            <Icons.chevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-bold text-slate-850 dark:text-white">
            {monthNames[calMonth]} {calYear}
          </span>
          <button type="button" onClick={nextMonth} className="p-1 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900 text-slate-500">
            <Icons.chevronDown className="h-4 w-4 -rotate-90" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-slate-400 mb-1">
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(w => (
            <div key={w} className="py-1">{w}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-xs">
          {days.map((item, index) => {
            const dateStr = ymd(item.date);
            const isToday = dateStr === today;
            const isBeforeToday = item.date < todayMidnight;
            const isAfterMax = item.date > maxDate;
            const isDisabled = !item.isCurrentMonth || isBeforeToday || isAfterMax;

            const isCheckIn = occ.checkIn === dateStr;
            const isCheckOut = occ.checkOut === dateStr;
            const isSelected = isCheckIn || isCheckOut;
            
            let inRange = false;
            if (occ.checkIn && occ.checkOut) {
              inRange = dateStr > occ.checkIn && dateStr < occ.checkOut;
            } else if (occ.checkIn && hoveredDate) {
              inRange = dateStr > occ.checkIn && dateStr <= hoveredDate;
            }

            return (
              <button
                key={index}
                type="button"
                disabled={isDisabled}
                onClick={() => handleDayClick(dateStr)}
                onMouseEnter={() => !occ.checkOut && setHoveredDate(dateStr)}
                className={`py-1.5 rounded-lg flex items-center justify-center font-semibold transition-all relative ${
                  isDisabled
                    ? 'text-slate-200 dark:text-slate-700 cursor-not-allowed font-normal'
                    : isSelected
                      ? 'bg-blue-600 text-white shadow-sm z-10'
                      : inRange
                        ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 rounded-none'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-105 dark:hover:bg-slate-800'
                } ${isToday && !isSelected ? 'border border-blue-400/40 text-blue-600' : ''}`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="mt-3 border-t border-slate-100 dark:border-slate-800 pt-2 flex justify-between items-center text-[10px] text-slate-400">
          <div>
            {occ.checkIn ? (
              <span className="font-semibold text-slate-650 dark:text-slate-300">
                In: {friendlyDate(occ.checkIn)}
              </span>
            ) : 'Select check-in'}
          </div>
          <div>
            {occ.checkOut ? (
              <span className="font-semibold text-slate-650 dark:text-slate-300">
                Out: {friendlyDate(occ.checkOut)}
              </span>
            ) : (isDayUse ? 'Same day use' : 'Select check-out')}
          </div>
        </div>
      </div>
    );
  };

  const renderOccupancyPopoverContent = () => (

    <div onClick={(e) => e.stopPropagation()} className="cursor-default text-left">
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2 mb-3">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-450">Occupancy Details</span>
        <button type="button" onClick={() => setShowOccPopover(false)} className="text-xs font-semibold text-blue-650 dark:text-blue-400">Apply</button>
      </div>
      <div className="space-y-4">
        {/* Adults Counter */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">Adults</div>
            <div className="text-[10px] text-slate-450">Ages 18+</div>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => adjustAdults(-1)} className="h-8 w-8 rounded-full border border-slate-200 dark:border-slate-800 flex items-center justify-center font-bold text-slate-650 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-900">-</button>
            <span className="text-sm font-bold text-slate-800 dark:text-white w-4 text-center">{occ.adults}</span>
            <button type="button" onClick={() => adjustAdults(1)} className="h-8 w-8 rounded-full border border-slate-200 dark:border-slate-800 flex items-center justify-center font-bold text-slate-650 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-900">+</button>
          </div>
        </div>

        {/* Children Counter */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">Children</div>
            <div className="text-[10px] text-slate-450">Ages 0-17</div>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => adjustChildren(-1)} className="h-8 w-8 rounded-full border border-slate-200 dark:border-slate-800 flex items-center justify-center font-bold text-slate-650 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-900">-</button>
            <span className="text-sm font-bold text-slate-800 dark:text-white w-4 text-center">{occ.children}</span>
            <button type="button" onClick={() => adjustChildren(1)} className="h-8 w-8 rounded-full border border-slate-200 dark:border-slate-800 flex items-center justify-center font-bold text-slate-650 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-900">+</button>
          </div>
        </div>

        {/* Extra Beds Counter */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">Extra Beds</div>
            <div className="text-[10px] text-slate-450">Rollaway setup</div>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => adjustExtraBeds(-1)} className="h-8 w-8 rounded-full border border-slate-200 dark:border-slate-800 flex items-center justify-center font-bold text-slate-650 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-900">-</button>
            <span className="text-sm font-bold text-slate-800 dark:text-white w-4 text-center">{occ.extraBeds}</span>
            <button type="button" onClick={() => adjustExtraBeds(1)} className="h-8 w-8 rounded-full border border-slate-200 dark:border-slate-800 flex items-center justify-center font-bold text-slate-650 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-900">+</button>
          </div>
        </div>

        {occ.children > 0 && (
          <div className="mt-2 border-t border-slate-100 dark:border-slate-800 pt-3">
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Child ages (pricing factor)</div>
            <div className="grid grid-cols-2 gap-2 max-h-24 overflow-y-auto custom-scrollbar">
              {occ.childAges.map((age, i) => (
                <div key={i} className="flex items-center justify-between gap-1">
                  <span className="text-[10px] text-slate-500">Child {i + 1}</span>
                  <input
                    type="number"
                    min={0}
                    max={17}
                    value={age}
                    onChange={(e) => updateOcc({ childAges: occ.childAges.map((a, j) => (j === i ? Number(e.target.value) : a)) })}
                    className="w-10 rounded border border-slate-200 dark:border-slate-800 px-1 py-0.5 text-center text-xs bg-transparent"
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const today = todayStr();
  const maxCheckIn = addDaysStr(today, MAX_ADVANCE_DAYS);
  const nights = !isDayUse && occ.checkIn && occ.checkOut ? nightsBetweenStr(occ.checkIn, occ.checkOut) : 0;
  const dateError =
    !occ.checkIn
      ? null
      : occ.checkIn < today
        ? 'Check-in cannot be in the past.'
        : occ.checkIn > maxCheckIn
          ? `Check-in cannot be more than ${MAX_ADVANCE_DAYS} days ahead.`
          : isDayUse
            ? null
            : !occ.checkOut
              ? null
              : nights <= 0
                ? 'Check-out must be after check-in.'
                : nights > MAX_STAY_NIGHTS
                  ? `A single booking cannot exceed ${MAX_STAY_NIGHTS} nights.`
                  : null;
  const datesValid = !!occ.checkIn && (isDayUse || !!occ.checkOut) && !dateError;

  const destinations = useMemo(() => Array.from(new Set(rooms.map((r) => r.location))), [rooms]);
  const visibleRooms = useMemo(
    () =>
      rooms
        .filter((r) => destination === 'all' || r.location === destination)
        .filter((r) => [r.roomTypeName, r.resortName, r.location].some((f) => f.toLowerCase().includes(searchText.toLowerCase()))),
    [rooms, destination, searchText],
  );

  function nudgeDates() {
    setNotice('Please pick your check-in and check-out dates to see availability.');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    (document.getElementById('search-checkin') as HTMLInputElement | null)?.focus();
  }

  async function runSearch() {
    if (!datesValid) { nudgeDates(); return; }
    setSearching(true);
    setNotice(null);
    const resortIds = [...new Set(rooms.map((r) => r.resortId))];
    const settled = await Promise.allSettled(
      resortIds.map((id) =>
        bookingApi.searchAvailability({ resortId: id, checkIn: occ.checkIn, checkOut: isDayUse ? undefined : occ.checkOut, stayType: occ.stayType, guests: occ.adults + occ.children, adults: occ.adults, children: occ.children, childAges: occ.childAges, extraBeds: occ.extraBeds }),
      ),
    );
    const avail: Record<string, PricedRoomType> = {};
    resortIds.forEach((id, i) => {
      const s = settled[i];
      if (s.status === 'fulfilled') for (const rt of s.value) avail[roomKey(id, rt.roomTypeId)] = rt;
    });
    setSearched({ occ: { ...occ }, avail });
    setSearching(false);
  }

  function addRoom(room: BrowseRoom, priced: PricedRoomType) {
    if (!searched) return;
    const o = searched.occ;
    
    const overlappingInCart = cart.filter((l) =>
      l.roomTypeId === priced.roomTypeId &&
      datesOverlapStr(l.checkIn, l.checkOut, o.checkIn, o.checkOut)
    ).length;

    if (overlappingInCart >= priced.availableCount) {
      setNotice(`Cannot add more rooms of this type. Only ${priced.availableCount} room(s) available.`);
      return;
    }

    const key = roomKey(room.resortId, priced.roomTypeId);
    const plan = chosenPlan[key] ?? cheapestPlan(priced);
    const price = priced.plans.find((p) => p.plan === plan) ?? priced.plans[0];
    setCart((c) => [
      ...c,
      {
        key: `${priced.roomTypeId}-${plan}-${Math.round(Math.random() * 1e6)}`,
        resortId: room.resortId,
        resortName: room.resortName,
        roomTypeId: priced.roomTypeId,
        roomTypeName: priced.roomTypeName,
        plan,
        stayType: o.stayType,
        checkIn: o.checkIn,
        checkOut: o.stayType === 'DAY_USE' ? o.checkIn : o.checkOut,
        adults: o.adults,
        children: o.children,
        childAges: o.childAges,
        extraBeds: o.extraBeds,
        nights: priced.nights,
        priceTotal: price.priceTotal,
      },
    ]);
    setNotice(`Added ${priced.roomTypeName} at ${room.resortName} to booking.`);
  }

  const removeLine = (key: string) => setCart((c) => c.filter((l) => l.key !== key));
  const cartTotal = cart.reduce((s, l) => s + l.priceTotal, 0);
  const availableCount = searched ? visibleRooms.filter((r) => searched.avail[roomKey(r.resortId, r.roomTypeId)]).length : 0;

  async function confirmGroup() {
    setError(null);
    setBusy(true);
    try {
      const guestPayload = { name: guest.name, phone: guest.phone, email: guest.email, idType: guest.idType || undefined, idNumber: guest.idNumber || undefined };
      const res = await bookingApi.createGroupBooking(
        cart.map((l) => ({ resortId: l.resortId, roomTypeId: l.roomTypeId, checkIn: l.checkIn, checkOut: l.stayType === 'DAY_USE' ? undefined : l.checkOut, stayType: l.stayType, guests: l.adults + l.children, adults: l.adults, children: l.children, childAges: l.childAges.length ? l.childAges : undefined, extraBeds: l.extraBeds, plan: l.plan, resaleMarkupPct: overrideValid && parsedOverride !== null ? parsedOverride : undefined, guest: guestPayload })),
      );
      setResult(res);
      setCart([]);
      refreshAll();
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(false);
    }
  }

  async function payGroup() {
    if (!result?.groupId) return;
    setBusy(true);
    try {
      const res = await bookingApi.payGroup(result.groupId);
      setResult({ groupId: result.groupId, bookings: res.bookings });
      refreshAll();
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(false);
    }
  }

  function closeCheckout() {
    setIsCartOpen(false);
    setResult(null);
    setGuest({ name: '', phone: '', email: '', idType: '', idNumber: '' });
    setResalePctInput('');
    setError(null);
  }

  function renderCheckoutPanel() {
    const awaitingPayment = result?.bookings.some((b) => b.state === 'AWAITING_PAYMENT');
    const isFormValid = guest.name.trim() !== '' && guest.phone.trim() !== '' && guest.email.trim() !== '';

    return (
      <div className="space-y-4">
        {error && (
          <div className="rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 px-3 py-2.5 text-xs text-red-755 dark:text-red-400">
            {error}
          </div>
        )}

        {result ? (
          <div className="space-y-4 animate-fade-up">
            <div className="flex flex-col items-center text-center p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30">
              <div className="p-2.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 mb-2">
                <Icons.shield className="h-6 w-6" />
              </div>
              <h3 className="text-sm font-bold text-emerald-800 dark:text-emerald-400">
                {awaitingPayment ? 'Booking Held Successfully' : 'Booking Confirmed!'}
              </h3>
              <p className="text-xs text-emerald-600 dark:text-emerald-500 mt-1 leading-relaxed">
                {awaitingPayment ? 'Rooms held. Please pay to finalize reservation.' : 'All bookings pushed directly to CRS.'}
              </p>
            </div>

            <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
              {result.bookings.map((b) => (
                <div key={b.id} className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 p-3 text-xs flex justify-between items-center gap-3">
                  <div className="min-w-0">
                    <div className="font-bold text-slate-800 dark:text-slate-200 truncate">{b.resortName}</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">{b.roomTypeName}</div>
                    <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                      {b.ratePlan} · {b.checkIn.slice(0, 10)} → {b.checkOut.slice(0, 10)}
                      {b.crsBookingRef && ` · Ref: ${b.crsBookingRef}`}
                    </div>
                  </div>
                  <div className="font-bold text-slate-700 dark:text-slate-350 shrink-0">{inr(Number(b.agencyPrice))}</div>
                </div>
              ))}
            </div>

            {result.groupId && (
              <div className="text-[10px] text-slate-450 dark:text-slate-550 text-center">
                Group ID: <span className="font-mono font-semibold">{result.groupId.slice(0, 12)}</span>
              </div>
            )}

            <div className="flex flex-col gap-2 pt-2">
              {awaitingPayment ? (
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={payGroup}
                  className="w-full justify-center py-2.5 font-bold shadow-md rounded-xl"
                >
                  {busy ? 'Processing payment...' : `Pay Total: ${inr(result.bookings.reduce((s, b) => s + Number(b.agencyPrice), 0))}`}
                </Button>
              ) : (
                <Button variant="primary" onClick={closeCheckout} className="w-full justify-center py-2.5 font-bold rounded-xl">
                  Done
                </Button>
              )}
              <Link to={myBookingsPath} className="w-full">
                <Button variant="secondary" className="w-full justify-center py-2.5 rounded-xl">
                  View My Bookings
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-450 dark:text-slate-500">Selected Rooms</span>
              <button onClick={() => setCart([])} className="text-xs font-bold text-red-500 hover:underline">Clear all</button>
            </div>

            <div className="space-y-2 max-h-52 overflow-y-auto custom-scrollbar pr-1">
              {cart.map((l) => (
                <div key={l.key} className="rounded-xl border border-slate-100 dark:border-slate-850 bg-slate-50/70 dark:bg-slate-900/40 p-3 text-xs flex justify-between items-start">
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-slate-800 dark:text-slate-200 truncate">{l.resortName}</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-450 mt-0.5 truncate">{l.roomTypeName}</div>
                    <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 truncate">
                      {l.stayType === 'DAY_USE' ? `Day Use · ${l.checkIn}` : `${PLAN_LABEL[l.plan]} · ${l.checkIn} → ${l.checkOut}`}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {l.adults + l.children} guest{l.adults + l.children === 1 ? '' : 's'} · {l.nights} night{l.nights === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 ml-2 shrink-0">
                    <span className="font-bold text-slate-700 dark:text-slate-350">{inr(l.priceTotal)}</span>
                    <button onClick={() => removeLine(l.key)} className="text-[10px] font-medium text-slate-400 hover:text-red-500 transition">Remove</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between rounded-xl bg-slate-100 dark:bg-slate-950 px-4 py-3 text-xs font-bold text-slate-800 dark:text-slate-200 border border-slate-150 dark:border-slate-800/40">
              <span>Total Price</span>
              <span className="text-sm font-extrabold text-blue-600 dark:text-blue-400">{inr(cartTotal)}</span>
            </div>

            {/* B2B resale layer — the agent's own markup and profit preview. */}
            <div className="rounded-xl border border-slate-150 dark:border-slate-800/40 bg-slate-50/70 dark:bg-slate-900/40 px-4 py-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-450 dark:text-slate-500">Your Markup</span>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min={0}
                    max={500}
                    step="0.5"
                    value={resalePctInput}
                    onChange={(e) => setResalePctInput(e.target.value)}
                    placeholder={String(defaultResalePct)}
                    className="w-20 py-1 text-xs text-right rounded-lg"
                  />
                  <span className="text-xs font-bold text-slate-500">%</span>
                </div>
              </div>
              {!overrideValid && (
                <div className="text-[10px] text-red-500 font-medium">Markup must be between 0 and 500.</div>
              )}
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500 dark:text-slate-400">Customer price</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">{inr(cartTotal * (1 + effectiveResalePct / 100))}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500 dark:text-slate-400">Your profit</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">{inr(cartTotal * (effectiveResalePct / 100))}</span>
              </div>
              <div className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
                You pay the total price above; your customer pays the customer price. Blank = agency default ({defaultResalePct}%).
              </div>
            </div>

            <div className="border-t border-slate-150 dark:border-slate-800 pt-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-450 dark:text-slate-500">Lead Guest Details</span>
              <div className="grid grid-cols-1 gap-2.5 mt-2">
                <Field label="Guest Name *">
                  <Input
                    value={guest.name}
                    onChange={(e) => setGuest({ ...guest, name: e.target.value })}
                    placeholder="Full name"
                    className="w-full py-1.5 text-xs rounded-lg"
                    required
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Mobile *">
                    <Input
                      value={guest.phone}
                      onChange={(e) => setGuest({ ...guest, phone: e.target.value })}
                      placeholder="+91..."
                      className="w-full py-1.5 text-xs rounded-lg"
                      required
                    />
                  </Field>
                  <Field label="Email *">
                    <Input
                      type="email"
                      value={guest.email}
                      onChange={(e) => setGuest({ ...guest, email: e.target.value })}
                      placeholder="guest@example.com"
                      className="w-full py-1.5 text-xs rounded-lg"
                      required
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="ID Type">
                    <Select
                      value={guest.idType}
                      onChange={(v) => setGuest({ ...guest, idType: v })}
                      options={[
                        { value: '', label: 'None' },
                        { value: 'Aadhaar', label: 'Aadhaar' },
                        { value: 'Passport', label: 'Passport' },
                        { value: 'Driving Licence', label: 'DL' },
                        { value: 'Voter ID', label: 'Voter ID' },
                      ]}
                    />
                  </Field>
                  <Field label="ID Number">
                    <Input
                      value={guest.idNumber}
                      onChange={(e) => setGuest({ ...guest, idNumber: e.target.value })}
                      placeholder="Last 4 digits"
                      className="w-full py-1.5 text-xs rounded-lg"
                    />
                  </Field>
                </div>
              </div>
            </div>

            <Button
              variant="primary"
              disabled={busy || cart.length === 0 || !isFormValid}
              onClick={confirmGroup}
              className="w-full justify-center py-3 font-bold shadow-md rounded-xl mt-2 disabled:opacity-40"
            >
              {busy ? 'Processing Booking...' : `Book ${cart.length} Room${cart.length === 1 ? '' : 's'}`}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title="Search & Book"
        subtitle="Search destinations, check live inventories, and secure bookings instantly."
        actions={<Link to={myBookingsPath}><Button variant="secondary" className="rounded-xl font-semibold">My Bookings</Button></Link>}
      />

      <div className="mb-4 rounded-2xl border border-slate-200/50 bg-white dark:border-slate-800/40 p-4 shadow-sm relative">
        <div className="mb-4 flex items-center justify-between border-b border-slate-100 dark:border-slate-800/40 pb-3">
          <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-1">
            {(['OVERNIGHT', 'DAY_USE'] as StayType[]).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => updateOcc({ stayType: st })}
                className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition-all ${
                  occ.stayType === st
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {st === 'OVERNIGHT' ? 'Overnight stay' : 'Day use'}
              </button>
            ))}
          </div>
          <div className="text-[11px] text-slate-400 dark:text-slate-500 font-semibold tracking-wider uppercase">
            {isDayUse ? 'Same-day check-in' : 'Standard check-in'}
          </div>
        </div>
           {/* DESKTOP SEARCH CONSOLE */}
        <div className="hidden lg:flex items-center justify-between bg-white dark:bg-slate-950 border border-slate-200/60 dark:border-slate-850 rounded-2xl shadow-xs p-1.5 divide-x divide-slate-150 dark:divide-slate-800/50 relative">
          
          {/* Destination Segment */}
          <div className="relative flex-1 px-4 py-1 hover:bg-slate-50 dark:hover:bg-slate-900/60 rounded-xl cursor-pointer">
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Destination</span>
            <div className="font-semibold text-slate-850 dark:text-slate-200 text-xs sm:text-sm mt-0.5 truncate">
              {destination === 'all' ? 'All Destinations' : destination}
            </div>
            <select
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            >
              <option value="all">All Destinations</option>
              {destinations.map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
          </div>

          {/* Check-in Date Segment */}
          <div className="relative flex-1 px-4 py-1 hover:bg-slate-50 dark:hover:bg-slate-900/60 rounded-xl cursor-pointer" onClick={() => { setShowCalendarPopover(!showCalendarPopover); setShowOccPopover(false); }}>
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{isDayUse ? 'Stay Date' : 'Check-in'}</span>
            <div className="font-semibold text-slate-850 dark:text-slate-255 text-xs sm:text-sm mt-0.5 truncate">
              {occ.checkIn ? friendlyDate(occ.checkIn) : 'Choose date'}
            </div>
            
            {showCalendarPopover && (
              <div className="absolute left-0 top-full mt-2.5 z-50" onClick={(e) => e.stopPropagation()}>
                {renderCalendar()}
              </div>
            )}
          </div>

          {/* Check-out Date Segment */}
          <div className="relative flex-1 px-4 py-1 hover:bg-slate-50 dark:hover:bg-slate-900/60 rounded-xl cursor-pointer" onClick={() => { setShowCalendarPopover(!showCalendarPopover); setShowOccPopover(false); }}>
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Check-out</span>
            <div className="font-semibold text-slate-855 dark:text-slate-255 text-xs sm:text-sm mt-0.5 truncate">
              {isDayUse ? 'Same Day Use' : (occ.checkOut ? friendlyDate(occ.checkOut) : 'Choose date')}
            </div>
          </div>

          {/* Guests & Beds Segment */}
          <div className="relative flex-1 px-4 py-1 hover:bg-slate-50 dark:hover:bg-slate-900/60 rounded-xl cursor-pointer" onClick={() => { setShowOccPopover(!showOccPopover); setShowCalendarPopover(false); }}>
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Guests &amp; Beds</span>
            <div className="font-semibold text-slate-800 dark:text-slate-200 text-xs sm:text-sm mt-0.5 truncate">
              {occ.adults + occ.children} Guest{occ.adults + occ.children === 1 ? '' : 's'} · {occ.extraBeds} Bed{occ.extraBeds === 1 ? '' : 's'}
            </div>
            
            {showOccPopover && (
              <div className="absolute right-0 top-full mt-2.5 z-50 w-72 rounded-2xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-950 p-4 shadow-xl animate-fade-up">
                {renderOccupancyPopoverContent()}
              </div>
            )}
          </div>

          {/* Search Button Segment */}
          <div className="px-3 shrink-0">
            <Button
              variant="primary"
              disabled={searching}
              onClick={() => { runSearch(); setShowOccPopover(false); setShowCalendarPopover(false); }}
              className="rounded-xl px-5 py-2 font-bold shadow-sm text-xs flex items-center gap-1.5 h-[38px]"
            >
              <Icons.search className="h-4 w-4" />
              {searching ? 'Checking…' : 'Search'}
            </Button>
          </div>

        </div>

        {/* MOBILE VIEWPORTS SEARCH CONSOLE */}
        <div className="lg:hidden flex flex-col gap-3">
          {/* Destination Slot */}
          <div className="relative flex items-center justify-between rounded-xl border border-slate-205 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 px-4 py-2.5 cursor-pointer">
            <div>
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Destination</span>
              <div className="font-semibold text-slate-850 dark:text-slate-200 text-sm mt-0.5">
                {destination === 'all' ? 'All Destinations' : destination}
              </div>
            </div>
            <Icons.chevronDown className="h-4 w-4 text-slate-400" />
            <select
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            >
              <option value="all">All Destinations</option>
              {destinations.map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
          </div>

          {/* Dates grid */}
          <div className="relative grid grid-cols-2 gap-3">
            <div className="relative rounded-xl border border-slate-205 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 px-4 py-2.5 cursor-pointer" onClick={() => { setShowCalendarPopover(!showCalendarPopover); setShowOccPopover(false); }}>
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{isDayUse ? 'Stay Date' : 'Check-in'}</span>
              <div className="font-semibold text-slate-855 dark:text-slate-250 text-xs sm:text-sm mt-0.5">
                {occ.checkIn ? friendlyDate(occ.checkIn) : 'Choose date'}
              </div>
            </div>

            <div className="relative rounded-xl border border-slate-205 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 px-4 py-2.5 cursor-pointer" onClick={() => { setShowCalendarPopover(!showCalendarPopover); setShowOccPopover(false); }}>
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Check-out</span>
              <div className="font-semibold text-slate-855 dark:text-slate-250 text-xs sm:text-sm mt-0.5">
                {isDayUse ? 'Same Day' : (occ.checkOut ? friendlyDate(occ.checkOut) : 'Choose date')}
              </div>
            </div>

            {showCalendarPopover && (
              <div className="absolute left-0 right-0 top-full mt-2.5 z-50 flex justify-center" onClick={(e) => e.stopPropagation()}>
                {renderCalendar()}
              </div>
            )}
          </div>

          {/* Guests & Beds dropdown wrapper */}
          <div className="relative flex items-center justify-between rounded-xl border border-slate-205 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 px-4 py-2.5 cursor-pointer" onClick={() => { setShowOccPopover(!showOccPopover); setShowCalendarPopover(false); }}>
            <div>
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Guests &amp; Beds</span>
              <div className="font-semibold text-slate-855 dark:text-slate-200 text-sm mt-0.5">
                {occ.adults + occ.children} Guest{occ.adults + occ.children === 1 ? '' : 's'} · {occ.extraBeds} Bed{occ.extraBeds === 1 ? '' : 's'}
              </div>
            </div>
            <Icons.chevronDown className="h-4 w-4 text-slate-400" />
            
            {showOccPopover && (
              <div className="absolute left-0 right-0 top-full mt-2.5 z-50 rounded-2xl border border-slate-200 dark:border-slate-800/60 bg-white dark:bg-slate-950 p-4 shadow-xl animate-fade-up">
                {renderOccupancyPopoverContent()}
              </div>
            )}
          </div>

          {/* Search Trigger Button */}
          <Button variant="primary" type="button" disabled={searching} onClick={() => { runSearch(); setShowOccPopover(false); setShowCalendarPopover(false); }} className="w-full justify-center py-2.5 font-bold shadow-sm mt-1 rounded-xl">
            <Icons.search className="h-4 w-4" />
            {searching ? 'Checking Availability…' : 'Search available rooms'}
          </Button>
        </div>

        {dateError && <p className="mt-3 rounded-xl bg-red-50 dark:bg-red-950/20 px-3 py-2 text-xs text-red-655 border border-red-100 dark:border-red-900/30">{dateError}</p>}
      </div>

      <div className="mb-4 flex flex-col sm:flex-row items-center justify-between gap-3 bg-white dark:bg-slate-900/30 border border-slate-200/40 dark:border-slate-800/40 p-3 rounded-2xl shadow-sm">
        <div className="w-full sm:w-80 relative flex items-center">
          <Input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Filter hotel or room type..." className="w-full pr-8 rounded-xl" />
          {searchText && (
            <button onClick={() => setSearchText('')} className="absolute right-3.5 text-slate-400 hover:text-slate-600 text-xs">Clear</button>
          )}
        </div>
        <div className="text-xs font-semibold text-slate-400 dark:text-slate-500 shrink-0">
          {searched
            ? `${availableCount} of ${visibleRooms.length} rooms available · ${searched.occ.stayType === 'DAY_USE' ? `Day use · ${searched.occ.checkIn}` : `${searched.occ.checkIn} → ${searched.occ.checkOut}`}`
            : `${visibleRooms.length} room types cataloged · Select dates to view rates`}
        </div>
      </div>

      {notice && <p className="mb-4 rounded-xl border border-blue-100 dark:border-blue-900/30 bg-blue-50/50 dark:bg-blue-950/20 px-4 py-2.5 text-xs text-blue-700 dark:text-blue-400">{notice}</p>}

      {/* Main double-column desktop / collapsible mobile panel workflow */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* Left Side: Room list */}
        <div className={`w-full transition-all duration-300 ${cart.length > 0 ? 'lg:w-[65%]' : 'w-full'}`}>
          {isLoading || searching ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="animate-pulse rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"><div className="h-32 rounded-t-2xl bg-slate-100 dark:bg-slate-800" /><div className="space-y-2.5 p-4"><div className="h-4 w-2/3 rounded bg-slate-100 dark:bg-slate-800" /><div className="h-3 w-1/2 rounded bg-slate-100 dark:bg-slate-800" /></div></div>
              ))}
            </div>
          ) : visibleRooms.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center text-sm text-slate-500 dark:text-slate-400">
              <Icons.search className="h-8 w-8 mx-auto text-slate-300 mb-2" />
              No room types match your search filters.
            </div>
          ) : (
            <div className={`grid grid-cols-1 gap-4 pb-28 lg:pb-8 ${cart.length > 0 ? 'sm:grid-cols-1 xl:grid-cols-2' : 'sm:grid-cols-2 xl:grid-cols-3'}`}>
              {visibleRooms.map((r, i) => {
                const key = roomKey(r.resortId, r.roomTypeId);
                const priced = searched?.avail[key];
                const unavailable = !!searched && !priced;
                const plan = priced ? chosenPlan[key] ?? cheapestPlan(priced) : 'EP';
                const planPrice = priced?.plans.find((p) => p.plan === plan) ?? priced?.plans[0];
                
                const overlappingInCart = searched && priced
                  ? cart.filter((l) =>
                      l.roomTypeId === priced.roomTypeId &&
                      datesOverlapStr(l.checkIn, l.checkOut, searched.occ.checkIn, searched.occ.checkOut)
                    ).length
                  : 0;
                const isLimitReached = priced ? overlappingInCart >= priced.availableCount : false;
                
                return (
                  <div key={key} className={`animate-fade-up overflow-hidden rounded-2xl border bg-white dark:bg-slate-900 transition-all duration-300 ${unavailable ? 'border-slate-200 dark:border-slate-800/60 opacity-55' : 'border-slate-200 dark:border-slate-800/40 hover:shadow-md hover:-translate-y-0.5'}`} style={{ animationDelay: `${i * 30}ms` }}>
                    {/* Header Image Illustration */}
                    <div className={`relative flex h-32 items-center justify-center bg-gradient-to-br ${gradientFor(r.roomTypeId)} text-blue-500 dark:text-blue-400`}>
                      <Icons.resorts className="h-10 w-10 opacity-80" />
                      <span className="absolute right-3 top-3">
                        {priced ? <Badge tone={priced.availableCount <= 3 ? 'amber' : 'green'}>{priced.availableCount} available</Badge>
                          : unavailable ? <Badge tone="red">Sold out</Badge>
                            : <Badge tone="slate">Max Sleeps: {r.maxOccupancy}</Badge>}
                      </span>
                    </div>

                    <div className="p-4">
                      <div className="font-bold text-slate-800 dark:text-white leading-tight">{r.roomTypeName}</div>
                      <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">{r.resortName} · {r.location}</div>

                      {priced ? (
                        <>
                          {/* Segmented plan pricing selector */}
                          <div className="mt-4 flex gap-1 bg-slate-50 dark:bg-slate-950 p-1 rounded-xl">
                            {sortedPlans(priced).map((p) => {
                              const on = p.plan === plan;
                              return (
                                <button
                                  key={p.plan}
                                  onClick={() => setChosenPlan((s) => ({ ...s, [key]: p.plan }))}
                                  className={`flex-1 rounded-lg py-1 px-1 text-center transition-all ${
                                    on
                                      ? 'bg-blue-600 text-white shadow-sm font-semibold'
                                      : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300'
                                  }`}
                                >
                                  <div className="text-[9px] uppercase tracking-wide">{p.plan}</div>
                                  <div className="text-[10px] font-bold mt-0.5">{inr(p.priceTotal)}</div>
                                </button>
                              );
                            })}
                          </div>
                          
                          <div className="mt-4 flex items-end justify-between border-t border-slate-100 dark:border-slate-800 pt-3">
                            <div>
                              <div className="text-base font-extrabold text-slate-800 dark:text-white">{inr(planPrice!.priceTotal)}</div>
                              <div className="text-[10px] text-slate-400 dark:text-slate-500">
                                {priced.nights === 0 ? 'Day use same-day' : `${inr(planPrice!.pricePerNight)}/night · ${priced.nights} night${priced.nights === 1 ? '' : 's'}`}
                              </div>
                            </div>
                            <Button variant={isLimitReached ? "secondary" : "primary"} disabled={isLimitReached} onClick={() => addRoom(r, priced)} className="rounded-xl px-4 py-2 font-bold text-xs shadow-sm">
                              {isLimitReached ? 'Max added' : '+ Add room'}
                            </Button>
                          </div>
                        </>
                      ) : unavailable ? (
                        <div className="mt-4 flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-3">
                          <div className="text-[11px] text-slate-400">Unsuited dates selected.</div>
                          <Button variant="secondary" onClick={nudgeDates} className="rounded-xl text-xs py-1.5 px-3">Try other dates</Button>
                        </div>
                      ) : (
                        <div className="mt-4 flex items-end justify-between border-t border-slate-100 dark:border-slate-800 pt-3">
                          <div>
                            <div className="text-[9px] text-slate-400 uppercase tracking-wider">Indicative rate</div>
                            <div className="text-base font-extrabold text-slate-850 dark:text-white">{inr(r.indicativePricePerNight)}</div>
                            <div className="text-[9px] text-slate-400">per night base</div>
                          </div>
                          <Button variant="primary" onClick={() => (datesValid ? runSearch() : nudgeDates())} className="rounded-xl text-xs font-bold py-2 px-3.5 shadow-sm">
                            {datesValid ? 'Check price' : 'Select dates'}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Side: Desktop sticky sidebar checkout panel */}
        {cart.length > 0 && (
          <aside className="hidden lg:block w-[35%] sticky top-20 bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800/40 rounded-2xl p-5 shadow-sm space-y-4">
            {renderCheckoutPanel()}
          </aside>
        )}

        {/* Desktop display of results card (if checkout success is set, but cart is empty) */}
        {!cart.length && result && (
          <aside className="hidden lg:block w-[35%] sticky top-20 bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800/40 rounded-2xl p-5 shadow-sm">
            {renderCheckoutPanel()}
          </aside>
        )}
      </div>

      {/* Mobile Sticky Floating Review Bar (sits above glass bottom navigation) */}
      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-20 lg:hidden z-40 px-4">
          <div className="glass-nav mx-auto max-w-md rounded-2xl px-4 py-3 shadow-lg flex items-center justify-between gap-3 border border-white/20 dark:border-slate-800/50">
            <div>
              <div className="text-xs font-bold text-slate-850 dark:text-white">
                {cart.length} room{cart.length === 1 ? '' : 's'} Selected
              </div>
              <div className="text-[10px] text-slate-500 font-medium">{inr(cartTotal)} total value</div>
            </div>
            <Button variant="primary" onClick={() => setIsCartOpen(true)} className="rounded-xl px-4 py-2 font-bold text-xs shadow-md">
              Review &amp; Book →
            </Button>
          </div>
        </div>
      )}

      {/* Mobile Sliding Bottom Sheet drawer */}
      {isCartOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-xs" onClick={() => setIsCartOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-3xl bg-white dark:bg-slate-950 shadow-2xl animate-slide-up border-t border-slate-200/50 dark:border-slate-850/60 flex flex-col pb-6">
            <div className="sticky top-0 bg-white dark:bg-slate-950 px-5 py-4 border-b border-slate-100 dark:border-slate-800/50 flex items-center justify-between z-10">
              <div>
                <h3 className="text-sm font-bold text-slate-800 dark:text-white">Checkout Details</h3>
                <span className="text-[11px] text-slate-450 dark:text-slate-500 font-medium">{cart.length} room{cart.length === 1 ? '' : 's'} · {inr(cartTotal)}</span>
              </div>
              <button onClick={() => setIsCartOpen(false)} className="text-xs font-bold text-slate-400 hover:text-slate-650">
                Close
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto flex-1 custom-scrollbar">
              {renderCheckoutPanel()}
            </div>
          </div>
        </div>
      )}

      {/* Mobile display of checkout success if cart is empty but success results are set */}
      {!cart.length && result && !isCartOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-955/40" onClick={closeCheckout} />
          <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-white dark:bg-slate-950 p-5 shadow-2xl animate-slide-up">
            <div className="flex justify-between items-center mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Success Details</span>
              <button onClick={closeCheckout} className="text-xs font-bold text-slate-400">Close</button>
            </div>
            {renderCheckoutPanel()}
          </div>
        </div>
      )}
    </AppShell>
  );
}

function extractError(err: unknown): string {
  return (err as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'Something went wrong';
}
