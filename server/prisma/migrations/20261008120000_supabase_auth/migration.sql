-- Supabase Auth now owns credentials and sessions (server/src/lib/identity). The portal's User row
-- keeps the same id as the Auth account; the password hash moves into Supabase Auth.
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- Auth sessions that passed the EMAIL second factor (TOTP sessions carry aal2 in their token).
CREATE TABLE "MfaSession" (
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfaSession_pkey" PRIMARY KEY ("sessionId")
);

CREATE INDEX "MfaSession_userId_idx" ON "MfaSession"("userId");

ALTER TABLE "MfaSession" ADD CONSTRAINT "MfaSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same posture as 20260710160000_enable_rls: Prisma (postgres role) bypasses RLS; the PostgREST
-- API roles get nothing.
ALTER TABLE "MfaSession" ENABLE ROW LEVEL SECURITY;
