# CRS API Requirements — Parakkat B2B Booking Portal

**From:** Parakkat (B2B travel-agent booking portal team)
**To:** CRS provider / management company
**Date:** 2026-08-10
**Purpose:** The Parakkat B2B portal lets approved travel agencies search our properties, check availability, and book rooms. The CRS is the system of record for inventory and bookings, so the portal must read data from the CRS and create bookings in it. Today we only push financial events to your ingest endpoint; this document lists the APIs we additionally need, and the questions we need answered before integration work can start.

Any request/response format is fine as long as it is documented — the JSON below shows the *information* we need, not a format you must copy.

---

## A. Read APIs (portal fetches data from the CRS)

### A1. List properties
All hotels/resorts that should be sellable in the portal. Properties added in the CRS later should appear automatically.

```json
[{ "propertyId": "P001", "name": "Parakkat Nature Resort", "location": "Munnar" }]
```

### A2. List room types for a property
Including occupancy rules and meal plans, so the portal can price extra adults/children correctly.

```json
[{
  "roomTypeId": "RT01",
  "name": "Deluxe Pool Villa",
  "baseOccupancy": 2, "maxAdults": 3, "maxChildren": 2, "maxOccupancy": 4,
  "extraAdultCharge": 1500, "childCharge": 800, "extraBedCharge": 1000,
  "mealPlans": ["EP", "CP", "MAP", "AP"]
}]
```

### A3. Availability + rates calendar
For a property and date range: per room type, per date — rooms available, price per meal plan, and booking restrictions.

```json
{
  "propertyId": "P001", "from": "2026-09-01", "to": "2026-09-05",
  "roomTypes": [{
    "roomTypeId": "RT01",
    "days": [{
      "date": "2026-09-01",
      "availableRooms": 4,
      "rates": { "EP": 8000, "CP": 9000, "MAP": 10500, "AP": 12000 },
      "minNights": 1, "closedToArrival": false, "closedToDeparture": false, "stopSell": false
    }]
  }]
}
```

Questions:
- Are the rates **net rates to Parakkat** (we add our B2B pricing on top)? Taxes included or separate?
- Do you support day-use (same-day) bookings as a separate product?

## B. Booking APIs (portal writes to the CRS)

### B1. Create booking
Must be **idempotent**: we send a unique reference (`clientRef`); if the same request is retried (network timeout), it must not create a duplicate booking. Response must return the CRS booking number.

```json
{
  "clientRef": "PKT-B2B-7f3a91c2",
  "propertyId": "P001",
  "checkIn": "2026-09-01", "checkOut": "2026-09-03",
  "rooms": [{ "roomTypeId": "RT01", "mealPlan": "CP", "adults": 2, "children": 1, "childAges": [7] }],
  "guestName": "Lead guest name", "agencyName": "Demo Travels Pvt Ltd",
  "notes": "Booked via Parakkat B2B portal"
}
```
Response: `{ "crsBookingRef": "CRS-2026-000123", "status": "CONFIRMED" }`

### B2. Cancel booking
By CRS booking reference. Question: are there cancellation windows/charges the API reports back?

### B3. Read booking status
Given one or more CRS booking references, return current status (`CONFIRMED / MODIFIED / CANCELLED / NO_SHOW / CHECKED_IN / CHECKED_OUT`) and current dates/rooms/amount. We poll this periodically as a fallback if webhooks (C) are unavailable.

## C. Webhooks (CRS notifies the portal of changes) — preferred

When a booking that came from the portal is **cancelled or modified inside the CRS**, we need the portal to know. Preferred: the CRS calls our HTTPS endpoint:

```
POST https://<our-portal-domain>/api/webhooks/crs
{ "event": "booking.cancelled", "crsBookingRef": "CRS-2026-000123", "occurredAt": "...", "details": { } }
```

- We support HMAC signature verification (shared secret) — same pattern we use with other partners.
- If webhooks are not possible, we will poll B3 every 5 minutes; please confirm B3 can handle that.

## D. Access, security, environments

1. **Authentication** — API key? Bearer token? IP allowlisting? Please specify.
2. **Sandbox / test environment** — strongly requested, so we never test against live inventory. If none exists, a test property in production is an acceptable minimum.
3. **Rate limits** — how many requests/minute may we send (search traffic can be bursty)?
4. **Health endpoint** — a simple "are you up" URL; our portal blocks new booking commits when the CRS is unreachable.
5. **Data freshness** — is availability real-time, or cached/synced on an interval?

## E. What already works (unchanged)

The portal already pushes financial events (booking obligations, payments, refunds, cancellation charges) to your ingest endpoint with bearer-token auth. That flow stays as-is.

## F. What we need from you to start

| # | Item |
|---|------|
| 1 | API documentation covering sections A–B (and C if supported) |
| 2 | Credentials for the sandbox/test environment |
| 3 | Auth details and rate limits (section D) |
| 4 | A technical contact for integration questions |
| 5 | Confirmation whether webhooks (C) are supported |

**Timeline ask:** even partial documentation (A1–A3 first) lets us start; booking APIs (B) can follow.
