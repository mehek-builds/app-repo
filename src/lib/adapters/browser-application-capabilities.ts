export type BrowserApplicationFamily = 'zoho_recruit' | 'bullhorn' | 'sap_successfactors' | 'oracle_taleo' | 'adp_recruiting' | 'jazzhr';

export type BrowserApplicationCapability = {
  family: BrowserApplicationFamily;
  researchedHosts: readonly string[];
  fill: boolean;
  uploadResume: boolean;
  createAccount: boolean;
  programmaticSubmit: boolean;
  trustedDirectClick: boolean;
  pollPublicListings: boolean;
};

const DEFAULT_DENY: Omit<BrowserApplicationCapability, 'family' | 'researchedHosts'> = {
  fill: false,
  uploadResume: false,
  createAccount: false,
  programmaticSubmit: false,
  trustedDirectClick: true,
  pollPublicListings: false,
};

export const BROWSER_APPLICATION_CAPABILITIES: Readonly<Record<BrowserApplicationFamily, BrowserApplicationCapability>> = {
  zoho_recruit: {
    ...DEFAULT_DENY,
    family: 'zoho_recruit',
    researchedHosts: ['genovice.zohorecruit.com', 'solution25.zohorecruit.eu'],
    fill: true,
    uploadResume: true,
  },
  bullhorn: {
    ...DEFAULT_DENY,
    family: 'bullhorn',
    researchedHosts: ['www.serverlogic.com', 'www.staffingsolutionsenterprises.com'],
    fill: true,
    uploadResume: true,
  },
  sap_successfactors: {
    ...DEFAULT_DENY,
    family: 'sap_successfactors',
    researchedHosts: ['career2.successfactors.eu', 'career8.successfactors.com'],
  },
  oracle_taleo: {
    ...DEFAULT_DENY,
    family: 'oracle_taleo',
    researchedHosts: ['fa007.taleo.net', 'aa270.taleo.net'],
  },
  adp_recruiting: {
    ...DEFAULT_DENY,
    family: 'adp_recruiting',
    researchedHosts: ['myjobs.adp.com'],
  },
  jazzhr: {
    ...DEFAULT_DENY,
    family: 'jazzhr',
    researchedHosts: ['utilidata.applytojob.com', 'foundationai.applytojob.com'],
    fill: true,
    uploadResume: true,
  },
};

/** Unknown values never inherit permission from a neighboring adapter. */
export function browserApplicationCapability(family: string): BrowserApplicationCapability | null {
  return BROWSER_APPLICATION_CAPABILITIES[family as BrowserApplicationFamily] ?? null;
}

export function isResearchedBrowserTenant(family: BrowserApplicationFamily, hostname: string): boolean {
  return BROWSER_APPLICATION_CAPABILITIES[family].researchedHosts.includes(hostname.toLowerCase());
}
