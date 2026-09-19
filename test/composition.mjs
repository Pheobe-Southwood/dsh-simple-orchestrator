/**
 * Static checks on the preset itself — the composition, its display metadata,
 * and the mask's own contract — with no harness and no host involved.
 *
 * The central assertion is the tool-parity contract: the set of tool names the
 * mounted rows can contribute must equal KEEP ∪ DENY exactly. Adding a tool row
 * without deciding whether the orchestrator may see it fails here, which is the
 * only thing standing between "the orchestrator owns no code tools" and a
 * future row quietly handing it one.
 * @module test/composition
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DENY, PRESET_ID, name as maskName } from '../presets/dsh-simple-orchestrator/mask.js';
import { isJsExpr, loadYaml } from './yaml.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const presetDir = join(repoRoot, 'presets', PRESET_ID);
const compositionPath = join(presetDir, 'agent.cordis.yml');

/**
 * Tools the orchestrator KEEPS visible. Everything here is either one of the
 * four capabilities the preset is for (skills, the user, the web, delegation) or
 * a control-plane tool the user asked to keep (progress, plan approval, goals,
 * deliverables, background-job handling).
 */
const KEEP = [
  'ask_user_question',
  'create_goal',
  'exit_plan_mode',
  'get_goal',
  'interrupt_agent',
  'job_kill',
  'job_list',
  'job_output',
  'list_agents',
  'list_subagent_models',
  'present',
  'ralph',
  'send_message',
  'skill',
  'subagent',
  'subagent_fork',
  'todo_write',
  'update_goal',
  'web_fetch',
  'web_search',
  'workflow',
];

/** Tool names each mounted package can register, keyed by the row's `name`. */
const TOOLS_BY_PACKAGE = {
  '@deepseek-ai/dsh-tool-ask-user': ['ask_user_question'],
  '@deepseek-ai/dsh-tool-bash': ['bash'],
  '@deepseek-ai/dsh-tool-fs': ['read', 'write', 'edit', 'read_image'],
  '@deepseek-ai/dsh-tool-fs-search': ['glob', 'grep'],
  '@deepseek-ai/dsh-tool-goal': ['get_goal', 'create_goal', 'update_goal'],
  '@deepseek-ai/dsh-tool-jobs': ['job_output', 'job_list', 'job_kill'],
  '@deepseek-ai/dsh-tool-present': ['present'],
  '@deepseek-ai/dsh-tool-pwsh': ['pwsh'],
  '@deepseek-ai/dsh-tool-ralph': ['ralph'],
  '@deepseek-ai/dsh-tool-skill': ['skill'],
  '@deepseek-ai/dsh-tool-subagent-control': ['send_message', 'interrupt_agent'],
  '@deepseek-ai/dsh-tool-subagent-control/list-agents': ['list_agents'],
  '@deepseek-ai/dsh-tool-todo': ['todo_write'],
  '@deepseek-ai/dsh-tool-web': ['web_search', 'web_fetch'],
  '@deepseek-ai/dsh-tool-workflow': ['workflow'],
  '@deepseek-ai/dsh-plan-mode': ['exit_plan_mode'],
};

/** Rows the design depends on, by id — dropping one silently changes a capability. */
const REQUIRED_ROWS = [
  'persona',
  'agent-instructions',
  'tool-bash',
  'tool-pwsh',
  'tool-fs',
  'tool-fs-search',
  'tool-jobs',
  'skill-filesystem',
  'tool-skill',
  'command-goal',
  'tool-goal',
  'planning',
  'plan-mode',
  'compaction',
  'compaction-basic',
  'command-compact',
  'tool-result-pruner',
  'delegation',
  'tool-subagent-control',
  'tool-subagent-list-agents',
  'tool-subagent',
  'tool-subagent-fork',
  'tool-subagent-codex',
  'tool-subagent-claude-code',
  'workflow-worker-thread',
  'tool-workflow',
  'tool-ralph',
  'orchestrator-mask',
  'tool-ask-user',
  'tool-todo',
  'tool-web',
  'present',
];

/** Every row in a composition, groups included, flattened in file order. */
function flattenRows(rows, at = '') {
  const flat = [];
  for (const row of rows) {
    flat.push({ row, at: `${at}${row.id ?? '(no id)'}` });
    if (Array.isArray(row.config)) flat.push(...flattenRows(row.config, `${at}${row.id ?? '(no id)'} / `));
  }
  return flat;
}

const compositionText = readFileSync(compositionPath, 'utf8');
const rows = loadYaml(compositionText);
const flat = flattenRows(rows);

// ── shape ───────────────────────────────────────────────────────────────────

assert.ok(Array.isArray(rows), 'agent.cordis.yml must be a top-level entry list');
for (const { row, at } of flat) {
  assert.equal(typeof row.id, 'string', `row ${at} needs a string id`);
  assert.equal(typeof row.name, 'string', `row ${at} needs a string name`);
  assert.ok(
    row.name.startsWith('@deepseek-ai/') || row.name === './mask.js' || row.name.startsWith('cordis:'),
    `row ${at} names "${row.name}"; a preset row is a shipped harness package, a cordis builtin, or a file this preset ships`,
  );
}

const ids = flat.map(({ row }) => row.id);
for (const required of REQUIRED_ROWS) assert.ok(ids.includes(required), `composition is missing row "${required}"`);

const byId = new Map(flat.map(({ row }) => [row.id, row]));

// ── the mask row ────────────────────────────────────────────────────────────

const maskRow = byId.get('orchestrator-mask');
assert.equal(maskRow.name, './mask.js', 'the mask row must name the file this preset ships');
assert.equal(maskRow.config, undefined, 'the mask row keeps its contract in mask.js; a config key would be silently ignored');
assert.notEqual(maskRow.disabled, true, 'the mask row must be enabled');
assert.equal(maskName, 'orchestrator-mask', 'mask.js advertises the plugin name the row is recognized by');
assert.equal(PRESET_ID, basename(presetDir), 'mask.js PRESET_ID must equal the preset directory name (the roster id)');
assert.ok(!KEEP.some((tool) => DENY.includes(tool)), 'KEEP and DENY must not overlap');
assert.deepEqual(
  ['read', 'write', 'edit', 'read_image', 'glob', 'grep', 'bash', 'pwsh'].filter((tool) => !DENY.includes(tool)),
  [],
  'the mask must deny every file and shell tool',
);

// ── the tool-parity contract ────────────────────────────────────────────────

/** Tool names one row can contribute, or [] for rows that register no tool. */
function toolsOf(row) {
  if (row.name === '@deepseek-ai/dsh-tool-subagent') {
    const toolName = row.config?.toolName;
    assert.equal(typeof toolName, 'string', `subagent row ${row.id} needs a toolName`);
    return row.config.modelSelectionSettings === true ? [toolName, 'list_subagent_models'] : [toolName];
  }
  return TOOLS_BY_PACKAGE[row.name] ?? [];
}

/**
 * A row the Loader starts. It starts a row unless `Boolean(disabled)` is true,
 * and a `!!js` expression is an object — so a platform gate counts as possibly
 * mounted and must be accounted for (both shell rows are in DENY for exactly
 * that reason). A literal `disabled: true` row (an optional product provider
 * kept as a template) contributes nothing until someone enables it.
 */
const mounted = flat.filter(({ row }) => row.disabled !== true);
const mountedTools = new Set();
for (const { row } of mounted) for (const tool of toolsOf(row)) mountedTools.add(tool);

const expected = new Set([...KEEP, ...DENY]);
for (const tool of mountedTools) {
  assert.ok(
    expected.has(tool),
    `tool "${tool}" is mounted but is in neither KEEP nor DENY: decide whether the orchestrator may see it, then update test/composition.mjs and mask.js`,
  );
}
for (const tool of expected) {
  assert.ok(mountedTools.has(tool), `"${tool}" is claimed but no mounted row registers it — the lists have drifted`);
}

// ── the persona keeps the deployment context ────────────────────────────────

const persona = byId.get('persona');
assert.equal(persona.config?.complete, undefined, 'the orchestrator needs the deployment prompt sections: never set `complete: true`');
assert.equal(
  persona.config?.includeRuntimeContext,
  undefined,
  'the runtime context (workspace, skills, delegation guidance) must stay on for this preset',
);
assert.match(String(persona.config?.prefix), /no file tools and no shell/i, 'the persona must state the orchestrator has no code tools');
assert.match(String(persona.config?.suffix), /\{\{cwd\}\}/, 'the persona keeps the working-directory suffix');

// ── display metadata ────────────────────────────────────────────────────────

const metadata = loadYaml(readFileSync(join(presetDir, 'preset.yml'), 'utf8'));
assert.equal(metadata.name, '编排模式');
assert.equal(typeof metadata.description, 'string');
assert.ok(metadata.description.length > 0, 'the preset must describe itself for the picker');
assert.equal(metadata.order, undefined, 'an authored preset declares no roster order; it sorts after the shipped set');

// ── the bundle patch ────────────────────────────────────────────────────────

const patch = loadYaml(readFileSync(join(repoRoot, 'cordis.patch.yml'), 'utf8'));
assert.equal(patch.length, 1, 'the bundle patch is one layer with one target row');
assert.equal(patch[0].id, 'agent-presets', 'the patch must target the roster row');
assert.deepEqual(
  Object.keys(patch[0].config).sort(),
  ['default', 'includeShippedRoot', 'includeUserRoot', 'roots'],
  'a patch replaces the row config, so every key the deployment sets must be restated',
);
assert.equal(patch[0].config.default, 'standard', 'this preset must not become the default for new sessions');
assert.ok(isJsExpr(patch[0].config.roots?.[0]?.path), 'the root path must be derived from baseUrl at load time');
assert.equal(patch[0].config.roots[0].trust, 'system');

console.log('ok: composition — rows, mask contract, tool parity, patch');
