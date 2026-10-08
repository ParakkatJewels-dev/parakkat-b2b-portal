import { env } from '../../config/env';
import { logger } from '../logger';
import type { WhatsAppProvider } from './whatsapp.types';

/**
 * Meta WhatsApp Business Cloud API adapter. Sends a plain-text message via the
 * Graph API. Note: outside a 24h customer-service window Meta requires approved
 * message TEMPLATES — plain text sends will be rejected by the API for cold
 * outreach; wire template names before relying on this for notifications.
 * Failures THROW (callers catch per-channel) so delivery problems are visible.
 */
export class MetaWhatsApp implements WhatsAppProvider {
  async send(to: string, message: string): Promise<void> {
    if (!env.WHATSAPP_PHONE_NUMBER_ID || !env.WHATSAPP_ACCESS_TOKEN) {
      throw new Error(`[MetaWhatsApp] WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN missing — message to ${to} not sent`);
    }

    const res = await fetch(`https://graph.facebook.com/v20.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message },
      }),
      signal: AbortSignal.timeout(15000),
    });

    const body = await res.text();
    if (!res.ok) {
      throw new Error(`[MetaWhatsApp] Graph API returned ${res.status}: ${body.slice(0, 300)}`);
    }
    logger.info('[MetaWhatsApp] message sent', { to });
  }
}
