import { describe, expect, it, vi } from 'vitest';
import { SubmissionStartGate } from './submission-start-gate';

describe('submission start gate', () => {
  it('closes before waiting for an in-flight start and refuses a racing capability', async () => {
    const gate = new SubmissionStartGate();
    const release = gate.begin();
    const drained = vi.fn();
    const closing = gate.closeAndDrain().then(drained);

    expect(gate.state()).toEqual({ closed: true, active: 1 });
    expect(() => gate.begin()).toThrow('signing out');
    expect(drained).not.toHaveBeenCalled();

    release();
    await closing;
    expect(drained).toHaveBeenCalledOnce();
    expect(gate.state()).toEqual({ closed: true, active: 0 });
  });

  it('reopens only after the caller completes its protected logout window', async () => {
    const gate = new SubmissionStartGate();
    await gate.closeAndDrain();
    expect(() => gate.begin()).toThrow('signing out');
    gate.reopen();
    expect(gate.begin()).toBeTypeOf('function');
  });

  it('admits exactly one cross-lane start so one remaining journal slot cannot orphan a server reservation', () => {
    const gate = new SubmissionStartGate();
    const releaseFree = gate.begin();
    expect(() => gate.begin()).toThrow('already being prepared');
    expect(gate.state()).toEqual({ closed: false, active: 1 });
    releaseFree();
    const releaseGenerated = gate.begin();
    expect(gate.state()).toEqual({ closed: false, active: 1 });
    releaseGenerated();
  });
});
