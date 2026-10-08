import { useEffect, useState } from 'react';
import { Link, useNavigate } from '../lib/router';
import * as onboardingApi from '../api/onboarding.api';
import { loadResumeSession } from '../store/onboardingSession';
import type { Application, LifecycleState } from '../types/onboarding';

const STATE_COPY: Record<LifecycleState, { label: string; description: string }> = {
  DRAFT: { label: 'Draft', description: 'Your application is still a draft and has not been submitted.' },
  VERIFICATION: {
    label: 'In verification',
    description: 'We have received your application and identity/business checks are running.',
  },
  REVIEW: { label: 'Under review', description: 'Checks are complete; a reviewer is assessing your application.' },
  APPROVED: { label: 'Approved', description: 'Your application is approved. Commercial terms will follow.' },
  COMMERCIAL_CONFIGURATION: {
    label: 'Setting up terms',
    description: 'Commercial terms are being configured and an agreement will be sent for signature.',
  },
  ACTIVE: { label: 'Active', description: 'Your agency is active. You can now sign in and transact.' },
  REJECTED: { label: 'Rejected', description: 'Unfortunately your application was not approved.' },
  SUSPENDED: { label: 'Suspended', description: 'Your agency is currently suspended.' },
};

export function ApplicationStatusPage() {
  const navigate = useNavigate();
  const [application, setApplication] = useState<Application | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const session = loadResumeSession();
    if (!session) {
      navigate('/onboarding/resume');
      return;
    }
    onboardingApi
      .getDraft(session.applicationId, session.resumeToken)
      .then((res) => setApplication(res.application))
      .catch(() => setError('Could not load your application. Try resuming again.'));
  }, [navigate]);

  if (error) {
    return (
      <div className="mx-auto max-w-md px-4 py-12 text-center">
        <p className="text-sm text-red-600">{error}</p>
        <Link to="/onboarding/resume" className="mt-4 inline-block text-sm text-slate-900 underline">
          Resume
        </Link>
      </div>
    );
  }

  if (!application) return null;

  const copy = STATE_COPY[application.lifecycleState];

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="text-xl font-semibold text-slate-900">Application status</h1>
      <p className="mt-1 text-sm text-slate-500">Reference: {application.id}</p>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
        <span className="inline-block rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white">
          {copy.label}
        </span>
        <p className="mt-3 text-sm text-slate-600">{copy.description}</p>
      </div>

      {application.lifecycleState === 'DRAFT' && (
        <Link
          to="/onboarding/register"
          className="mt-4 inline-block text-sm text-slate-900 underline"
        >
          Continue editing your draft
        </Link>
      )}
    </div>
  );
}
