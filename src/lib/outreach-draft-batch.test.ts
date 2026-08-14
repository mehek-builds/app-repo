import { describe, expect, it } from 'vitest';
import { settleOutreachDraftBatch } from './outreach-draft-batch';

describe('outreach draft batch settlement', () => {
  it('keeps a committed successful draft visible when its sibling fails', async () => {
    const targets = [
      { contact: { id: 'contact-1', full_name: 'Ada Lovelace' } },
      { contact: { id: 'contact-2', full_name: 'Grace Hopper' } },
    ];

    const result = await settleOutreachDraftBatch(targets, async (target) => {
      if (target.contact.id === 'contact-2') throw new Error('Draft provider unavailable.');
      return { contact_id: target.contact.id, subject: 'Hello' };
    });

    expect(result.drafts).toEqual([{ contact_id: 'contact-1', subject: 'Hello' }]);
    expect(result.failures).toEqual([{
      contact_id: 'contact-2',
      contact_name: 'Grace Hopper',
      error: 'Draft provider unavailable.',
    }]);
  });
});
