export type FillAccess = {
  can_tailor?: boolean;
  can_draft_answers?: boolean;
  hover_generation?: boolean;
  automatic_submission?: boolean;
};

export type NamedFillAction = 'free' | 'tailor';

export type FillActionPresentation = {
  primaryAction: NamedFillAction;
  primaryLabel: 'Fill application' | 'Tailor resume';
  secondaryAction: 'plans' | 'fill_free';
  secondaryLabel: 'See Litos+' | 'Fill without tailoring';
};

export type FillActionRoute = {
  action: NamedFillAction;
  showUpgrade: boolean;
  access: FillAccess;
};

function presentationFor(access: FillAccess): FillActionPresentation {
  if (access.can_tailor === true) {
    return {
      primaryAction: 'tailor',
      primaryLabel: 'Tailor resume',
      secondaryAction: 'fill_free',
      secondaryLabel: 'Fill without tailoring',
    };
  }
  return {
    primaryAction: 'free',
    primaryLabel: 'Fill application',
    secondaryAction: 'plans',
    secondaryLabel: 'See Litos+',
  };
}

/**
 * Owns the asynchronous plan check behind the application card's named actions.
 * A click that arrives before the initial check settles waits for that check, then
 * re-checks access before routing so an unresolved UI can never silently mean Free.
 */
export function createFillActionGate(loadAccess: () => Promise<FillAccess>) {
  let resolvedPresentation: FillActionPresentation | null = null;
  const readyPromise = loadAccess().then((access) => {
    resolvedPresentation = presentationFor(access);
    return resolvedPresentation;
  });

  return {
    ready: () => readyPromise,
    async resolvePrimary(forceFree = false): Promise<FillActionRoute> {
      const presentation = await readyPromise;
      const access = await loadAccess();
      if (forceFree || presentation.primaryAction === 'free') {
        return { action: 'free', showUpgrade: false, access };
      }
      if (access.can_tailor === true) {
        return { action: 'tailor', showUpgrade: false, access };
      }
      return { action: 'free', showUpgrade: true, access };
    },
    presentation: () => resolvedPresentation,
  };
}
