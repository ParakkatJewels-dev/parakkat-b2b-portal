-- The browser's address and user agent for each Supabase Auth session. Supabase itself records
-- the API's address, because the API performs the sign-in on the browser's behalf.
CREATE TABLE "AuthSessionInfo" (
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSessionInfo_pkey" PRIMARY KEY ("sessionId")
);

CREATE INDEX "AuthSessionInfo_userId_idx" ON "AuthSessionInfo"("userId");

ALTER TABLE "AuthSessionInfo" ADD CONSTRAINT "AuthSessionInfo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuthSessionInfo" ENABLE ROW LEVEL SECURITY;
