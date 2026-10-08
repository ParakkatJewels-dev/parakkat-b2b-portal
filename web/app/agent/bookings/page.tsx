'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { AgentBookingsPage } from '@/agent/sections/AgentBookingsPage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['AGENT']}>
      <AgentBookingsPage />
    </ProtectedRoute>
  );
}
