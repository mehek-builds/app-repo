function escapedPatternPath(path: string): RegExp {
  const escaped = path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/** Match the Chrome match-pattern subset used by the shipped content script manifest. */
export function chromeMatchPatternMatchesUrl(pattern: string, rawUrl: string): boolean {
  const match = /^(\*|https?|file|ftp):\/\/([^/]+)(\/.*)$/.exec(pattern);
  if (!match) return false;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  const patternScheme = match[1]!;
  const patternHost = match[2]!.toLowerCase();
  const scheme = url.protocol.slice(0, -1).toLowerCase();
  if (patternScheme === '*' ? !['http', 'https'].includes(scheme) : patternScheme !== scheme) {
    return false;
  }
  const host = url.hostname.toLowerCase();
  const hostMatches = patternHost === '*'
    || (patternHost.startsWith('*.')
      ? host === patternHost.slice(2) || host.endsWith(`.${patternHost.slice(2)}`)
      : host === patternHost);
  if (!hostMatches) return false;
  return escapedPatternPath(match[3]!).test(`${url.pathname}${url.search}`);
}

export function contentScriptPersistsAfterReload(
  rawUrl: string | undefined,
  manifestMatches: readonly string[],
): boolean | undefined {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return undefined;
  return manifestMatches.some((pattern) => chromeMatchPatternMatchesUrl(pattern, rawUrl));
}
