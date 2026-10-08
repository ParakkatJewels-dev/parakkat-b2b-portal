import { useState } from 'react';
import { Badge, Button } from '../components/ui/kit';
import { useAuth } from '../hooks/useAuth';
import * as mfaApi from '../api/mfa.api';
import * as authApi from '../api/auth.api';
import { useAuthStore } from '../store/authStore';

type Mode = 'idle' | 'totp' | 'email';

/**
 * Self-service two-factor management, embedded in each role's account area.
 * Enrol via an authenticator app (TOTP) or email OTP, or disable — unless the
 * current security policy makes MFA mandatory for the role (server rejects it).
 */
export function MfaCard() {
  const { user, accessToken, setSession } = useAuth();
  const [mode, setMode] = useState<Mode>('idle');
  const [setup, setSetup] = useState<mfaApi.TotpSetup | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!user) return null;

  const refreshUser = async () => {
    const fresh = await authApi.getMe();
    // Read the store, not the render-time value: confirming TOTP replaces the token.
    const current = useAuthStore.getState().accessToken ?? accessToken;
    if (current) setSession(current, fresh);
  };
  const errMsg = (e: unknown) => (e as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'Something went wrong';
  const reset = () => { setMode('idle'); setSetup(null); setCode(''); setError(null); };

  const startTotp = async () => {
    setBusy(true); setError(null); setNotice(null);
    try { setSetup(await mfaApi.startTotp()); setMode('totp'); setCode(''); }
    catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  };
  const startEmail = async () => {
    setBusy(true); setError(null); setNotice(null);
    try { await mfaApi.requestEmailOtp(); setMode('email'); setCode(''); setNotice('We emailed you a 6-digit code.'); }
    catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  };
  const confirm = async () => {
    setBusy(true); setError(null);
    try {
      if (mode === 'totp') {
        const { accessToken: upgraded } = await mfaApi.confirmTotp(code);
        useAuthStore.getState().setAccessToken(upgraded);
      } else {
        await mfaApi.confirmEmailOtp(code);
      }
      await refreshUser();
      reset();
      setNotice('Two-factor authentication is now on.');
    } catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  };
  const disable = async () => {
    setBusy(true); setError(null); setNotice(null);
    try { await mfaApi.disableMfa(); await refreshUser(); setNotice('Two-factor authentication disabled.'); }
    catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-700">Two-factor authentication</div>
          <div className="text-xs text-slate-400">Add a second step at login for stronger account security.</div>
        </div>
        <Badge tone={user.mfaEnabled ? 'green' : 'slate'}>
          {user.mfaEnabled ? `On · ${user.mfaMethod === 'EMAIL' ? 'Email OTP' : 'Authenticator'}` : 'Off'}
        </Badge>
      </div>

      {notice && <p className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-xs font-medium text-green-700">{notice}</p>}
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>}

      {/* Enabled → allow disable */}
      {user.mfaEnabled && mode === 'idle' && (
        <Button variant="danger" disabled={busy} onClick={disable}>{busy ? 'Working…' : 'Disable 2FA'}</Button>
      )}

      {/* Disabled → choose a method */}
      {!user.mfaEnabled && mode === 'idle' && (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={busy} onClick={startTotp}>Set up authenticator app</Button>
          <Button variant="secondary" disabled={busy} onClick={startEmail}>Use email OTP</Button>
        </div>
      )}

      {/* TOTP enrolment */}
      {mode === 'totp' && setup && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Scan this QR code with an authenticator app (Google Authenticator, Authy, 1Password), then enter the 6-digit code.</p>
          <img src={setup.qrCodeDataUrl} alt="TOTP QR code" className="h-40 w-40 rounded-lg border border-slate-200" />
          <div className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-500">
            Can’t scan? Enter this key manually:
            <code className="mt-1 block select-all break-all text-sm font-semibold tracking-wider text-slate-800">
              {setup.manualEntryKey.replace(/(.{4})/g, '$1 ').trim()}
            </code>
          </div>
          <CodeConfirm code={code} setCode={setCode} busy={busy} onConfirm={confirm} onCancel={reset} />
        </div>
      )}

      {/* Email OTP enrolment */}
      {mode === 'email' && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Enter the 6-digit code we emailed to <span className="font-medium text-slate-800">{user.email}</span>.</p>
          <CodeConfirm code={code} setCode={setCode} busy={busy} onConfirm={confirm} onCancel={reset} />
        </div>
      )}
    </div>
  );
}

function CodeConfirm({ code, setCode, busy, onConfirm, onCancel }: { code: string; setCode: (v: string) => void; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        inputMode="numeric"
        pattern="\d{6}"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        placeholder="000000"
        className="w-32 rounded-lg border border-slate-200 px-3 py-2 text-center text-lg tracking-widest focus:border-blue-400 focus:outline-none"
      />
      <Button variant="primary" disabled={busy || code.length !== 6} onClick={onConfirm}>{busy ? 'Confirming…' : 'Confirm'}</Button>
      <Button variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
    </div>
  );
}
