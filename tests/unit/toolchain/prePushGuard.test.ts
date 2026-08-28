// tests/unit/toolchain/prePushGuard.test.ts — SESSION-01 M01/M19.
//
// Locks the pre-push Pages-readiness contract:
//   1. The tracked hook exists, is executable, is a POSIX shell script with
//      fail-fast mode, resolves the repository root, and delegates exactly
//      once to `npm run verify:pages`.
//   2. When we prepend a fake `npm` binary to `PATH`, invoking the hook:
//        a. exits zero if the fake `npm` exits zero;
//        b. propagates a distinctive nonzero fake exit unchanged (so a real
//           gate failure cancels a real push);
//        c. is called with the exact argv `run verify:pages`.
//   3. The `prepare` installer, executed inside an isolated temporary Git
//      repository, configures repository-local `core.hooksPath=./.githooks`
//      for that repository only. We never touch the running user's global
//      Git configuration.
//   4. `package.json` and `.github/workflows/ci.yml` describe the SAME
//      Pages-readiness surface: the workflow calls the two canonical halves
//      instead of duplicating the gate list, the Node half orders every
//      architecture gate correctly and ends with the build step, the browser
//      half names all three cross-engine determinism specs, and the aggregate
//      script orders Node before browsers.
//
// No YAML parser, shell-test framework, hook manager (Husky), or snapshot
// dependency — Node built-ins + Vitest only.

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Paths resolved from THIS file's location — never from a shell cwd.
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const HOOK_PATH = path.join(REPO_ROOT, '.githooks', 'pre-push');
const INSTALLER_PATH = path.join(REPO_ROOT, '.githooks', 'install.mjs');
const PACKAGE_JSON_PATH = path.join(REPO_ROOT, 'package.json');
const CI_WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml');

// ---------------------------------------------------------------------------
// Contract 1 — tracked hook shape.
// ---------------------------------------------------------------------------

describe('pre-push hook — tracked shape', () => {
  const hookSource = fs.readFileSync(HOOK_PATH, 'utf8');

  it('is a regular executable file', () => {
    const st = fs.statSync(HOOK_PATH);
    expect(st.isFile()).toBe(true);
    // On POSIX, the owner-execute bit is 0o100. Skip on Win32 file systems
    // that report modes without an execute bit.
    if (os.platform() !== 'win32') {
      expect(st.mode & 0o111).not.toBe(0);
    }
  });

  it('opens with a POSIX shell shebang', () => {
    expect(hookSource.startsWith('#!/bin/sh\n')).toBe(true);
  });

  it('enables fail-fast mode', () => {
    // `set -eu` — exit on unset variables and any command failure.
    expect(/^set -eu\b/m.test(hookSource)).toBe(true);
  });

  it('resolves the repository root before invoking gates', () => {
    expect(hookSource).toMatch(/git rev-parse --show-toplevel/);
    expect(hookSource).toMatch(/cd "\$repo_root"/);
  });

  it('delegates exactly once to `npm run verify:pages`', () => {
    const matches = hookSource.match(/\bnpm run verify:pages\b/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('exec-replaces the shell with the aggregate gate for exact status propagation', () => {
    expect(hookSource).toMatch(/\bexec npm run verify:pages\b/);
  });
});

// ---------------------------------------------------------------------------
// Contract 2 — delegation + exact status propagation with a fake `npm`.
// ---------------------------------------------------------------------------

interface FakeRun {
  readonly exitCode: number;
  readonly capturedArgs: readonly string[];
}

const runHookWithFakeNpm = (fakeExitCode: number): FakeRun => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-prepush-'));
  try {
    // A fake `npm` that records its argv to a sibling file and exits with the
    // requested code. Portable across POSIX shells; no framework needed.
    const argsFile = path.join(scratch, 'args.txt');
    const fakeNpm = path.join(scratch, 'npm');
    fs.writeFileSync(
      fakeNpm,
      `#!/bin/sh\nprintf '%s\\n' "$@" > "${argsFile}"\nexit ${fakeExitCode}\n`,
    );
    fs.chmodSync(fakeNpm, 0o755);

    // Run the real hook from the real repository root. Prepend our fake
    // directory to PATH so the hook's `npm` resolves to the fake before any
    // real installation.
    const result = spawnSync(HOOK_PATH, [], {
      cwd: REPO_ROOT,
      env: { ...process.env, PATH: `${scratch}:${process.env['PATH'] ?? ''}` },
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });

    if (result.status === null) {
      throw new Error(
        `hook did not return an exit status; signal=${result.signal ?? 'null'}`,
      );
    }

    const capturedArgs = fs.existsSync(argsFile)
      ? fs.readFileSync(argsFile, 'utf8').split('\n').filter((line) => line.length > 0)
      : [];

    return { exitCode: result.status, capturedArgs };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
};

describe('pre-push hook — delegation & status propagation', () => {
  it('exits zero when the delegated `npm run verify:pages` exits zero', () => {
    const run = runHookWithFakeNpm(0);
    expect(run.exitCode).toBe(0);
    expect(run.capturedArgs).toEqual(['run', 'verify:pages']);
  });

  it('propagates a distinctive nonzero exit code unchanged', () => {
    // 42 is distinct from every conventional signal-derived code we might
    // race against and from the default `1`, so a passing assertion is proof
    // of exact propagation rather than an accidental match.
    const run = runHookWithFakeNpm(42);
    expect(run.exitCode).toBe(42);
    expect(run.capturedArgs).toEqual(['run', 'verify:pages']);
  });
});

// ---------------------------------------------------------------------------
// Contract 3 — installer configures repository-local `core.hooksPath` inside
// an isolated temporary Git repository. We never mutate the ambient repo's
// config as a side effect of running the test.
// ---------------------------------------------------------------------------

const gitConfigValue = (repoDir: string, key: string): string | null => {
  const res = spawnSync('git', ['config', '--local', '--get', key], {
    cwd: repoDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  return res.status === 0 ? res.stdout.trim() : null;
};

describe('.githooks/install.mjs — isolated activation', () => {
  it('sets core.hooksPath=./.githooks in the target Git repository only', () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-hooksinstall-'));
    try {
      const init = spawnSync('git', ['init', '--quiet', scratch], {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
      });
      expect(init.status).toBe(0);

      // Sanity: no hooksPath yet in the scratch repo.
      expect(gitConfigValue(scratch, 'core.hooksPath')).toBe(null);

      const run = spawnSync(process.execPath, [INSTALLER_PATH], {
        cwd: scratch,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
      });

      expect(run.status).toBe(0);
      expect(gitConfigValue(scratch, 'core.hooksPath')).toBe('./.githooks');
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('is a no-op outside a Git worktree', () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-hooksinstall-bare-'));
    try {
      const run = spawnSync(process.execPath, [INSTALLER_PATH], {
        cwd: scratch,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
      });
      // Packaged installs must not fail merely because `.git/` is absent.
      expect(run.status).toBe(0);
      // And they must not create a `.git` side effect.
      expect(fs.existsSync(path.join(scratch, '.git'))).toBe(false);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Contract 4 — package/workflow parity: one source of truth for the
// Pages-readiness gate.
// ---------------------------------------------------------------------------

interface PackageJson {
  readonly scripts: Readonly<Record<string, string>>;
}

const parsedPackage = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8')) as PackageJson;
const workflowText = fs.readFileSync(CI_WORKFLOW_PATH, 'utf8');

describe('package.json — canonical Pages-readiness scripts', () => {
  it('declares prepare, verify:pages:node, verify:pages:browsers, and verify:pages', () => {
    const s = parsedPackage.scripts;
    expect(s['prepare']).toBe('node ./.githooks/install.mjs');
    expect(typeof s['verify:pages:node']).toBe('string');
    expect(typeof s['verify:pages:browsers']).toBe('string');
    expect(typeof s['verify:pages']).toBe('string');
  });

  it('aggregate orders Node before browsers', () => {
    expect(parsedPackage.scripts['verify:pages']).toBe(
      'npm run verify:pages:node && npm run verify:pages:browsers',
    );
  });

  it('Node half runs every architecture gate in order and ends with build', () => {
    const nodeHalf = parsedPackage.scripts['verify:pages:node'] ?? '';
    const expectedOrder = [
      'npm run typecheck',
      'npm run lint',
      'npm run test:unit',
      'npm run test:catalog-lock',
      'npm run test:determinism',
      'npm run test:fixtures',
      'npm run test:harness-purity',
      'npm run build',
    ];
    let cursor = 0;
    for (const token of expectedOrder) {
      const found = nodeHalf.indexOf(token, cursor);
      expect(found, `Node half missing "${token}" after position ${cursor}`).toBeGreaterThan(-1);
      cursor = found + token.length;
    }
    // Build must be the terminal step — architecture §11 orders "build" last.
    expect(nodeHalf.trimEnd().endsWith('npm run build')).toBe(true);
  });

  it('browser half names all three cross-engine determinism specs', () => {
    const browserHalf = parsedPackage.scripts['verify:pages:browsers'] ?? '';
    expect(browserHalf.startsWith('playwright test')).toBe(true);
    expect(browserHalf).toContain('./tests/e2e/determinism.spec.ts');
    expect(browserHalf).toContain('./tests/e2e/combatDeterminism.spec.ts');
    expect(browserHalf).toContain('./tests/e2e/harnessMatchDeterminism.spec.ts');
  });
});

describe('CI workflow — consumes canonical halves, no divergent command list', () => {
  it('invokes verify:pages:node and verify:pages:browsers via npm run', () => {
    expect(workflowText).toContain('npm run verify:pages:node');
    expect(workflowText).toContain('npm run verify:pages:browsers');
  });

  it('does not re-list the gates as raw `npm run` steps outside the canonical halves', () => {
    // If a future edit reintroduces the pre-canonicalization gate list, this
    // lock catches it before the workflow can silently drift from the hook.
    const rawGates = [
      'npm run typecheck',
      'npm run lint',
      'npm run test:unit',
      'npm run test:catalog-lock',
      'npm run test:determinism',
      'npm run test:fixtures',
      'npm run test:harness-purity',
    ];
    for (const gate of rawGates) {
      expect(workflowText, `workflow reintroduced raw "${gate}"`).not.toContain(gate);
    }
  });

  it('retains push + pull_request triggers on main and Node 22 setup', () => {
    expect(workflowText).toMatch(/on:\s*[\s\S]*push:\s*[\s\S]*branches:\s*\[main\]/);
    expect(workflowText).toMatch(/pull_request:\s*[\s\S]*branches:\s*\[main\]/);
    expect(workflowText).toMatch(/node-version:\s*22/);
    // Cross-engine job depends on the build job so Node feedback lands first.
    expect(workflowText).toMatch(/needs:\s*build/);
    // Browser binaries are still installed with dependencies before the gate.
    expect(workflowText).toContain('npx playwright install --with-deps');
  });
});
