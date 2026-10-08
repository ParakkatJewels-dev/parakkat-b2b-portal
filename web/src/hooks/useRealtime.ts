import { useEffect } from 'react';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { httpClient } from '../api/httpClient';
import { useAuthStore } from '../store/authStore';

const TOPIC_KEYS: Record<string, string[][]> = {
  applications: [['applications'], ['application'], ['admin-summary']],
  agencies: [['agencies'], ['admin-summary']],
  bookings: [['bookings'], ['agency-summary'], ['admin-summary']],
  finance: [['invoices'], ['balance'], ['agency-summary'], ['admin-summary'], ['reconciliation']],
};

interface RealtimeConfig {
  enabled: boolean;
  channels: string[];
}

interface BroadcastMessage {
  payload?: { topics?: string[] };
}

export function useRealtime() {
  const queryClient = useQueryClient();
  const accessToken = useAuthStore((state) => state.accessToken);

  useEffect(() => {
    if (!accessToken) return;

    let cancelled = false;
    let supabase: SupabaseClient | undefined;
    const channels: RealtimeChannel[] = [];

    const invalidate = (topics: string[]) => {
      const seen = new Set<string>();
      for (const topic of topics) {
        for (const key of TOPIC_KEYS[topic] ?? []) {
          const id = JSON.stringify(key);
          if (seen.has(id)) continue;
          seen.add(id);
          void queryClient.invalidateQueries({ queryKey: key });
        }
      }
    };

    const refreshActiveData = () => {
      if (document.visibilityState === 'visible') invalidate(Object.keys(TOPIC_KEYS));
    };

    const pollTimer = window.setInterval(refreshActiveData, 60_000);

    async function subscribe() {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      if (!supabaseUrl || !supabaseKey) return;

      try {
        const response = await httpClient.get<RealtimeConfig>('/realtime/config');
        if (cancelled || !response.data.enabled || response.data.channels.length === 0) return;

        const { createClient } = await import('@supabase/supabase-js');
        if (cancelled) return;
        supabase = createClient(supabaseUrl, supabaseKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        for (const channelName of response.data.channels) {
          const channel = supabase
            .channel(channelName, { config: { private: false } })
            .on('broadcast', { event: 'invalidate' }, (message: BroadcastMessage) => {
              invalidate(message.payload?.topics ?? []);
            })
            .subscribe();
          channels.push(channel);
        }
      } catch {
        // The one-minute refresh above keeps data current when Realtime is
        // unavailable or has not yet been configured.
      }
    }

    void subscribe();

    return () => {
      cancelled = true;
      window.clearInterval(pollTimer);
      if (supabase) {
        for (const channel of channels) void supabase.removeChannel(channel);
      }
    };
  }, [accessToken, queryClient]);
}
