import { describe, expect, it, vi } from 'vitest';
import { finalizeSubmissionAcknowledgement } from './submission-ack-finalizer';

describe('submission acknowledgement finalization', () => {
  it('does not render Sent or consume evidence when Free session cleanup fails', async () => {
    const render = vi.fn(async () => true);
    const consume = vi.fn(async () => true);

    await expect(finalizeSubmissionAcknowledgement({
      requiresSessionCleanup: true,
      cleanup: async () => { throw new Error('storage unavailable'); },
      render,
      consume,
    })).resolves.toEqual({ terminalReady: false, cleanupPending: true });
    expect(render).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
  });

  it('retains the acknowledgement when the renderer is absent', async () => {
    const consume = vi.fn(async () => true);
    await expect(finalizeSubmissionAcknowledgement({
      requiresSessionCleanup: true,
      cleanup: async () => undefined,
      render: async () => false,
      consume,
    })).resolves.toEqual({ terminalReady: false, cleanupPending: false });
    expect(consume).not.toHaveBeenCalled();
  });

  it('reports terminal readiness only after cleanup, verified render, and exact consumption', async () => {
    const order: string[] = [];
    await expect(finalizeSubmissionAcknowledgement({
      requiresSessionCleanup: true,
      cleanup: async () => { order.push('cleanup'); },
      render: async () => { order.push('render'); return true; },
      consume: async () => { order.push('consume'); return true; },
    })).resolves.toEqual({ terminalReady: true, cleanupPending: false });
    expect(order).toEqual(['cleanup', 'render', 'consume']);
  });
});
