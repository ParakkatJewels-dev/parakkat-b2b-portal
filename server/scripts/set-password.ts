/**
 * Set a user's password from the terminal — for a forgotten admin password or a default one that
 * must go. The password is typed at a hidden prompt; it never appears on screen, in shell history
 * or in a log.
 *
 *   npm run auth:set-password --workspace server -- admin@example.com
 *
 * Reads SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL from server/.env. Sets the password
 * in Supabase Auth, enforces the portal's password policy, clears the change-password prompt, ends
 * every existing session of that user (anyone signed in with the old password is signed out), and
 * records the change in the audit log.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { PrismaClient } from '@prisma/client';
import { validatePassword } from '../src/modules/auth/passwordPolicy';

/** Reads a line from the terminal without echoing it. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new Error('Run this in a terminal: the password is read from a hidden prompt.'));
      return;
    }
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u0003') {
          process.stdout.write('\n');
          process.exit(130);
        }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error('Usage: npm run auth:set-password --workspace server -- <email>');
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (server/.env).');

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true } });
    if (!user) throw new Error(`No portal user with the email ${email}.`);

    const password = await promptHidden(`New password for ${email} (${user.role}): `);
    const failures = validatePassword(password);
    if (failures.length) throw new Error(`The password must ${failures.join(', ')}.`);
    if ((await promptHidden('Type it again: ')) !== password) throw new Error('The two entries did not match.');

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }).auth.admin;
    const { error } = await admin.updateUserById(user.id, { password });
    if (error) throw new Error(`Supabase Auth refused the password: ${error.message}`);

    // The old credential stops mattering everywhere: no stale local hash, no live old sessions.
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: null, mustChangePassword: false } });
    const ended = await prisma.$executeRaw`delete from auth.sessions where user_id = ${user.id}::uuid`;
    await prisma.auditLog.create({
      data: { entityType: 'User', entityId: user.id, event: 'PASSWORD_SET_BY_OPERATOR', actorRole: 'SYSTEM' },
    });
    console.log(`Password updated for ${email}. ${ended} existing session(s) signed out.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
