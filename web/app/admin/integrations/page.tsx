'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { IntegrationsPage } from '@/admin/sections/IntegrationsPage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['ADMIN']}>
      <IntegrationsPage />
    </ProtectedRoute>
  );
}
