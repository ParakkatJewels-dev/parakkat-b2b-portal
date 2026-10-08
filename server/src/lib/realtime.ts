import { createHmac } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env';
import { logger } from './logger';

let client: SupabaseClient | undefined;

export function isRealtimeEnabled(): boolean {
  return Boolean(
    env.REALTIME_ENABLED &&
    env.SUPABASE_URL &&
    env.SUPABASE_SERVICE_ROLE_KEY &&
    env.REALTIME_CHANNEL_SECRET,
  );
}

function getClient(): SupabaseClient {
  if (!isRealtimeEnabled()) throw new Error('Supabase Realtime is not configured');
  client ??= createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

function channelForScope(scope: string): string {
  const deployment = process.env.VERCEL_ENV ?? env.NODE_ENV;
  const digest = createHmac('sha256', env.REALTIME_CHANNEL_SECRET!)
    .update(`${deployment}:${scope}`)
    .digest('base64url');
  return `portal:invalidate:${digest}`;
}

export function getRealtimeChannels(role: string, agencyId: string | null): string[] {
  if (!isRealtimeEnabled()) return [];

  const channels: string[] = [];
  if (role === 'ADMIN' || role === 'VERIFIER') channels.push(channelForScope('admin'));
  if (agencyId) channels.push(channelForScope(`agency:${agencyId}`));
  return channels;
}

async function sendInvalidation(channelName: string, topics: string[]): Promise<void> {
  const supabase = getClient();
  const channel = supabase.channel(channelName, { config: { private: false } });
  try {
    const result = await channel.httpSend('invalidate', { topics });
    if (!result.success) {
      logger.warn('[realtime] Supabase broadcast was not acknowledged', {
        channel: channelName,
        result,
      });
    }
  } catch (error) {
    logger.warn('[realtime] Supabase broadcast failed', {
      channel: channelName,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await supabase.removeChannel(channel).catch(() => undefined);
  }
}

/**
 * Sends lightweight cache-invalidation topics through Supabase Broadcast.
 * Channel names are HMAC-derived capabilities returned only by an authenticated
 * API route, so one agency cannot guess another agency's channel.
 */
export async function broadcast(
  topics: string[],
  opts: { agencyId?: string | null } = {},
): Promise<void> {
  if (!isRealtimeEnabled()) return;

  const channels = [channelForScope('admin')];
  if (opts.agencyId) channels.push(channelForScope(`agency:${opts.agencyId}`));
  await Promise.all(channels.map((channel) => sendInvalidation(channel, topics)));
}
