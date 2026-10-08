-- Supabase advisor: rls_disabled_in_public.
--
-- Supabase exposes the `public` schema through PostgREST (anon / authenticated /
-- service_role API keys). This app talks to Postgres ONLY through Prisma using
-- the `postgres` role, which owns the tables and has BYPASSRLS — so enabling RLS
-- with NO policies is safe: Prisma is unaffected, while the anon/authenticated
-- PostgREST path is denied by default (deny-all). This closes the data-exposure
-- surface without touching application behaviour.
--
-- RLS is not modelled in schema.prisma, so this does not create drift.

ALTER TABLE "public"."User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."RefreshToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."OtpCode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Agency" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."AgencyApplication" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Verification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Document" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."CommercialConfiguration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Booking" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Invoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."CrsOutboxEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."RoomTypePricing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."RatePlanRate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."CreditNote" ENABLE ROW LEVEL SECURITY;

-- Prisma's migration bookkeeping table (also flagged by the advisor).
-- It exists in the real migration target, but not in Prisma's shadow database
-- while `prisma migrate dev` replays migrations. Guard it so dev migrations
-- can validate cleanly against Supabase.
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    ALTER TABLE "public"."_prisma_migrations" ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;
