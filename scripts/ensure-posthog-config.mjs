// A Chrome Web Store package without the public ingestion token installs normally but silently
// drops every product event. Builds stay token-optional for contributors and CI; release zips do
// not, because a disconnected analytics package must never be uploaded by mistake.
import { existsSync, readFileSync } from 'node:fs';

const validProjectToken = (value) => {
  const trimmed = value?.trim() ?? '';
  const unquoted = /^(['"])(.*)\1$/.test(trimmed) ? trimmed.slice(1, -1).trim() : trimmed;
  return /^phc_[A-Za-z0-9_-]{20,}$/.test(unquoted);
};

let configured = validProjectToken(process.env.VITE_POSTHOG_PROJECT_TOKEN);
for (const file of ['.env', '.env.local', '.env.production', '.env.production.local']) {
  if (!existsSync(file)) continue;
  const match = readFileSync(file, 'utf8').match(/^\s*VITE_POSTHOG_PROJECT_TOKEN\s*=\s*([^#\r\n]*)/m);
  if (validProjectToken(match?.[1])) configured = true;
}

if (!configured) {
  console.error(
    'Refusing to package: VITE_POSTHOG_PROJECT_TOKEN is missing or malformed. ' +
      'Set the public phc_ PostHog project token in the shell or a local .env file before running npm run zip.',
  );
  process.exit(1);
}
