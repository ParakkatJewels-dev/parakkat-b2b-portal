import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from '../lib/router';
import * as onboardingApi from '../api/onboarding.api';
import {
  clearResumeSession,
  loadResumeSession,
  saveResumeSession,
} from '../store/onboardingSession';
import type { DocType, DocumentSummary, DraftFields } from '../types/onboarding';
import { ThemeToggle } from '../components/ThemeToggle';

interface FieldDef {
  name: keyof DraftFields;
  label: string;
  placeholder?: string;
  type?: string;
  optional?: boolean;
}

interface StepDef {
  num: number;
  title: string;
  fields: FieldDef[];
}

const STEPS: StepDef[] = [
  {
    num: 1,
    title: 'Partner Mode & Identity',
    fields: [
      { name: 'legalName', label: 'Legal Name' },
      { name: 'gstin', label: 'GSTIN', placeholder: '22AAAAA0000A1Z5' },
      { name: 'pan', label: 'PAN', placeholder: 'AAAAA0000A' },
    ],
  },
  {
    num: 2,
    title: 'Contact & Office Address',
    fields: [
      { name: 'businessContactEmail', label: 'Business email', type: 'email' },
      { name: 'businessContactPhone', label: 'Business phone', placeholder: '10-digit mobile' },
      { name: 'addressLine1', label: 'Address line 1' },
      { name: 'addressLine2', label: 'Address line 2', optional: true },
      { name: 'city', label: 'City' },
      { name: 'state', label: 'State' },
      { name: 'postalCode', label: 'Postal code', placeholder: '560001' },
      { name: 'country', label: 'Country' },
    ],
  },
  {
    num: 3,
    title: 'Representative & Bank Setup',
    fields: [
      { name: 'repName', label: 'Representative name' },
      { name: 'repDesignation', label: 'Designation' },
      { name: 'repEmail', label: 'Personal email', type: 'email' },
      { name: 'repMobile', label: 'Personal mobile', placeholder: '10-digit mobile' },
      { name: 'repAadhaarRef', label: 'Aadhaar reference (for eKYC)' },
      { name: 'bankAccount', label: 'Bank account number' },
      { name: 'ifsc', label: 'IFSC code', placeholder: 'ABCD0123456' },
      { name: 'accountHolder', label: 'Account holder name' },
    ],
  },
  {
    num: 4,
    title: 'Upload Documents & Submit',
    fields: [],
  },
];

const DOC_TYPES: { value: DocType; label: string }[] = [
  { value: 'REGISTRATION_PROOF', label: 'Registration proof' },
  { value: 'ADDRESS_PROOF', label: 'Address proof' },
  { value: 'OTHER', label: 'Other document' },
];

export function RegisterPage() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [fields, setFields] = useState<DraftFields>(() => {
    const query = new URLSearchParams(window.location.search);
    const initialIndependent = query.get('type') === 'independent';
    return {
      country: 'India',
      isIndependent: initialIndependent,
      repDesignation: initialIndependent ? 'Independent Agent' : '',
    };
  });
  const [session, setSession] = useState(() => loadResumeSession());
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!session) return;
    onboardingApi
      .getDraft(session.applicationId, session.resumeToken)
      .then((res) => {
        if (res.application.lifecycleState !== 'DRAFT') {
          navigate('/onboarding/status');
          return;
        }
        const { id: _id, lifecycleState: _s, submittedAt: _sub, ...rest } = res.application;
        void _id;
        void _s;
        void _sub;
        setFields((prev) => ({ ...prev, ...rest }));
        return onboardingApi.listDocuments(session.applicationId, session.resumeToken);
      })
      .then((res) => res && setDocuments(res.documents))
      .catch(() => {
        clearResumeSession();
        setSession(null);
      });
  }, [session, navigate]);

  function update(name: keyof DraftFields, value: string | boolean) {
    setFields((prev) => ({ ...prev, [name]: value }));
  }

  function copyToken() {
    if (session) {
      navigator.clipboard.writeText(session.resumeToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function jumpToStep(stepNum: number) {
    if (stepNum < currentStep || (session && stepNum <= 4)) {
      setCurrentStep(stepNum);
    }
  }

  async function saveDraft(): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (!session) {
        const res = await onboardingApi.createDraft(fields);
        const next = { applicationId: res.applicationId, resumeToken: res.resumeToken };
        saveResumeSession(next);
        setSession(next);
        setNotice('Registration draft saved. You can safely close this page.');
      } else {
        await onboardingApi.updateDraft(session.applicationId, session.resumeToken, fields);
        setNotice('Draft updated.');
      }
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(false);
    }
  }

  async function goNext(): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (!session) {
        const res = await onboardingApi.createDraft(fields);
        const next = { applicationId: res.applicationId, resumeToken: res.resumeToken };
        saveResumeSession(next);
        setSession(next);
      } else {
        await onboardingApi.updateDraft(session.applicationId, session.resumeToken, fields);
      }
      setCurrentStep((prev) => Math.min(prev + 1, 4));
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(false);
    }
  }

  function goBack() {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  }

  async function submit(): Promise<void> {
    if (!session) return;
    setError(null);
    setBusy(true);
    try {
      await onboardingApi.submitApplication(session.applicationId, session.resumeToken);
      navigate('/onboarding/status');
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!session) return;
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem('file') as HTMLInputElement;
    const docTypeInput = form.elements.namedItem('docType') as HTMLSelectElement;
    if (!fileInput.files?.[0]) return;
    setError(null);
    setBusy(true);
    try {
      await onboardingApi.uploadDocument(
        session.applicationId,
        session.resumeToken,
        docTypeInput.value as DocType,
        fileInput.files[0],
      );
      form.reset();
      const res = await onboardingApi.listDocuments(session.applicationId, session.resumeToken);
      setDocuments(res.documents);
    } catch (err) {
      setError(extractError(err));
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

      {/* Left panel - Brand Timeline Indicator & Resume Box (Sticky on Large Screens) */}
      <div className="relative hidden w-5/12 flex-col justify-between overflow-hidden bg-gradient-to-br from-indigo-50 via-slate-100 to-indigo-100/50 dark:from-indigo-950 dark:via-slate-950 dark:to-indigo-950 p-8 lg:flex border-r border-slate-200/50 dark:border-slate-900">
        {/* Glow Decorators */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(99,102,241,0.06),rgba(0,0,0,0))]" />
        <div className="absolute -left-20 -top-20 h-80 w-80 rounded-full bg-indigo-500/5 dark:bg-indigo-500/10 blur-[80px]" />
        <div className="absolute -bottom-40 -right-20 h-96 w-96 rounded-full bg-violet-600/5 dark:bg-violet-600/10 blur-[100px]" />

        {/* Logo */}
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

        {/* Form Stepper timeline */}
        <div className="relative z-10 my-auto max-w-xs space-y-6 animate-fade-in">
          <div className="space-y-2">
            <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Partner Onboarding</h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              Follow our simple, completely secure step-by-step registration workspace.
            </p>
          </div>

          <div className="space-y-6 pl-4 border-l border-slate-200 dark:border-slate-800">
            {STEPS.map((step) => {
              const isCompleted = step.num < currentStep;
              const isActive = step.num === currentStep;
              return (
                <button
                  key={step.num}
                  disabled={!isCompleted && !isActive && !session}
                  onClick={() => jumpToStep(step.num)}
                  className="relative block text-left w-full outline-none focus:outline-none disabled:cursor-not-allowed group"
                >
                  <div className={`absolute -left-[25px] top-1.5 flex h-4.5 w-4.5 items-center justify-center rounded-full border transition-all ${
                    isCompleted 
                      ? 'border-emerald-500 bg-emerald-500 text-white' 
                      : isActive 
                        ? 'border-indigo-500 bg-white dark:bg-slate-950 text-indigo-600 dark:text-indigo-400 ring-4 ring-indigo-500/10 dark:ring-indigo-500/10' 
                        : 'border-slate-300 bg-white text-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-600'
                  }`}>
                    {isCompleted ? (
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <span className="text-[9px] font-bold">{step.num}</span>
                    )}
                  </div>
                  <h4 className={`text-sm font-semibold transition-colors ${
                    isActive ? 'text-indigo-600 dark:text-indigo-400' : isCompleted ? 'text-slate-700 dark:text-slate-300 group-hover:text-indigo-600 dark:group-hover:text-indigo-300' : 'text-slate-400 dark:text-slate-500'
                  }`}>
                    {step.title}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-505 mt-0.5">
                    {step.num === 1 && "Select path & identity IDs"}
                    {step.num === 2 && "Enter contacts & business address"}
                    {step.num === 3 && "Setup representative & bank keys"}
                    {step.num === 4 && "Provide KYC documents & submit"}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Resume Token Box */}
          {session && (
            <div className="rounded-xl border border-indigo-500/10 bg-indigo-500/5 dark:border-indigo-500/20 dark:bg-indigo-500/5 p-4 backdrop-blur-sm space-y-3 animate-fade-in">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">Resume Draft Active</span>
                <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Use this token to resume your application later from the resume portal.
              </p>
              <div className="flex items-center gap-2 rounded-lg bg-white border border-slate-200 dark:bg-slate-900 dark:border-slate-800 p-2">
                <span className="font-mono text-xs text-indigo-600 dark:text-indigo-300 select-all truncate flex-1">{session.resumeToken}</span>
                <button
                  onClick={copyToken}
                  className="rounded bg-indigo-600 px-2 py-1 text-[10px] font-bold text-white transition-colors hover:bg-indigo-500"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="relative z-10 text-xs text-slate-400 dark:text-slate-500">
          &copy; {new Date().getFullYear()} Parakkat Resorts. Safe & Verified.
        </div>
      </div>

      {/* Right panel - Scrollable registration workspace */}
      <div className="flex w-full flex-col bg-white dark:bg-slate-950 p-4 sm:p-8 lg:w-7/12 overflow-y-auto max-h-screen">
        <div className="mx-auto w-full max-w-lg space-y-6 animate-fade-up">
          {/* Top Form Navigation */}
          <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-900 pb-4">
            <span className="text-xs text-slate-500 dark:text-slate-500 uppercase tracking-widest font-semibold">Step {currentStep} of 4</span>
            <Link to="/login" className="text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 font-semibold hover:underline">
              ← Already a partner? Sign in
            </Link>
          </div>

          {/* Form Header */}
          <div className="space-y-1">
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">{STEPS[currentStep - 1].title}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Please provide precise information. Field state is saved automatically.</p>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-400 animate-fade-in">
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {notice && (
            <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-900/40 dark:bg-green-950/20 dark:text-green-400 animate-fade-in">
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span>{notice}</span>
            </div>
          )}

          <div className="space-y-6">
            {/* Step 1 Specific: Mode Selector */}
            {currentStep === 1 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/20 p-4 animate-fade-in">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-2.5">
                  Partner Mode
                </span>
                <label className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!!fields.isIndependent}
                    disabled={!!session}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      update('isIndependent', checked);
                      if (checked) {
                        update('gstin', '');
                        update('repDesignation', 'Independent Agent');
                      } else {
                        update('repDesignation', '');
                      }
                    }}
                    className="rounded border-slate-300 dark:border-slate-800 text-indigo-600 bg-white dark:bg-slate-950 focus:ring-indigo-500 focus:ring-offset-white dark:focus:ring-offset-slate-950 h-4.5 w-4.5 disabled:opacity-50"
                  />
                  <div>
                    <span className="font-semibold text-slate-900 dark:text-white">Register as Independent Agent</span>
                    <p className="text-xs text-slate-500 dark:text-slate-505 mt-0.5">Bypasses GST certificate verification. Verification is run solely on PAN & Aadhaar KYC.</p>
                  </div>
                </label>
              </div>
            )}

            {/* Render form fields of the current step */}
            {currentStep < 4 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800/80 dark:bg-slate-900/40 p-4 space-y-3 animate-fade-in">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                  {STEPS[currentStep - 1].title}
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {STEPS[currentStep - 1].fields.map((field) => {
                    if (field.name === 'gstin' && fields.isIndependent) {
                      return null;
                    }
                    return (
                      <label key={field.name} className="block text-sm space-y-1.5 animate-fade-in">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                          {field.label}
                          {field.optional && <span className="text-slate-400 dark:text-slate-505"> (optional)</span>}
                        </span>
                        <input
                          type={field.type ?? 'text'}
                          value={(fields[field.name] as string) ?? ''}
                          placeholder={field.placeholder}
                          disabled={field.name === 'repDesignation' && !!fields.isIndependent}
                          onChange={(e) => update(field.name, e.target.value)}
                          className="w-full rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950 py-2 px-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 disabled:bg-slate-100 dark:disabled:bg-slate-900 disabled:text-slate-400 dark:disabled:text-slate-500 disabled:border-slate-200 dark:disabled:border-slate-900"
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Step 4: Documents Uploader */}
            {currentStep === 4 && (
              <div className="space-y-6 animate-fade-in">
                {session ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800/80 dark:bg-slate-900/40 p-4 space-y-3">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                        Onboarding Identity Documents
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-505">Provide high-resolution registration/address proof files.</p>
                    </div>

                    <form onSubmit={handleUpload} className="flex flex-wrap items-end gap-3 rounded-lg bg-white border border-slate-200 dark:bg-slate-950 dark:border-slate-900 p-4">
                      <label className="text-sm space-y-1 flex-1 min-w-[150px]">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Document Type</span>
                        <select name="docType" className="w-full rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 py-2 px-3 text-xs text-slate-900 dark:text-white placeholder-slate-500 outline-none focus:border-indigo-500">
                          {DOC_TYPES.map((d) => (
                            <option key={d.value} value={d.value}>
                              {d.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm space-y-1 flex-1 min-w-[200px]">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Select File</span>
                        <input name="file" type="file" required accept=".pdf,.jpg,.jpeg,.png" className="w-full text-xs text-slate-500 dark:text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-slate-200 dark:file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 dark:file:bg-indigo-600/10 file:text-indigo-600 dark:file:text-indigo-400 hover:file:bg-indigo-100 dark:hover:file:bg-indigo-600/20" />
                      </label>
                      <button
                        type="submit"
                        disabled={busy}
                        className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-bold text-white disabled:opacity-50 active:scale-[0.97]"
                      >
                        Upload
                      </button>
                    </form>

                    {/* Uploaded Documents List */}
                    <div className="space-y-2">
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-500 block">Uploaded Files</span>
                      <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
                        {documents.map((doc) => (
                          <li key={doc.id} className="flex justify-between items-center rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950 px-3.5 py-2.5">
                            <div className="flex items-center gap-2">
                              <svg className="h-4 w-4 text-slate-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                              <span className="text-slate-800 dark:text-slate-200 truncate max-w-[200px]">{doc.fileName}</span>
                            </div>
                            <span className="rounded bg-slate-50 border border-slate-200 dark:bg-slate-900 dark:border-slate-800 px-2 py-0.5 text-[9px] font-bold text-slate-500 uppercase tracking-wider">{doc.docType}</span>
                          </li>
                        ))}
                        {documents.length === 0 && <li className="text-slate-500 dark:text-slate-600 italic py-2 text-center bg-slate-50 dark:bg-slate-950/20 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">No documents uploaded yet.</li>}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/10 p-8 text-center space-y-3">
                    <p className="text-sm text-slate-500 dark:text-slate-400">You must initialize your draft registration before uploading files.</p>
                    <button onClick={saveDraft} className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2.5 text-xs font-bold text-white transition-colors">Initialize Registration Draft</button>
                  </div>
                )}
              </div>
            )}

            {/* Stepper Wizard Navigation Controls */}
            <div className="flex justify-between items-center pt-4 border-t border-slate-100 dark:border-slate-900 mt-6">
              <div>
                {currentStep > 1 && (
                  <button
                    type="button"
                    onClick={goBack}
                    disabled={busy}
                    className="rounded-xl bg-slate-100 border border-slate-200 hover:bg-slate-200 text-slate-700 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 px-5 py-2.5 text-xs font-bold transition-all disabled:opacity-50"
                  >
                    ← Previous
                  </button>
                )}
              </div>
              
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={saveDraft}
                  disabled={busy}
                  className="rounded-xl bg-slate-100 border border-slate-200 hover:bg-slate-200 text-slate-700 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 px-5 py-2.5 text-xs font-bold transition-all disabled:opacity-50"
                >
                  Save Draft
                </button>
                
                {currentStep < 4 ? (
                  <button
                    type="button"
                    onClick={goNext}
                    disabled={busy}
                    className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-500/10 hover:from-indigo-500 hover:to-violet-500 transition-all disabled:opacity-50 active:scale-[0.98]"
                  >
                    {busy ? 'Saving...' : 'Next Step →'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={submit}
                    disabled={busy || !session}
                    className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-500/10 hover:from-indigo-500 hover:to-violet-500 transition-all disabled:opacity-50 active:scale-[0.98]"
                  >
                    {busy ? 'Submitting...' : 'Submit Verification'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function extractError(err: unknown): string {
  return (
    (err as { response?: { data?: { message?: string } } }).response?.data?.message ??
    'Something went wrong'
  );
}
