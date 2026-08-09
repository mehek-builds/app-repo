import { configDefaults, defineConfig } from 'vitest/config';

// This file exists for ONE reason: to keep `npm test` from running a different checkout's tests.
//
// Agent worktrees land in `.claude/worktrees/<name>/`, INSIDE the repo. They are kept out of
// `git status` by `.git/info/exclude`, but a git exclude means nothing to a file glob, so vitest
// happily walked into them and ran that checkout's copy of the suite alongside this one. Measured
// on 2026-08-09 in the main checkout: 115 test files / 1632 tests instead of its own 69 / 1025,
// with 20 failures that belonged to a stale worktree pinned at an older commit. The failures were
// real for THAT tree and meaningless here, which is the worst kind of red - it trains you to read
// a failing suite as noise.
//
// Spread configDefaults.exclude rather than listing patterns by hand: `exclude` REPLACES the
// defaults instead of extending them, so a bare ['**/.claude/**'] would silently re-admit
// node_modules and dist. This file cannot exclude itself into oblivion either - `**/vitest.config.*`
// is already one of those defaults.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/.claude/**'],
  },
});
