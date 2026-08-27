export type SubmissionAcknowledgementFinalization = {
  terminalReady: boolean;
  cleanupPending: boolean;
};

export async function finalizeSubmissionAcknowledgement(input: {
  requiresSessionCleanup: boolean;
  cleanup: () => Promise<void>;
  render: () => Promise<boolean>;
  consume: () => Promise<boolean>;
}): Promise<SubmissionAcknowledgementFinalization> {
  if (input.requiresSessionCleanup) {
    try {
      await input.cleanup();
    } catch {
      return { terminalReady: false, cleanupPending: true };
    }
  }

  let rendered = false;
  try {
    rendered = await input.render();
  } catch {
    return { terminalReady: false, cleanupPending: false };
  }
  if (!rendered) return { terminalReady: false, cleanupPending: false };

  try {
    return {
      terminalReady: await input.consume(),
      cleanupPending: false,
    };
  } catch {
    return { terminalReady: false, cleanupPending: false };
  }
}
