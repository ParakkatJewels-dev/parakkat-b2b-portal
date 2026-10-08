'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { AgentGuestsPage } from '@/agent/sections/AgentGuestsPage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['AGENT']}>
      <AgentGuestsPage />
    </ProtectedRoute>
  );
}
