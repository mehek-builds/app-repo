import { describe, expect, it } from 'vitest';
import { createFillActionGate, type FillAccess } from './application-fill-action';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe('application fill action gate', () => {
  it('waits out a fast Trial click and routes the freshly entitled action to tailoring', async () => {
    const initial = deferred<FillAccess>();
    let calls = 0;
    const gate = createFillActionGate(() => {
      calls += 1;
      return calls === 1 ? initial.promise : Promise.resolve({ can_tailor: true });
    });

    let settled = false;
    const click = gate.resolvePrimary().then((route) => {
      settled = true;
      return route;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    initial.resolve({ can_tailor: true });
    await expect(gate.ready()).resolves.toMatchObject({
      primaryAction: 'tailor',
      primaryLabel: 'Tailor resume',
    });
    await expect(click).resolves.toMatchObject({ action: 'tailor', showUpgrade: false });
    expect(calls).toBe(2);
  });

  it('falls back to Free with an upgrade explanation if tailoring expires before click', async () => {
    let calls = 0;
    const gate = createFillActionGate(async () => ({ can_tailor: calls++ === 0 }));
    await gate.ready();
    await expect(gate.resolvePrimary()).resolves.toMatchObject({ action: 'free', showUpgrade: true });
  });
});
