import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from '../lib/router';
import * as onboardingApi from '../api/onboarding.api';
import { saveResumeSession } from '../store/onboardingSession';
import { ThemeToggle } from '../components/ThemeToggle';

export function ResumePage() {
  const navigate = useNavigate();
  const [applicationId, setApplicationId] = useState('');
  const [resumeToken, setResumeToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await onboardingApi.getDraft(applicationId.trim(), resumeToken.trim());
      saveResumeSession({ applicationId: applicationId.trim(), resumeToken: resumeToken.trim() });
      navigate(res.application.lifecycleState === 'DRAFT' ? '/onboarding/register' : '/onboarding/status');
    } catch {
      setError('Could not find an application with that reference and token');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-900 font-sans antialiased text-slate-600 dark:text-slate-200 relative transition-colors duration-300">
      {/* Floating Theme Toggle */}
      <div className="absolute top-4 right-4 z-20">
        <ThemeToggle />
      </div>

      {/* Left panel - Brand Showcase (Hidden on Mobile) */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-indigo-50 via-slate-100 to-indigo-100/50 dark:from-indigo-950 dark:via-slate-950 dark:to-indigo-950 p-8 lg:flex border-r border-slate-200/50 dark:border-slate-900">
        {/* Background Decorative Mesh & Glow */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(99,102,241,0.08),rgba(0,0,0,0))]" />
        <div className="absolute -left-20 -top-20 h-80 w-80 rounded-full bg-indigo-500/5 dark:bg-indigo-500/10 blur-[80px]" />
        <div className="absolute -bottom-40 -right-20 h-96 w-96 rounded-full bg-violet-600/5 dark:bg-violet-600/10 blur-[100px]" />
        
        {/* Brand Header */}
        <div className="relative z-10 flex items-center gap-3">
          <Link to="/login" className="flex items-center gap-3 group">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/30 group-hover:scale-105 transition-transform">
              <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-200 transition-colors">
              Parakkat B2B
            </span>
          </Link>
        </div>

        {/* Brand Midsection */}
        <div className="relative z-10 my-auto max-w-md space-y-6 animate-fade-in">
          <div className="space-y-4">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/10 px-3 py-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 dark:bg-indigo-400 animate-pulse" />
              Resume Workspace Session
            </span>
            <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-tight">
              Pick up right where you left your draft application.
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Your registration progress is secured. Simply supply the unique application ID and token code to resume files upload or details entry.
            </p>
          </div>

          <div className="space-y-4">
            <div className="flex items-start gap-4 rounded-xl border border-slate-200 bg-white/80 dark:border-slate-800/80 dark:bg-slate-900/40 p-4 backdrop-blur-sm transition-all duration-300">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <div>
                <h4 className="font-semibold text-slate-900 dark:text-white">Encrypted Token Access</h4>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Your draft sessions are private and scoped, allowing you to load inputs securely from any device.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="relative z-10 text-xs text-slate-500 dark:text-slate-500">
          &copy; {new Date().getFullYear()} Parakkat Resorts. Safe & Verified.
        </div>
      </div>

      {/* Right panel - Login form */}
      <div className="flex w-full items-center justify-center bg-white dark:bg-slate-950 p-6 sm:p-8 lg:w-1/2">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_70%,rgba(99,102,241,0.02),rgba(0,0,0,0))] lg:hidden" />
        <div className="relative z-10 w-full max-w-md space-y-6 animate-fade-up">
          {/* Top Form Navigation */}
          <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-900 pb-4">
            <span className="text-xs text-slate-500 uppercase tracking-widest font-semibold">Resume Portal</span>
            <Link to="/login" className="text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 hover:underline">
              ← Back to login
            </Link>
          </div>

          {/* Header */}
          <div className="space-y-2 text-center lg:text-left">
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Resume Application</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Provide reference credentials to retrieve your draft workspace
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-4">
              {/* Application Reference */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400" htmlFor="applicationId">
                  Application Reference ID
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-405 dark:text-slate-500">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414a1 1 0 00-.707-.293H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                  </span>
                  <input
                    id="applicationId"
                    type="text"
                    required
                    placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
                    value={applicationId}
                    onChange={(e) => setApplicationId(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-4 text-sm text-slate-900 placeholder-slate-400 outline-none transition-all duration-300 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 dark:border-slate-800 dark:bg-slate-900/60 dark:text-white dark:placeholder-slate-600 dark:focus:bg-slate-900/90"
                  />
                </div>
              </div>

              {/* Resume Token */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400" htmlFor="resumeToken">
                  Resume Token
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-405 dark:text-slate-500">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m-5 8a3 3 0 11-6 0 3 3 0 016 0zM12 11h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </span>
                  <input
                    id="resumeToken"
                    type="password"
                    required
                    placeholder="e.g. key_62c72b..."
                    value={resumeToken}
                    onChange={(e) => setResumeToken(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-4 text-sm text-slate-900 placeholder-slate-400 outline-none transition-all duration-300 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 dark:border-slate-800 dark:bg-slate-900/60 dark:text-white dark:placeholder-slate-600 dark:focus:bg-slate-900/90"
                  />
                </div>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-705 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400">
                <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="relative flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-500/15 outline-none transition-all duration-300 hover:from-indigo-500 hover:to-violet-500 hover:shadow-indigo-500/25 active:scale-[0.98] disabled:opacity-50"
            >
              {busy ? (
                <div className="flex items-center gap-2">
                  <svg className="h-4 w-4 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Resuming…</span>
                </div>
              ) : (
                'Resume Application Workspace'
              )}
            </button>
          </form>

          {/* Registration Info Panel */}
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-5 text-center dark:border-slate-900 dark:bg-slate-900/20">
            <h5 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Become a Booking Partner</h5>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-500 leading-relaxed">
              Start a fresh application if you do not have saved reference keys.
            </p>
            <div className="mt-4 flex flex-col gap-2.5 text-xs font-semibold">
              <div className="flex gap-2 justify-center">
                <Link to="/onboarding/register?type=agency" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-indigo-600 hover:text-indigo-700 hover:border-indigo-500/20 dark:border-slate-800 dark:bg-slate-900/40 dark:text-indigo-400 dark:hover:text-indigo-300 dark:hover:border-indigo-500/30 transition-colors">
                  Agency Registration
                </Link>
                <Link to="/onboarding/register?type=independent" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-indigo-600 hover:text-indigo-700 hover:border-indigo-500/20 dark:border-slate-800 dark:bg-slate-900/40 dark:text-indigo-400 dark:hover:text-indigo-300 dark:hover:border-indigo-500/30 transition-colors">
                  Independent Agent
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
