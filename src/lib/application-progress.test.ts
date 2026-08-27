import { describe, expect, it } from 'vitest';
import {
  classifySubmissionOutcome,
  escapeApplicationText,
  measuredGreenhouseReceipt,
  measuredWorkableReceipt,
  pageShowsSubmissionConfirmation,
  pageSubmissionFailureMessage,
  resumeGenerationProgress,
  resumeGenerationStatus,
  SUBMISSION_MONITOR_TIMEOUT_MS,
  submissionProgress,
} from './application-progress';

describe('application progress copy', () => {
  it('moves through concrete resume-generation phases and always shows elapsed time', () => {
    expect(resumeGenerationProgress(0)).toBe('Reading the role · 0s');
    expect(resumeGenerationProgress(7)).toBe('Matching your strongest experience · 7s');
    expect(resumeGenerationProgress(15)).toBe('Tailoring the resume · 15s');
    expect(resumeGenerationProgress(24)).toBe('Checking layout and accuracy · 24s');
  });

  it('turns an extended submission wait into an explicit unknown state', () => {
    expect(submissionProgress(8)).toContain('Waiting for the company');
    expect(submissionProgress(20)).toContain('Keep this tab open');
    expect(submissionProgress(46)).toContain('Do not send it again');
  });

  it('recognizes common ATS confirmation language without matching a generic form', () => {
    expect(pageShowsSubmissionConfirmation('Thank you for applying. We received your application.')).toBe(true);
    expect(pageShowsSubmissionConfirmation("We've received your application for Software Engineer.")).toBe(true);
    expect(pageShowsSubmissionConfirmation('Apply for this job First Name Last Name')).toBe(false);
  });

  it('surfaces a portal rejection instead of leaving the task in a waiting state', () => {
    expect(pageSubmissionFailureMessage(
      "We couldn't submit your application. Your application submission was flagged as possible spam.",
    )).toContain('possible spam');
    expect(pageSubmissionFailureMessage('Apply for this job First Name Last Name')).toBeNull();
  });

  it('keeps a capacity retry visible until generation resolves', () => {
    expect(resumeGenerationStatus(24, 'The AI is busy. Retrying attempt 2.')).toBe(
      'The AI is busy. Retrying attempt 2.',
    );
    expect(resumeGenerationStatus(24, null)).toBe('Checking layout and accuracy · 24s');
  });

  it('escapes portal-controlled job metadata before card rendering', () => {
    expect(escapeApplicationText('<img src=x onerror="alert(1)"> & test')).toBe(
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; test',
    );
  });

  it('gives a portal rejection precedence over generic confirmation text', () => {
    expect(classifySubmissionOutcome(
      "Application submitted. We couldn't submit your application because it was possible spam.",
    )).toEqual({
      kind: 'failure',
      message: 'The company turned this down as possible spam. Look over the form before trying again.',
    });
    expect(classifySubmissionOutcome('Thank you for applying.')).toEqual({ kind: 'confirmed' });
    expect(classifySubmissionOutcome('Application form')).toBeNull();
  });

  it.each([
    'There was an error submitting your application.',
    'We encountered a problem while submitting. Thank you for applying.',
    'Your application did not go through.',
    'We were unable to process this application.',
    'Application not submitted.',
    'The submission was unsuccessful.',
    'We failed to submit your application.',
    'We could not submit your application.',
  ])('lets negative evidence dominate positive or ambiguous page text: %s', (text) => {
    expect(classifySubmissionOutcome(text)?.kind).toBe('failure');
  });

  it('emits typed Workable proof only from the exact selector, route, and absent form', () => {
    const startedUrl = 'https://apply.workable.com/acme/j/1234abcdef/apply/';
    expect(measuredWorkableReceipt({
      startedUrl,
      finalUrl: `${startedUrl}?success`,
      successfulSubmitText: '  Your application has been\nsubmitted successfully. ',
      formStillPresent: false,
    })).toEqual({
      confirmationText: 'Your application has been submitted successfully.',
      receiptProof: {
        version: 1,
        family: 'workable',
        state: 'application_submitted',
        evidence: 'workable_successful_submit',
        form_still_present: false,
      },
    });
    expect(measuredWorkableReceipt({
      startedUrl,
      finalUrl: `${startedUrl}?success`,
      successfulSubmitText: 'There was an error submitting. Your application has been submitted successfully.',
      formStillPresent: false,
    })).toBeNull();
    expect(measuredWorkableReceipt({
      startedUrl,
      finalUrl: `${startedUrl}?success`,
      successfulSubmitText: 'Your application has been submitted successfully.',
      formStillPresent: true,
    })).toBeNull();
  });

  it('uses the validated selector excerpt even when whole-page prose exceeds 2,000 characters', () => {
    const wholePage = `${'unrelated '.repeat(250)}Your application has been submitted successfully.`;
    expect(wholePage.length).toBeGreaterThan(2_000);
    const startedUrl = 'https://apply.workable.com/acme/j/1234abcdef/apply/';
    expect(measuredWorkableReceipt({
      startedUrl,
      finalUrl: `${startedUrl}?success`,
      successfulSubmitText: 'Your application has been submitted successfully.',
      formStillPresent: false,
    })?.confirmationText).toBe('Your application has been submitted successfully.');
  });

  it('emits typed Greenhouse proof only for the exact portal-owned confirmation route and absent form', () => {
    const startedUrl = 'https://job-boards.greenhouse.io/acme/jobs/1234567';
    expect(measuredGreenhouseReceipt({
      startedUrl,
      finalUrl: `${startedUrl}/confirmation`,
      confirmationBodyText: ' Thank you, Acme will be in touch. ',
      formStillPresent: false,
    })).toEqual({
      confirmationText: 'Thank you, Acme will be in touch.',
      receiptProof: {
        version: 1,
        family: 'greenhouse',
        state: 'application_submitted',
        evidence: 'greenhouse_confirmation_content',
        form_still_present: false,
      },
    });
    expect(measuredGreenhouseReceipt({
      startedUrl,
      finalUrl: `${startedUrl}/confirmation?source=untrusted`,
      confirmationBodyText: 'Thank you.',
      formStillPresent: false,
    })).toBeNull();
    expect(measuredGreenhouseReceipt({
      startedUrl,
      finalUrl: `${startedUrl}/confirmation`,
      confirmationBodyText: 'Thank you.',
      formStillPresent: true,
    })).toBeNull();
    expect(measuredGreenhouseReceipt({
      startedUrl: 'https://boards.greenhouse.io/acme/jobs/1234567',
      finalUrl: 'https://boards.greenhouse.io/acme/jobs/1234567/confirmation',
      confirmationBodyText: 'Thank you.',
      formStillPresent: false,
    })).toBeNull();

    const embedStart = 'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=1234567';
    expect(measuredGreenhouseReceipt({
      startedUrl: embedStart,
      finalUrl: 'https://job-boards.greenhouse.io/embed/job_app/confirmation?token=1234567&for=acme',
      confirmationBodyText: 'Application received.',
      formStillPresent: false,
    })?.receiptProof.family).toBe('greenhouse');
    for (const finalUrl of [
      'https://job-boards.greenhouse.io/embed/job_app/confirmation?token=7654321&for=acme',
      'https://job-boards.greenhouse.io/embed/job_app/confirmation?token=1234567&for=other',
      'https://job-boards.greenhouse.io/embed/job_app/confirmation?for=acme',
      'https://job-boards.eu.greenhouse.io/embed/job_app/confirmation?token=1234567&for=acme',
      'https://job-boards.greenhouse.io/embed/job_app/confirmation?token=1234567&for=acme&source=x',
    ]) {
      expect(measuredGreenhouseReceipt({
        startedUrl: embedStart,
        finalUrl,
        confirmationBodyText: 'Application received.',
        formStillPresent: false,
      })).toBeNull();
    }
    expect(measuredGreenhouseReceipt({
      startedUrl: embedStart,
      finalUrl: 'https://job-boards.greenhouse.io/embed/job_app/confirmation?token=1234567&for=acme',
      confirmationBodyText: 'Application received.',
      formStillPresent: true,
    })).toBeNull();

    const longBody = `${'x'.repeat(1_100)} Your application has been submitted successfully.`;
    expect(measuredGreenhouseReceipt({
      startedUrl: embedStart,
      finalUrl: 'https://job-boards.greenhouse.io/embed/job_app/confirmation?token=1234567&for=acme',
      confirmationBodyText: longBody,
      formStillPresent: false,
    })?.confirmationText).toBe(longBody);
  });

  it('bounds active portal monitoring to one minute', () => {
    expect(SUBMISSION_MONITOR_TIMEOUT_MS).toBe(60_000);
  });
});
