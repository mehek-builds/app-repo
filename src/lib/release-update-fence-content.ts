export type ReleaseUpdateFenceContentState = Readonly<{
  epoch: number;
  active: boolean;
}>;

export type PreArmBoundaryShieldState = Readonly<{
  epoch: number;
  active: boolean;
  releaseRequestedEpoch: number | null;
}>;

export function initialReleaseUpdateFenceContentState(): ReleaseUpdateFenceContentState {
  return { epoch: 0, active: true };
}

export function cancelReleaseUpdateFenceContent(
  state: ReleaseUpdateFenceContentState,
): ReleaseUpdateFenceContentState {
  return { epoch: state.epoch + 1, active: true };
}

export function initialPreArmBoundaryShieldState(): PreArmBoundaryShieldState {
  return { epoch: 0, active: true, releaseRequestedEpoch: null };
}

export function activatePreArmBoundaryShieldState(
  state: PreArmBoundaryShieldState,
): PreArmBoundaryShieldState {
  return {
    epoch: state.epoch + 1,
    active: true,
    releaseRequestedEpoch: null,
  };
}

export function requestPreArmBoundaryShieldRelease(
  state: PreArmBoundaryShieldState,
  requestEpoch: number,
  releaseFenceActive: boolean,
): PreArmBoundaryShieldState {
  if (requestEpoch !== state.epoch) return state;
  return {
    ...state,
    active: releaseFenceActive,
    releaseRequestedEpoch: requestEpoch,
  };
}

export function settlePreArmBoundaryShieldForReleaseFence(
  state: PreArmBoundaryShieldState,
  releaseFenceActive: boolean,
): PreArmBoundaryShieldState {
  if (releaseFenceActive) return { ...state, active: true };
  if (state.releaseRequestedEpoch !== state.epoch) return state;
  return { ...state, active: false };
}

export function settleReleaseUpdateFenceContentReady(
  state: ReleaseUpdateFenceContentState,
  requestEpoch: number,
  response: { ok?: boolean; blocked?: boolean } | undefined,
): { accepted: boolean; state: ReleaseUpdateFenceContentState } {
  if (requestEpoch !== state.epoch) return { accepted: false, state };
  return {
    accepted: true,
    state: {
      epoch: state.epoch,
      active: !(response?.ok === true && response.blocked === false),
    },
  };
}
