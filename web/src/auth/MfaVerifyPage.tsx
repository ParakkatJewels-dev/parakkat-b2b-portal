import { type FormEvent, useEffect, useState } from 'react';
import { useLocation, useNavigate } from '../lib/router';
import * as authApi from '../api/auth.api';
import { useAuth } from '../hooks/useAuth';

interface VerifyLocationState {
  mfaPendingToken: string;
  mfaMethod?: 'TOTP' | 'EMAIL';
}

/** Login-time MFA code entry (role/user already has MFA enabled). */
export function MfaVerifyPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setSession } = useAuth();
  const state = location.state as VerifyLocationState | undefined;
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!state?.mfaPendingToken) {
      navigate('/login', { replace: true });
    }
  }, [state, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!state) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await authApi.verifyMfa(state.mfaPendingToken, code);
      setSession(result.accessToken, result.user);
      navigate('/');
    } catch {
      setError('Invalid or expired code');
    } finally {
      setSubmitting(false);
    }
  }

  if (!state) return null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-lg bg-white p-8 shadow-md">
        <h1 className="mb-2 text-xl font-semibold text-slate-900">Verify your identity</h1>
        <p className="mb-6 text-sm text-slate-500">
          Enter the 6-digit code from your {state.mfaMethod === 'EMAIL' ? 'email' : 'authenticator app'}.
        </p>

        <input
          type="text"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-center text-lg tracking-widest"
          placeholder="000000"
        />

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting || code.length !== 6}
          className="w-full rounded bg-slate-900 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? 'Verifying…' : 'Verify'}
        </button>
      </form>
    </div>
  );
}

interface SetupLocationState {
  mfaPendingToken: string;
}

/** First-login TOTP enrollment for roles that mandate MFA (ADMIN/VERIFIER). */
export function MfaSetupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setSession } = useAuth();
  const state = location.state as SetupLocationState | undefined;
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [manualKey, setManualKey] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!state?.mfaPendingToken) {
      navigate('/login', { replace: true });
      return;
    }
    authApi.setupTotp(state.mfaPendingToken).then((res) => {
      setQrCodeDataUrl(res.qrCodeDataUrl);
      setManualKey(res.manualEntryKey);
    });
  }, [state, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!state) return;
    setError(null);
    setSubmitting(true);
    try {
      await authApi.confirmTotp(state.mfaPendingToken, code);
      const result = await authApi.verifyMfa(state.mfaPendingToken, code);
      setSession(result.accessToken, result.user);
      navigate('/');
    } catch {
      setError('Invalid code — check your authenticator app and try again');
    } finally {
      setSubmitting(false);
    }
  }

  if (!state) return null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-lg bg-white p-8 shadow-md">
        <h1 className="mb-2 text-xl font-semibold text-slate-900">Set up two-factor authentication</h1>
        <p className="mb-4 text-sm text-slate-500">
          This role requires MFA. Scan the QR code with an authenticator app, then enter the code
          it generates.
        </p>

        {qrCodeDataUrl && (
          <img src={qrCodeDataUrl} alt="TOTP QR code" className="mx-auto mb-4 h-40 w-40" />
        )}

        {manualKey && (
          <div className="mb-4 rounded bg-slate-50 p-3 text-center">
            <p className="mb-1 text-xs text-slate-500">Can’t scan? Enter this key manually:</p>
            <code className="select-all break-all text-sm font-semibold tracking-wider text-slate-800">
              {manualKey.replace(/(.{4})/g, '$1 ').trim()}
            </code>
          </div>
        )}

        <input
          type="text"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-center text-lg tracking-widest"
          placeholder="000000"
        />

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting || code.length !== 6 || !qrCodeDataUrl}
          className="w-full rounded bg-slate-900 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? 'Confirming…' : 'Confirm and continue'}
        </button>
      </form>
    </div>
  );
}
