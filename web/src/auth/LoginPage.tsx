import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as authApi from '../api/auth.api';
import { useAuth } from '../hooks/useAuth';
import { ThemeToggle } from '../components/ThemeToggle';

export function LoginPage() {
  const navigate = useNavigate();
  const { setSession } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await authApi.login(email.trim(), password);

      if ('mfaSetupRequired' in result) {
        navigate('/mfa/setup', { state: { mfaPendingToken: result.mfaPendingToken } });
        return;
      }
      if ('mfaRequired' in result) {
        navigate('/mfa/verify', {
          state: { mfaPendingToken: result.mfaPendingToken, mfaMethod: result.mfaMethod },
        });
        return;
      }

      setSession(result.accessToken, result.user);
      navigate('/');
    } catch (err) {
      setError(
        (err as { response?: { data?: { message?: string } } }).response?.data?.message ??
          'Invalid email or password',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen bg-slate-50 font-sans text-slate-600 antialiased transition-colors duration-300 dark:bg-slate-900 dark:text-slate-200">
      {/* Floating Theme Toggle */}
      <div className="absolute top-4 right-4 z-20">
        <ThemeToggle />
      </div>

      {/* Left panel - Brand Showcase (Hidden on Mobile) */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-indigo-50 via-slate-100 to-indigo-100/50 dark:from-indigo-950 dark:via-slate-950 dark:to-indigo-950 p-8 lg:flex border-r border-slate-200/50 dark:border-slate-900">
        {/* Background Decorative Mesh & Glow */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(99,102,241,0.06),rgba(0,0,0,0))]" />
        <div className="absolute -left-20 -top-20 h-80 w-80 rounded-full bg-indigo-500/5 dark:bg-indigo-500/10 blur-[80px]" />
        <div className="absolute -bottom-40 -right-20 h-96 w-96 rounded-full bg-violet-600/5 dark:bg-violet-600/10 blur-[100px]" />
        
        {/* Brand Header */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/30">
            <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-transparent dark:bg-gradient-to-r dark:from-white dark:via-slate-200 dark:to-slate-400 dark:bg-clip-text">
            Parakkat B2B Portal
          </span>
        </div>

        {/* Brand Midsection */}
        <div className="relative z-10 my-auto max-w-md space-y-6 animate-fade-in">
          <div className="space-y-4">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/10 px-3 py-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-505 dark:bg-indigo-405 animate-pulse" />
              Enterprise Resort Bookings
            </span>
            <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-tight">
              A smarter way to manage resort inventories & terms.
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Access wholesale prices, manage sub-agents, request custom credit margins, and experience instant digital eKYC verification.
            </p>
          </div>

          {/* Feature Lists */}
          <div className="space-y-3.5">
            <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white/80 dark:border-slate-800/80 dark:bg-slate-900/40 p-3.5 backdrop-blur-sm transition-all duration-300 hover:border-indigo-500/20 dark:hover:border-indigo-500/30">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <div>
                <h4 className="font-semibold text-slate-900 dark:text-white text-sm">Instant Aadhaar & GST eKYC</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Automated validation engine verify accounts instantly, supporting independent agents with Aadhaar verification only.</p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white/80 dark:border-slate-800/80 dark:bg-slate-900/40 p-3.5 backdrop-blur-sm transition-all duration-300 hover:border-indigo-500/20 dark:hover:border-indigo-500/30">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h4 className="font-semibold text-slate-900 dark:text-white text-sm">Dynamic Commercial Tiers</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Tiers A, B, and C with customized markup margins, credit modes, and flexible pay later window terms.</p>
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
      <div className="flex min-h-screen w-full items-start justify-center overflow-y-auto bg-white px-4 py-20 dark:bg-slate-950 sm:px-6 sm:py-12 lg:w-1/2 lg:items-center lg:p-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_70%,rgba(99,102,241,0.02),rgba(0,0,0,0))] lg:hidden" />
        <div className="relative z-10 w-full max-w-md space-y-6 animate-fade-up">
          {/* Header */}
          <div className="space-y-2 text-center lg:text-left">
            {/* Mobile Header (Hidden on Large screens) */}
            <div className="flex items-center justify-center gap-3 lg:hidden mb-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg">
                <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">Parakkat B2B Portal</span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Sign in</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Enter your credentials to access resort booking options
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-4">
              {/* Email */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400" htmlFor="email">
                  Email Address
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 dark:text-slate-500">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.206" />
                    </svg>
                  </span>
                  <input
                    id="email"
                    type="email"
                    required
                    placeholder="name@agency.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-4 text-sm text-slate-900 placeholder-slate-400 outline-none transition-all duration-300 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 dark:border-slate-800 dark:bg-slate-900/60 dark:text-white dark:placeholder-slate-500 dark:focus:bg-slate-900/90"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400" htmlFor="password">
                    Password
                  </label>
                </div>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 dark:text-slate-500">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </span>
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-10 text-sm text-slate-900 placeholder-slate-400 outline-none transition-all duration-300 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 dark:border-slate-800 dark:bg-slate-900/60 dark:text-white dark:placeholder-slate-500 dark:focus:bg-slate-900/90"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
                  >
                    {showPassword ? (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    ) : (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400 animate-fade-in">
                <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="relative flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-500/15 outline-none transition-all duration-300 hover:from-indigo-500 hover:to-violet-500 hover:shadow-indigo-500/25 active:scale-[0.98] disabled:opacity-50"
            >
              {submitting ? (
                <div className="flex items-center gap-2">
                  <svg className="h-4 w-4 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Signing in…</span>
                </div>
              ) : (
                'Sign in to Portal'
              )}
            </button>
          </form>

          {/* Registration Info Panel */}
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-5 text-center dark:border-slate-900 dark:bg-slate-900/20">
            <h5 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Become a Booking Partner</h5>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-500 leading-relaxed">
              Select your registration path to unlock curated tariffs.
            </p>
            <div className="mt-4 flex flex-col gap-2.5 text-xs font-semibold">
              <div className="flex flex-col justify-center gap-2 sm:flex-row">
                <Link to="/onboarding/register?type=agency" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-indigo-600 hover:text-indigo-700 hover:border-indigo-500/20 dark:border-slate-800 dark:bg-slate-900/40 dark:text-indigo-400 dark:hover:text-indigo-300 dark:hover:border-indigo-500/30 transition-colors">
                  Agency Registration
                </Link>
                <Link to="/onboarding/register?type=independent" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-indigo-600 hover:text-indigo-700 hover:border-indigo-500/20 dark:border-slate-800 dark:bg-slate-900/40 dark:text-indigo-400 dark:hover:text-indigo-300 dark:hover:border-indigo-500/30 transition-colors">
                  Independent Agent
                </Link>
              </div>
              <Link to="/onboarding/resume" className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-400 mt-1 hover:underline">
                Resume Onboarding Application →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
