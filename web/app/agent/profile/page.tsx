'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { AgentProfilePage } from '@/agent/sections/AgentProfilePage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['AGENT']}>
      <AgentProfilePage />
    </ProtectedRoute>
  );
}
