-- AxisRooms is retired; the CRS is the upstream reservation system (spec D1).
-- RENAME (not drop+add) so any existing reservation refs are preserved.
ALTER TABLE "Booking" RENAME COLUMN "axisRoomsRef" TO "crsBookingRef";
