/**
 * One-time move of existing portal logins into Supabase Auth.
 *
 *   npx tsx scripts/migrate-users-to-supabase-auth.ts           # dry run: reports, changes nothing
 *   npx tsx scripts/migrate-users-to-supabase-auth.ts --apply   # creates the Auth accounts
 *
 * Reads SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL from the environment / server/.env.
 *
 * For every `User` without an Auth account it creates one with the SAME id and the user's
 * existing bcrypt hash (Supabase Auth accepts bcrypt imports), so everyone keeps signing in with
 * the password they have today. The local hash is then cleared — the credential lives only in
 * Supabase Auth from here on (pass --keep-hashes to leave it).
 *
 * Authenticator-app secrets cannot be imported, so TOTP users keep a second factor by switching to
 * emailed codes (to the mailbox they already own); they can enrol an authenticator again from
 * their profile once signed in. Email-code MFA users are unaffected.
 *
 * Safe to re-run: users that already have their Auth account are skipped.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { PrismaClient } from '@prisma/client';

const apply = process.argv.includes('--apply');
const keepHashes = process.argv.includes('--keep-hashes');

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(1);
}

const prisma = new PrismaClient();
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }).auth.admin;

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, role: true, passwordHash: true, mfaEnabled: true, mfaMethod: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`${apply ? 'APPLY' : 'DRY RUN'} — ${users.length} portal users\n`);

  let created = 0;
  let skipped = 0;
  let failed = 0;
  for (const user of users) {
    const label = `${user.email} (${user.role})`;
    const existing = await admin.getUserById(user.id);
    if (existing.data.user) {
      console.log(`  skip    ${label}: already has its Auth account`);
      skipped++;
      continue;
    }
    if (!user.passwordHash?.startsWith('$2')) {
      console.log(`  FAIL    ${label}: no bcrypt hash to import — create the login with a temporary password instead`);
      failed++;
      continue;
    }
    const resetsTotp = user.mfaEnabled && user.mfaMethod === 'TOTP';
    console.log(`  create  ${label}${resetsTotp ? ' — authenticator app → emailed codes until re-enrolled' : ''}`);
    if (!apply) continue;

    const { error } = await admin.createUser({
      id: user.id,
      email: user.email,
      password_hash: user.passwordHash,
      email_confirm: true,
    });
    if (error) {
      console.log(`  FAIL    ${label}: ${error.message}`);
      failed++;
      continue;
    }
    await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(keepHashes ? {} : { passwordHash: null }),
        ...(resetsTotp ? { mfaMethod: 'EMAIL', mfaSecret: null } : {}),
      },
    });
    created++;
  }

  console.log(`\n${apply ? 'created' : 'would create'} ${apply ? created : users.length - skipped - failed}, skipped ${skipped}, failed ${failed}`);
  if (!apply) console.log('Nothing was changed. Re-run with --apply to create the accounts.');
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
