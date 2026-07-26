import React, { useState } from 'react';
import { createSession, getProfile as fetchProfile, requestCode, uploadProfile, verifyCode } from '../lib/api';
import { setProfile, setToken } from '../lib/storage';
import type { Profile } from '../lib/types';
import WarningBanner from './WarningBanner';
import {
  fieldClass,
  PendingLabel,
  PopupHeader,
  primaryButtonClass,
  quietButtonClass,
  StepProgress,
} from './ui';
import { ThinkingOrb } from 'thinking-orbs';

interface OnboardingScreenProps {
  /** `returning` is true when someone signed in to an account that already exists, so the popup
   *  can drop them on the main screen instead of walking them back through setup. */
  onComplete: (profile: Profile, token: string, returning?: boolean) => void;
}

export default function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  const [email, setEmail] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'form' | 'code' | 'uploading'>('form');
  /* E2-12: there was no way into an account you already had. Someone who signed up on the
     website was shown "Set up Litos" and asked for their email and resume a second time. Signing
     in needs no resume: the server already has the parsed profile. */
  const [mode, setMode] = useState<'signup' | 'signin'>('signup');
  const signingIn = mode === 'signin';

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextFile = e.target.files?.[0];
    if (!nextFile) return;
    // The website accepts either, so the extension must too: one product cannot have two rules
    // about the same file.
    const name = nextFile.name.toLowerCase();
    const isPdf = nextFile.type === 'application/pdf' || name.endsWith('.pdf');
    const isDocx =
      nextFile.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      name.endsWith('.docx');
    if (!isPdf && !isDocx) {
      setError('Use a PDF or a Word file.');
      return;
    }
    setError(null);
    setFile(nextFile);
  };

  const finishSignup = async (sessionToken: string) => {
    setStep('uploading');
    await setToken(sessionToken);
    if (signingIn) {
      // The account exists, so read the profile the server already holds rather than asking for
      // the resume again.
      const profile = await fetchProfile(sessionToken);
      await setProfile(profile);
      onComplete(profile, sessionToken, true);
      return;
    }
    const profile = await uploadProfile(sessionToken, file!);
    await setProfile(profile);
    onComplete(profile, sessionToken);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError('Enter your email.');
      return;
    }
    if (!signingIn && !file) {
      setError('Add your resume.');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      await requestCode(email.trim());
      setCode('');
      setStep('code');
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.includes('503') || message.includes('verification_unavailable')) {
        try {
          const { token } = await createSession(email.trim());
          await finishSignup(token);
          return;
        } catch (sessionError) {
          setError(sessionError instanceof Error ? sessionError.message : 'Could not create your account.');
          setStep('form');
        }
      } else {
        setError(message || 'Could not send the verification code. Try again.');
        setStep('form');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Enter the 6-digit code from your email.');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const { token } = await verifyCode(email.trim(), code.trim());
      await finishSignup(token);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Verification failed.';
      setError(
        message.includes('Incorrect') || message.includes('400')
          ? 'That code is not right. Check your email and type it again.'
          : message,
      );
      setStep('code');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError(null);
    setLoading(true);
    try {
      await requestCode(email.trim());
      setCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend the code.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-full animate-fade-in flex-col bg-white">
      <PopupHeader />

      <main className="flex flex-1 flex-col px-5 py-5">
        {step === 'uploading' ? (
          <div className="flex flex-1 flex-col items-start justify-center gap-4" role="status" aria-live="polite">
            <ThinkingOrb state="composing" size={64} />
            <div>
              <h2 className="text-xl font-medium text-gray-950">{signingIn ? 'Signing you in' : 'Reading your resume'}</h2>
              <p className="mt-1 text-sm leading-5 text-gray-600">
                {signingIn
                  ? 'Getting your saved answers.'
                  : 'Pulling out your jobs, projects and skills. This takes a few seconds.'}
              </p>
            </div>
          </div>
        ) : step === 'code' ? (
          <form onSubmit={handleVerify} className="flex flex-col gap-5">
            <div>
              {/* No step number. Typing a code we just emailed you is a door, not a room. */}
              <h2 className="text-xl font-medium text-gray-950">Check your email</h2>
              <p id="code-help" className="mt-1 text-sm leading-5 text-gray-600">
                Enter the code sent to <span className="font-medium text-gray-800">{email}</span>.
              </p>
            </div>

            {error && <WarningBanner message={error} variant="error" />}

            <div className="flex flex-col gap-2">
              <label htmlFor="verification-code" className="text-sm font-medium text-gray-800">
                Verification code
              </label>
              <input
                id="verification-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                autoFocus
                aria-describedby="code-help"
                className={`${fieldClass} h-14 text-center text-xl font-semibold tracking-[0.28em]`}
              />
            </div>

            <button type="submit" disabled={loading} className={primaryButtonClass}>
              {loading ? <PendingLabel state="solving" onColor>Verifying…</PendingLabel> : 'Verify and continue'}
            </button>

            <div className="flex items-center gap-2">
              <button type="button" onClick={handleResend} disabled={loading} className={quietButtonClass}>
                Resend code
              </button>
              <span className="text-gray-400" aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() => {
                  setStep('form');
                  setError(null);
                }}
                className={quietButtonClass}
              >
                Change email
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div>
              {!signingIn && <StepProgress step={1} total={5} />}
              <h2 className="mt-2 text-xl font-medium text-gray-950">{signingIn ? 'Sign in' : 'Set up Litos'}</h2>
              <p className="mt-1 text-sm leading-5 text-gray-600">
                {signingIn
                  ? 'Use the email you signed up with. We will send you a code.'
                  : 'Add your email and resume. You can review everything Litos creates.'}
              </p>
            </div>

            {error && <WarningBanner message={error} variant="error" />}

            <div className="flex flex-col gap-2">
              <label htmlFor="signup-email" className="text-sm font-medium text-gray-800">
                Email address
              </label>
              <input
                id="signup-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={fieldClass}
                required
              />
            </div>

            {!signingIn && (
            <div className="flex flex-col gap-2">
              <div>
                <p className="text-sm font-medium text-gray-800">Resume</p>
                <p id="resume-help" className="mt-0.5 text-xs text-gray-600">A PDF or a Word file.</p>
              </div>
              <input
                id="resume-upload"
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="peer sr-only"
                onChange={handleFileChange}
                aria-describedby="resume-help"
              />
              <label
                htmlFor="resume-upload"
                className={`flex min-h-28 cursor-pointer items-center gap-3 rounded-card border border-dashed px-4 transition-[border-color,background-color,box-shadow] peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 ${
                  file
                    ? 'border-brand-300 bg-brand-50'
                    : 'border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-white'
                }`}
              >
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-inner border border-gray-200 bg-white text-gray-700" aria-hidden="true">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-gray-900">
                    {file ? file.name : 'Choose your resume'}
                  </span>
                  <span className="mt-0.5 block text-xs text-gray-600">
                    {file ? 'Pick a different file' : 'PDF or Word, up to 10 MB'}
                  </span>
                </span>
              </label>
            </div>
            )}

            {/* E2-16: the promise about their resume belongs BEFORE the button that acts on it,
                not below it in the smallest type on the screen. */}
            {!signingIn && (
              <p className="text-xs leading-5 text-gray-600">
                Your resume stays private and is used only to build your applications and drafts.
              </p>
            )}

            <button type="submit" disabled={loading} className={primaryButtonClass}>
              {loading ? <PendingLabel onColor>Sending code…</PendingLabel> : signingIn ? 'Send me a code' : 'Continue'}
            </button>

            <p className="border-t border-gray-200 pt-4 text-sm text-gray-600">
              {signingIn ? 'New to Litos? ' : 'Already have an account? '}
              <button
                type="button"
                onClick={() => { setMode(signingIn ? 'signup' : 'signin'); setError(null); }}
                className="font-medium text-brand-800 underline-offset-4 hover:underline"
              >
                {signingIn ? 'Create one' : 'Sign in'}
              </button>
            </p>
          </form>
        )}
      </main>
    </div>
  );
}
