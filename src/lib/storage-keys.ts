// Shared constants only. Keeping this module side-effect free prevents the general storage layer
// from importing analytics configuration into popup and content-script bundles.
export const ANALYTICS_ID_KEY = 'litos_posthog_distinct_id';
export const ANALYTICS_QUEUE_KEY = 'litos_posthog_event_queue';
export const CAPTCHA_STALLS_KEY = 'captcha_stalls';
