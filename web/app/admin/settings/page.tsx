'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { SettingsPage } from '@/admin/sections/SettingsPage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['ADMIN']}>
      <SettingsPage />
    </ProtectedRoute>
  );
}
