'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { BookingsPage } from '@/agent/BookingsPage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['AGENT', 'AGENCY']}>
      <BookingsPage />
    </ProtectedRoute>
  );
}
