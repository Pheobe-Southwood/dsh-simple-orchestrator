/**
 * The bundle patch's one expression, evaluated the way the loader evaluates it.
 *
 * `dsh --dump-config` composes patch layers WITHOUT evaluating `!!js`, so it
 * cannot prove that the root path lands on the installed preset directory — this
 * file is that proof. It runs the same `with (ctx) { return eval(expr) }` the
 * loader uses, against both shapes `baseUrl` can take (the profile's
 * `cordis.yml` file URL, and the profile directory URL), and asserts the result
 * is the copy of `presets/` that `dsh plugin add` materializes.
 * @module test/roots-path
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isJsExpr, loadYaml } from './yaml.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

/** The loader's own evaluator: `!!js` runs with the entry's context in scope. */
const evaluate = new Function('ctx', 'expr', `
  with (ctx) {
    return eval(expr)
  }
`);

const patch = loadYaml(readFileSync(join(repoRoot, 'cordis.patch.yml'), 'utf8'));
const roots = patch[0]?.config?.roots;
assert.ok(Array.isArray(roots) && roots.length === 1, 'the patch adds exactly one root');
const pathNode = roots[0].path;
assert.ok(isJsExpr(pathNode), 'the root path is a !!js expression');

const profileDir = '/root/.dsh/profiles/web';
const expected = `${profileDir}/node_modules/${manifest.name}/presets/`;

// `profile-boot` anchors the Loader's baseUrl at the profile directory, whose
// real file on disk is the profile's `cordis.yml`; `Include` computes its own
// base with `new URL('.', …)`, which always keeps a trailing slash. Both must
// land on the same directory, because which one a patch layer sees is an
// implementation detail of the layer, not of this patch.
const baseUrlForms = {
  'profile cordis.yml file URL': `file://${profileDir}/cordis.yml`,
  'profile directory URL': `file://${profileDir}/`,
};
for (const [label, baseUrl] of Object.entries(baseUrlForms)) {
  assert.equal(evaluate({ baseUrl }, pathNode.__jsExpr), expected, `root path from the ${label}`);
}

// The tail is what keeps the expression honest about layout: the roster scans a
// directory holding one subdirectory per preset, and the bundle ships exactly
// that directory.
const relativeTail = expected.slice(`${profileDir}/`.length);
const [nodeModules, packageName, ...inPackage] = relativeTail.split('/');
assert.equal(nodeModules, 'node_modules');
assert.equal(packageName, manifest.name, 'the root path must name this package');
assert.deepEqual(inPackage, ['presets', ''], 'the root path must end at the presets directory');
assert.ok(
  existsSync(join(repoRoot, ...inPackage)),
  `${inPackage.join('/')} must exist in this package, or the installed copy has no preset to scan`,
);
assert.ok(
  existsSync(join(repoRoot, 'presets', 'dsh-simple-orchestrator', 'agent.cordis.yml')),
  'the root directory holds the preset, one directory per id',
);

console.log('ok: roots-path — the patch resolves to the installed presets/ directory');
