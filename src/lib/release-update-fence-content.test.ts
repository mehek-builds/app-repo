import { describe, expect, it } from 'vitest';
import {
  activatePreArmBoundaryShieldState,
  cancelReleaseUpdateFenceContent,
  initialPreArmBoundaryShieldState,
  initialReleaseUpdateFenceContentState,
  requestPreArmBoundaryShieldRelease,
  settlePreArmBoundaryShieldForReleaseFence,
  settleReleaseUpdateFenceContentReady,
} from './release-update-fence-content';

describe('content-side release update fence generation', () => {
  it('cannot reopen from a READY callback issued before a newer cancel', () => {
    let state = initialReleaseUpdateFenceContentState();
    const staleRequestEpoch = state.epoch;
    state = cancelReleaseUpdateFenceContent(state);

    const stale = settleReleaseUpdateFenceContentReady(
      state,
      staleRequestEpoch,
      { ok: true, blocked: false },
    );
    expect(stale.accepted).toBe(false);
    expect(stale.state).toEqual({ epoch: 1, active: true });

    const current = settleReleaseUpdateFenceContentReady(
      stale.state,
      stale.state.epoch,
      { ok: true, blocked: false },
    );
    expect(current).toEqual({ accepted: true, state: { epoch: 1, active: false } });
  });

  it('keeps malformed and failed READY acknowledgements closed', () => {
    const state = initialReleaseUpdateFenceContentState();
    expect(settleReleaseUpdateFenceContentReady(state, 0, undefined).state.active).toBe(true);
    expect(settleReleaseUpdateFenceContentReady(state, 0, { ok: true, blocked: true }).state.active)
      .toBe(true);
  });

  it('cannot release a newer pre-arm boundary from an older async response', () => {
    let state = initialPreArmBoundaryShieldState();
    const startupEpoch = state.epoch;
    state = activatePreArmBoundaryShieldState(state);

    state = requestPreArmBoundaryShieldRelease(state, startupEpoch, false);
    expect(state).toEqual({ epoch: 1, active: true, releaseRequestedEpoch: null });

    state = requestPreArmBoundaryShieldRelease(state, state.epoch, true);
    expect(state).toEqual({ epoch: 1, active: true, releaseRequestedEpoch: 1 });
    state = settlePreArmBoundaryShieldForReleaseFence(state, false);
    expect(state).toEqual({ epoch: 1, active: false, releaseRequestedEpoch: 1 });
  });

  it('invalidates a queued pre-arm release when a newer boundary activates', () => {
    let state = initialPreArmBoundaryShieldState();
    state = requestPreArmBoundaryShieldRelease(state, state.epoch, true);
    expect(state.releaseRequestedEpoch).toBe(0);

    state = activatePreArmBoundaryShieldState(state);
    state = settlePreArmBoundaryShieldForReleaseFence(state, false);

    expect(state).toEqual({ epoch: 1, active: true, releaseRequestedEpoch: null });
  });
});
