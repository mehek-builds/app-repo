import { describe, expect, it } from 'vitest';
import { derivedOperationId } from './operation-id';

describe('derived operation IDs', () => {
  it('returns the same valid UUID for one parent operation and item', async () => {
    const parent = '123e4567-e89b-12d3-a456-426614174000';
    const first = await derivedOperationId(parent, 'contact-1');
    const retry = await derivedOperationId(parent, 'contact-1');
    expect(retry).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('separates selected contacts under the same resolve action', async () => {
    const parent = '123e4567-e89b-12d3-a456-426614174000';
    await expect(derivedOperationId(parent, 'contact-1')).resolves.not.toBe(
      await derivedOperationId(parent, 'contact-2'),
    );
  });
});
