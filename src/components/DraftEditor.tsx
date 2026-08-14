import React, { useEffect, useRef, useState } from 'react';
import { ensureOutreachApplication, generateDraft, trackEvent } from '../lib/api';
import { isMonetizationError } from '../lib/api-error';
import { buildGmailComposeLink } from '../lib/gmail';
import type { OutreachPremiumActionContext } from '../lib/extension-premium-action';
import type { Contact, Draft, JobContext, OutreachDraftType, Profile } from '../lib/types';
import { SkeletonDraft } from './Skeleton';
import WarningBanner from './WarningBanner';
import {
  PendingLabel,
  PopupHeader,
  primaryButtonClass,
  secondaryButtonClass,
  StatusDot,
  textAreaClass,
  quietButtonClass,
  fieldClass,
} from './ui';

interface DraftEditorProps {
  contact: Contact;
  job: JobContext;
  token: string;
  profile: Profile;
  onBack: () => void;
  onDraftAnother: () => void;
  onViewPlans?: (context: OutreachPremiumActionContext) => void;
  prebuiltDraft?: Draft | null;
  deferGeneration?: boolean;
  focusGenerate?: boolean;
  operationIdOverride?: string;
  initialDraftType?: OutreachDraftType;
  initialSubject?: string;
  initialBody?: string;
}

const DRAFT_TYPES: ReadonlyArray<{ value: OutreachDraftType; label: string }> = [
  { value: 'first_note', label: 'First note' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'thank_you', label: 'Thank-you' },
  { value: 'referral_ask', label: 'Referral ask' },
  { value: 'offer_stage', label: 'Offer-stage' },
];

export default function DraftEditor({
  contact,
  job,
  token,
  profile,
  onBack,
  onDraftAnother,
  onViewPlans = () => {},
  prebuiltDraft,
  deferGeneration = false,
  focusGenerate = false,
  operationIdOverride,
  initialDraftType = 'first_note',
  initialSubject = '',
  initialBody = '',
}: DraftEditorProps) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [loading, setLoading] = useState(!deferGeneration);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [gmailOpened, setGmailOpened] = useState(false);
  const [markingSent, setMarkingSent] = useState(false);
  const [markedSent, setMarkedSent] = useState(false);
  const [paywall, setPaywall] = useState(false);
  const [draftType, setDraftType] = useState<OutreachDraftType>(initialDraftType);
  const [generatedDraftType, setGeneratedDraftType] = useState<OutreachDraftType | null>(prebuiltDraft?.draft_type ?? null);
  const [blockedOperationId, setBlockedOperationId] = useState<string | null>(null);
  const [blockedDraftType, setBlockedDraftType] = useState<OutreachDraftType | null>(null);
  const draftOperationId = useRef<string>(operationIdOverride ?? crypto.randomUUID());
  const operationDraftType = useRef<OutreachDraftType>(initialDraftType);
  const canonicalApplicationId = useRef<string | null>(job.application_id ?? null);

  const runGeneration = async () => {
    if (operationDraftType.current !== draftType) {
      draftOperationId.current = crypto.randomUUID();
      operationDraftType.current = draftType;
    }
    const operationId = draftOperationId.current;
    setLoading(true);
    setError(null);
    setPaywall(false);
    try {
      const applicationId = canonicalApplicationId.current ?? await ensureOutreachApplication(token, {
        company: job.company,
        role: job.role,
        ...(job.domain ? { domain: job.domain } : {}),
        ...(job.url ? { url: job.url } : {}),
      });
      canonicalApplicationId.current = applicationId;
      const nextDraft = await generateDraft(token, {
        application_id: applicationId,
        contact,
        role: job.role,
        company: job.company,
        user_profile: profile,
        operation_id: operationId,
        draft_type: draftType,
      });
      setDraft(nextDraft);
      setSubject(nextDraft.subject);
      setBody(nextDraft.body);
      setGeneratedDraftType(nextDraft.draft_type ?? draftType);
      setBlockedOperationId(null);
      setBlockedDraftType(null);
      draftOperationId.current = crypto.randomUUID();
    } catch (err) {
      if (isMonetizationError(err)) {
        setBlockedOperationId(operationId);
        setBlockedDraftType(draftType);
        setPaywall(true);
        setError('A new AI outreach draft is part of Litos+. You can write, copy, and send this message yourself.');
        setDraft({ subject: '', body: '', word_count: 0, warnings: [] });
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not generate the draft.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (prebuiltDraft) {
      setDraft(prebuiltDraft);
      setSubject(prebuiltDraft.subject);
      setBody(prebuiltDraft.body);
      setDraftType(prebuiltDraft.draft_type ?? 'first_note');
      setGeneratedDraftType(prebuiltDraft.draft_type ?? 'first_note');
      setLoading(false);
      return;
    }
    if (deferGeneration) {
      setLoading(false);
      return;
    }
    void runGeneration();
  }, []);

  useEffect(() => {
    if (!focusGenerate) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById('litos-outreach-generation-control')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusGenerate]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = `Subject: ${subject}\n\n${body}`;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        setError('Could not copy the draft.');
      }
    }
  };

  const handleOpenGmail = async () => {
    const link = buildGmailComposeLink(contact.email ?? '', subject, body);
    try {
      await chrome.tabs.create({ url: link });
      setGmailOpened(true);
      setTimeout(() => setGmailOpened(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open Gmail.');
    }
  };

  const handleMarkSent = async () => {
    setMarkingSent(true);
    try {
      const channel = contact.status === 'linkedin_only' ? 'linkedin' : 'email';
      await trackEvent(token, {
        contact_id: contact.id,
        channel,
        subject,
        draft_text: body,
        outcome: 'sent',
      });
      setMarkedSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not mark the draft as sent.');
    } finally {
      setMarkingSent(false);
    }
  };

  return (
    <div className="flex min-h-full animate-slide-in-right flex-col bg-white">
      <PopupHeader title="Draft email" subtitle={`${contact.full_name} · ${contact.title}`} onBack={onBack} />

      <main className="flex flex-1 flex-col gap-4 px-4 py-4">
        {loading ? (
          <div className="flex flex-col gap-3" role="status" aria-live="polite">
            <p className="text-sm text-gray-600">Writing your draft…</p>
            <SkeletonDraft />
          </div>
        ) : deferGeneration && !draft ? (
          <div className="flex flex-col gap-3 rounded-inner border border-brand-200 bg-brand-50 p-4">
            <p className="text-sm font-medium text-gray-950">Ready to generate for {contact.full_name}</p>
            <p className="text-xs leading-5 text-gray-700">Litos restored this exact contact. Generate only when you are ready.</p>
            {error && <WarningBanner message={error} variant="error" />}
            <button
              id="litos-outreach-generation-control"
              type="button"
              onClick={() => void runGeneration()}
              className={primaryButtonClass}
            >
              {error ? 'Retry generation' : 'Generate draft'}
            </button>
          </div>
        ) : error && !draft ? (
          <WarningBanner message={error} variant="error" />
        ) : draft ? (
          <>
            {error && <WarningBanner message={error} variant={paywall ? 'info' : 'error'} />}

            {paywall && (
              <div className="flex items-center justify-between gap-3 rounded-inner bg-brand-50 px-3 py-2">
                <p className="text-xs leading-5 text-gray-700">Your contact and anything you type here stay available.</p>
                <button
                  type="button"
                  onClick={() => {
                    if (!canonicalApplicationId.current) return;
                    onViewPlans({
                      application_id: canonicalApplicationId.current,
                      contact_id: contact.id,
                      contact,
                      company: job.company,
                      role: job.role,
                      ...(job.url ? { portal_url: job.url } : {}),
                      operation_id: blockedOperationId ?? draftOperationId.current,
                      draft_type: blockedDraftType ?? draftType,
                      draft_subject: subject,
                      draft_body: body,
                    });
                  }}
                  className="min-h-11 flex-shrink-0 text-xs font-medium text-brand-800 underline-offset-4 hover:underline"
                >
                  See Litos+
                </button>
              </div>
            )}

            {draft.warnings.map((warning, index) => (
              <WarningBanner key={index} message={warning} variant="warning" />
            ))}

            {markedSent && (
              <div className="flex min-h-11 items-center gap-2 border-y border-success-200 py-2 text-sm font-medium text-success-700" role="status" aria-live="polite">
                <StatusDot tone="success" />
                Logged as sent
              </div>
            )}

            <div className="flex items-center gap-2 border-b border-gray-200 pb-3 text-xs text-gray-600">
              <StatusDot tone={contact.status === 'verified' ? 'success' : 'warning'} />
              <span className="truncate">To {contact.email ?? contact.linkedin_url ?? contact.full_name}</span>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="draft-type" className="text-sm font-medium text-gray-800">Message type</label>
              <select
                id="draft-type"
                value={draftType}
                onChange={(event) => setDraftType(event.target.value as OutreachDraftType)}
                className={fieldClass}
              >
                {DRAFT_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              {generatedDraftType !== draftType && (
                <button
                  type="button"
                  onClick={() => void runGeneration()}
                  className={secondaryButtonClass}
                >
                  Generate this message type
                </button>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="draft-subject" className="text-sm font-medium text-gray-800">Subject</label>
              <input
                id="draft-subject"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className={fieldClass}
              />
            </div>

            <div className="flex flex-1 flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="draft-body" className="text-sm font-medium text-gray-800">Message</label>
              </div>
              <textarea
                id="draft-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={10}
                className={textAreaClass}
              />
            </div>
          </>
        ) : null}
      </main>

      {draft && !loading && (
        <footer className="sticky bottom-0 z-20 border-t border-gray-200 bg-white px-4 py-3">
          <div className="flex gap-2">
            <button type="button" onClick={handleCopy} className={`${secondaryButtonClass} flex-1`}>
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" onClick={handleOpenGmail} className={`${primaryButtonClass} flex-[1.5]`}>
              {gmailOpened ? 'Opened Gmail' : 'Open in Gmail'}
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-gray-200 pt-2">
            <button type="button" onClick={onDraftAnother} className={quietButtonClass}>Write another</button>
            <button
              type="button"
              onClick={handleMarkSent}
              disabled={markingSent || markedSent}
              className={quietButtonClass}
            >
              {markingSent ? <PendingLabel>Saving…</PendingLabel> : markedSent ? 'Marked as sent' : 'I sent it'}
            </button>
          </div>
          {(copied || gmailOpened) && (
            <span className="sr-only" role="status" aria-live="polite">
              {copied ? 'Draft copied' : 'Gmail opened'}
            </span>
          )}
        </footer>
      )}
    </div>
  );
}
