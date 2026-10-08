import crypto from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { withNewLogin } from '../src/lib/identity';

const prisma = new PrismaClient();

/**
 * A portal user plus its login in the configured identity provider (Supabase Auth, or the
 * offline mock), sharing one id. Existing users are left untouched.
 */
async function ensureUser(
  email: string,
  password: string,
  data: Omit<Prisma.UserUncheckedCreateInput, 'id' | 'email' | 'passwordHash'>,
) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  return withNewLogin({ email, password }, (login) =>
    prisma.user.create({ data: { id: login.id, email, passwordHash: login.passwordHash, ...data } }),
  );
}

function generateStrongPassword(): string {
  return crypto.randomBytes(18).toString('base64url');
}

async function main() {
  const email = process.env.ADMIN_SEED_EMAIL || 'admin@parakkatjewels.com';
  // 'admin123' is a DEV convenience only. In production an unset
  // ADMIN_SEED_PASSWORD gets a random password (printed once) — a well-known
  // default admin credential must never reach a live system.
  const isProduction = process.env.NODE_ENV === 'production';
  let password = process.env.ADMIN_SEED_PASSWORD || (isProduction ? '' : 'admin123');
  let generated = false;

  if (!password) {
    password = generateStrongPassword();
    generated = true;
  }

  const user = await ensureUser(email, password, {
    role: 'ADMIN',
    status: 'ACTIVE',
    mfaEnabled: false,
    mfaMethod: 'NONE',
  });

  await prisma.auditLog.create({
    data: {
      entityType: 'User',
      entityId: user.id,
      event: 'SEED_ADMIN_CREATED',
      actorRole: 'SYSTEM',
    },
  });

  // eslint-disable-next-line no-console
  console.log(`Admin user ready: ${email} (ADMIN — requires MFA setup on first login)`);
  if (generated) {
    // eslint-disable-next-line no-console
    console.log(`Generated password (shown once, not stored anywhere else): ${password}`);
    // eslint-disable-next-line no-console
    console.log('Rotate this password after first login. ADMIN role requires MFA setup on first login.');
  }

  // --- Demo login data (dev only) -----------------------------------------
  // AGENCY/AGENT roles don't force MFA, so these let you log in instantly for
  // testing without an authenticator app. Skipped in production.
  if (process.env.NODE_ENV !== 'production' && process.env.SEED_DEMO !== 'false') {
    const agency = await prisma.agency.upsert({
      where: { id: '00000000-0000-0000-0000-0000000000a1' },
      update: {},
      create: {
        id: '00000000-0000-0000-0000-0000000000a1',
        legalName: 'Demo Travels Pvt Ltd',
        gstin: '27AABCU9603R1ZM',
        pan: 'AABCU9603R',
        status: 'ACTIVE',
        contactEmail: 'agency@demo.com',
        contactPhone: '9876543210',
        activatedAt: new Date(),
      },
    });

    await ensureUser('agency@demo.com', 'agency123', { role: 'AGENCY', agencyId: agency.id });
    await ensureUser('agent@demo.com', 'agent123', { role: 'AGENT', agencyId: agency.id });

    // Commercial terms so the demo agency can actually book (credit tier).
    const hasConfig = await prisma.commercialConfiguration.findFirst({
      where: { agencyId: agency.id, isCurrent: true },
    });
    if (!hasConfig) {
      await prisma.commercialConfiguration.create({
        data: {
          agencyId: agency.id,
          tier: 'A',
          paymentMode: 'CREDIT',
          creditLimit: 99999999,
          paymentTerms: 'net 7',
          markupPct: 10,
          effectiveFrom: new Date(),
          updatedById: user.id,
          isCurrent: true,
        },
      });
    }

    // eslint-disable-next-line no-console
    console.log('Demo users ready (no MFA): agency@demo.com / agency123  ·  agent@demo.com / agent123');
  }
  // v4 §1 — rate plans, occupancy and restrictions now come from CRS (the
  // mock serves them); the portal no longer seeds local pricing tables.
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
