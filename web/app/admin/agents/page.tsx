'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { AgentsPage } from '@/admin/sections/AgentsPage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['ADMIN']}>
      <AgentsPage />
    </ProtectedRoute>
  );
}
