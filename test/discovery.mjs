/**
 * Integration health check against the HARNESS'S OWN preset discovery.
 *
 * Everything else in this suite reimplements a small piece of the roster; this
 * file lends the real one. `discoverPresets()` is what the running host calls to
 * build the picker, and it reports a preset whose composition is malformed or
 * whose rows name packages that are not installed as `broken` — the two ways an
 * authored preset actually rots, caught here without booting a host, without a
 * session, and without touching the real profile beyond reading it.
 *
 * It SKIPS (successfully) when the harness cannot be located, so the suite stays
 * runnable on a machine that has never installed dsh.
 * @module test/discovery
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { PRESET_ID } from '../presets/dsh-simple-orchestrator/mask.js';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** Locate the installed harness through a profile, or through $DSH_HARNESS_ANCHOR. */
function locateHarness() {
  const homes = [process.env.DSH_HOME, join(homedir(), '.dsh')].filter((home) => typeof home === 'string' && home.length > 0);
  const anchors = [
    ...(process.env.DSH_HARNESS_ANCHOR ? [process.env.DSH_HARNESS_ANCHOR] : []),
    ...homes.map((home) => join(home, 'profiles', 'web', 'package.json')),
  ];
  for (const anchor of anchors) {
    if (!existsSync(anchor)) continue;
    try {
      const entry = createRequire(anchor).resolve('@deepseek-ai/dsh-agent-presets');
      return { entry, anchorDir: dirname(anchor) };
    } catch {
      // Not installed above this anchor; keep looking.
    }
  }
  return undefined;
}

/**
 * The base URL a row's package name resolves against.
 *
 * The real roster passes the Loader's base, i.e. the profile directory; falling
 * back to the harness installation keeps the check meaningful when the profile
 * has no `node_modules` of its own (a first boot, or a throwaway home).
 */
function resolveHarnessBase(harness) {
  const fromProfile = harness.anchorDir;
  if (existsSync(join(fromProfile, 'node_modules', '@deepseek-ai', 'dsh-tool-fs', 'package.json'))) return fromProfile;
  const packageDir = dirname(dirname(harness.entry));
  const installBase = dirname(dirname(packageDir));
  if (existsSync(join(installBase, '@deepseek-ai', 'dsh-tool-fs', 'package.json'))) return installBase;
  return undefined;
}

const harness = locateHarness();
if (harness === undefined) {
  console.log('skip: discovery — no installed harness found (set DSH_HARNESS_ANCHOR to a profile package.json to run it)');
} else {
  const base = resolveHarnessBase(harness);
  if (base === undefined) {
    console.log('skip: discovery — the harness install has no @deepseek-ai packages beside it to resolve rows against');
  } else {
    const { discoverPresets } = await import(pathToFileURL(harness.entry).href);
    const presets = await discoverPresets(
      [{ path: join(repoRoot, 'presets'), trust: 'system' }],
      pathToFileURL(base).href,
    );
    assert.equal(presets.length, 1, 'the root holds exactly one preset');
    const [preset] = presets;
    assert.equal(preset.id, PRESET_ID);
    assert.equal(preset.trust, 'system');
    assert.equal(preset.path, join(repoRoot, 'presets', PRESET_ID, 'agent.cordis.yml'));
    assert.equal(
      preset.broken,
      undefined,
      `the harness reports this preset broken: ${preset.broken ?? ''}`,
    );
    assert.equal(preset.name, '编排模式');
    assert.ok(preset.description.length > 0);
    console.log(`ok: discovery — ${harness.entry} resolves every composition row of "${preset.id}"`);
  }
}
