import { getIdentity } from '../../src/lib/identity';
import { MockIdentity } from '../../src/lib/identity/mockIdentity';

/**
 * An access token for an existing user, as if they had signed in — by default with their second
 * factor already done (`mfaVerified: false` leaves the session owing it). Role and agency come
 * from the user's row, as they do for every real request; extra fields are accepted so call
 * sites can pass the user object they already have.
 */
export async function tokenFor(user: { id: string; mfaVerified?: boolean; [field: string]: unknown }): Promise<string> {
  const identity = getIdentity();
  if (!(identity instanceof MockIdentity)) throw new Error('tokenFor needs IDENTITY_PROVIDER=mock');
  const session = await identity.createSessionFor(user.id, { aal: user.mfaVerified === false ? 'aal1' : 'aal2' });
  return session.accessToken;
}
