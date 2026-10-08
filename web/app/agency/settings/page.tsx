'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { AccountSettingsPage } from '@/agency/sections/AccountSettingsPage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['AGENCY']}>
      <AccountSettingsPage />
    </ProtectedRoute>
  );
}
