'use client';

import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { ProfilePage } from '@/agency/sections/ProfilePage';

export default function Page() {
  return (
    <ProtectedRoute allowedRoles={['AGENCY']}>
      <ProfilePage />
    </ProtectedRoute>
  );
}
