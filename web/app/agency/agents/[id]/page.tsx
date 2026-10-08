'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { AgentDetailPage } from '@/shared/AgentDetailPage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['AGENCY']}>
      <AgentDetailPage />
    </ProtectedRoute>
  );
}
