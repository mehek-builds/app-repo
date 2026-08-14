export type OutreachDraftFailure = {
  contact_id: string;
  contact_name: string;
  error: string;
};

type NamedContact = {
  contact: {
    id: string;
    full_name: string;
  };
};

/**
 * Settles every independently metered outreach draft. A sibling failure must
 * never erase a successful draft whose backend usage has already committed.
 */
export async function settleOutreachDraftBatch<T extends NamedContact, R>(
  targets: readonly T[],
  generate: (target: T) => Promise<R>,
): Promise<{ drafts: R[]; failures: OutreachDraftFailure[] }> {
  const settled = await Promise.allSettled(targets.map((target) => generate(target)));
  const drafts: R[] = [];
  const failures: OutreachDraftFailure[] = [];

  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      drafts.push(result.value);
      return;
    }
    const target = targets[index];
    failures.push({
      contact_id: target.contact.id,
      contact_name: target.contact.full_name,
      error: result.reason instanceof Error ? result.reason.message : 'Draft generation failed.',
    });
  });

  return { drafts, failures };
}
