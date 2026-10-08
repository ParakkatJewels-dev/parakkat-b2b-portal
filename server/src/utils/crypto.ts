import crypto from 'node:crypto';

/** SHA-256 hex digest — used for OTP code and resume-token hashes. */
export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Timing-safe comparison of two hex/utf8 strings of potentially differing lengths. */
export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Generates a random numeric OTP code of the given length (default 6 digits). */
export function generateNumericOtp(length = 6): string {
  const max = 10 ** length;
  const num = crypto.randomInt(0, max);
  return num.toString().padStart(length, '0');
}

/** Generates a URL-safe random token (onboarding resume tokens). */
export function generateRandomToken(bytes = 48): string {
  return crypto.randomBytes(bytes).toString('base64url');
}
