'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { NotificationsPage } from '@/admin/sections/NotificationsPage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['ADMIN']}>
      <NotificationsPage />
    </ProtectedRoute>
  );
}
