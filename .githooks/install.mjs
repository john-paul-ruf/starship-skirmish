// .githooks/install.mjs — repository-local Git-hook activator.
//
// npm invokes this from the `prepare` lifecycle script. Inside a Git worktree
// it configures `core.hooksPath` for this clone so the tracked `./.githooks/`
// hook (`pre-push`) runs on every ordinary push.
//
// Outside a Git worktree (packaged install, tarball, sandbox with no `.git/`)
// it exits zero after a concise skip message: packaged consumers should not
// fail merely because the source `.git/` directory is absent.
//
// Node built-ins only — no runtime dependency is added by this file. Any
// in-repository config write that Git rejects surfaces as a nonzero exit; we
// never mask a real failure with `|| true`.
//
// This is repository-local: the write goes to `./.git/config`, never global.

/* global console, process */
import { spawnSync } from 'node:child_process';

const HOOKS_PATH = './.githooks';

const runGit = (args) => spawnSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });

const inWorktree = () => {
  const probe = runGit(['rev-parse', '--is-inside-work-tree']);
  return probe.status === 0 && probe.stdout.trim() === 'true';
};

const main = () => {
  if (!inWorktree()) {
    console.log('[githooks/install] Not inside a Git worktree; skipping hook activation.');
    return 0;
  }

  const write = runGit(['config', '--local', 'core.hooksPath', HOOKS_PATH]);
  if (write.status !== 0) {
    const stderr = (write.stderr || '').trim();
    console.error(
      `[githooks/install] Failed to set core.hooksPath=${HOOKS_PATH}: ${stderr || 'unknown error'}`,
    );
    return write.status === null ? 1 : write.status;
  }

  console.log(`[githooks/install] core.hooksPath=${HOOKS_PATH} (repository-local).`);
  return 0;
};

process.exit(main());
