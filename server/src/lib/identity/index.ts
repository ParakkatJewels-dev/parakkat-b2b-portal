import { env } from '../../config/env';
import { logger } from '../logger';
import { MockIdentity } from './mockIdentity';
import { SupabaseIdentity } from './supabaseIdentity';
import type { CreatedIdentity, IdentityProvider } from './identity.types';

export type {
  AccessClaims,
  CreatedIdentity,
  IdentityProvider,
  IdentitySession,
  RefreshOutcome,
  SessionSummary,
  TotpEnrollment,
} from './identity.types';

let instance: IdentityProvider | undefined;

export function getIdentity(): IdentityProvider {
  instance ??= env.IDENTITY_PROVIDER === 'supabase' ? new SupabaseIdentity() : new MockIdentity();
  return instance;
}

/**
 * Creates the Auth login first, then the portal's own row under the same id (`createRow`). If the
 * row cannot be written, the login is deleted again so a failed create never leaves an Auth
 * account that nothing in the portal knows about.
 */
export async function withNewLogin<T>(
  input: { email: string; password: string },
  createRow: (login: CreatedIdentity) => Promise<T>,
): Promise<T> {
  const identity = getIdentity();
  const login = await identity.createUser(input);
  try {
    return await createRow(login);
  } catch (error) {
    await identity.deleteUser(login.id).catch((cleanupError: unknown) =>
      logger.error('Could not remove the login of a user that failed to save', { userId: login.id, cleanupError }),
    );
    throw error;
  }
}
