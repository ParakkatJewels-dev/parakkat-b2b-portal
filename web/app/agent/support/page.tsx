'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { AgentSupportPage } from '@/agent/sections/AgentSupportPage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['AGENT']}>
      <AgentSupportPage />
    </ProtectedRoute>
  );
}
