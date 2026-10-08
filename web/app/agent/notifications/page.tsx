'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { AgentNotificationsPage } from '@/agent/sections/AgentNotificationsPage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['AGENT']}>
      <AgentNotificationsPage />
    </ProtectedRoute>
  );
}
