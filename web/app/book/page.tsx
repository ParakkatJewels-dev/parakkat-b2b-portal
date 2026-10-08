'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { SearchPage } from '@/agent/SearchPage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['AGENT', 'AGENCY']}>
      <SearchPage />
    </ProtectedRoute>
  );
}
