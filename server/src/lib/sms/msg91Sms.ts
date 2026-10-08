import { env } from '../../config/env';
import type { SmsProvider } from './sms.types';

/**
 * MSG91 adapter. Not yet wired to a live MSG91 account — and it THROWS rather
 * than silently no-op'ing, so selecting `SMS_PROVIDER=msg91` before the
 * integration lands surfaces as a visible delivery failure (callers catch and
 * log per-channel), never as an "SMS sent" that no one received.
 */
export class Msg91Sms implements SmsProvider {
  async sendOtp(phone: string, _code: string): Promise<void> {
    if (!env.MSG91_AUTH_KEY) {
      throw new Error(`[Msg91Sms] MSG91_AUTH_KEY not configured — SMS to ${phone} not sent`);
    }
    throw new Error(
      '[Msg91Sms] MSG91 integration is not implemented yet — use SMS_PROVIDER=console until the live account is wired',
    );
  }
}
