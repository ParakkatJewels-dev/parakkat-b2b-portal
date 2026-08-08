# AxisRooms API — What We Need to Go Live

The B2B booking portal treats **AxisRooms as the source of truth** for resorts, room
types, availability, rate plans, and restrictions, and pushes reservation **writes**
on booking / reversals on cancel. Our integration interface (`server/src/lib/axisrooms`)
is already built and typed; the only missing piece is the **live HTTP client**
(`LiveAxisRoomsClient`), which is blocked on the details below.

Status: `AXISROOMS_PROVIDER=mock` (portal runs on an in-memory mock). Flip to `live`
only once these are answered and the client is wired.

---

## 🔴 First, the decision that shapes everything (Decision D6)

**Does our AxisRooms account support WRITING reservations back** — i.e. pushing a
confirmed B2B booking so it decrements the same inventory the Simplotel IBE and OTAs
sell from — **or is the API read-only?**

This determines whether the portal can prevent overbooking across channels, or whether
we need a different reconciliation approach. Everything else is secondary to this.

---

## Access & auth
1. Sandbox/test base URL **and** production base URL.
2. Credentials (API key / client id+secret / etc.) for both environments.
3. Auth scheme — API-key header? OAuth2 client-credentials? Signed requests?
4. Rate limits / throttling we should respect.

## Identifiers (mapping)
5. Parakkat's **real AxisRooms property ID** (portal currently uses seed IDs).
6. The **room-type IDs** for all 18 categories, and the **rate-plan codes** as AxisRooms
   represents them (we model EP / CP / MAP / AP).

## Reads we need (ARI pull)
7. **Availability** — available room counts + rates for a resort, by date range and
   occupancy (adults + children). → `searchAvailability`, `listRoomTypes`, `getRoomType`
8. **Rates & restrictions** — per-date **net** rates by rate plan, occupancy/extra-bed
   pricing, and restrictions (min/max length of stay, closed-to-arrival, closed-to-
   departure, stop-sell); plus **day-use** rates if offered. → `getRoomTypeRates`
9. Are rates returned **net** (pre-commission) or **sell**? The portal applies the
   agency markup on the net rate — we must not double-count.

## Writes we need
10. **Create reservation** endpoint — request/response shape, whether it accepts an
    **idempotency key** (we send our booking `correlationId`), support for **multi-room**
    bookings, and the **reference** it returns. → `createReservation`
11. **Cancel reservation** endpoint — how to reverse/cancel a pushed booking by that
    reference. → `cancelReservation`

## Operational
12. A lightweight **health/ping** endpoint we can use as a liveness check before
    allowing a booking (we block, we don't queue, on downtime). → `healthCheck`
13. Do you **push** ARI changes to us (webhook — give us the payload + signature
    scheme), or do we **poll**? If webhook, what's the retry behaviour?
14. Sandbox test data / a walkthrough contact for integration testing.

---

*Once 1–14 are answered, wiring `LiveAxisRoomsClient` is mechanical — every method
already has its exact input/output types defined in `axisrooms.types.ts`.*
