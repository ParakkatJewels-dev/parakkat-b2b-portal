'use client';

import { Navigate } from '../lib/router';
import { useAuth } from '../hooks/useAuth';
import { AdminDashboard } from '../admin/AdminDashboard';
import { AgencyDashboard } from '../agency/AgencyDashboard';
import { AgentDashboard } from '../agent/AgentDashboard';

/** `/` — each role's own dashboard. */
export function RoleHome() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;

  switch (user.role) {
    case 'ADMIN':
    case 'VERIFIER':
      return <AdminDashboard />;
    case 'AGENCY':
      return <AgencyDashboard />;
    case 'AGENT':
      return <AgentDashboard />;
  }
}
