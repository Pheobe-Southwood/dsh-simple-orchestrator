/**
 * Unit tests for the preset's mask row, against a fake registry.
 *
 * `mask.js` reaches the harness only through `ctx.get()` and `ctx.on()`, so a
 * hand-built context exercises every branch of it — including the ones a real
 * host cannot be made to produce on demand: a platform-absent tool name, a
 * registry that rejects every name, and the `tools/change` re-entry that a
 * preset switch (and `restrict()` itself) triggers.
 *
 * One thing this fake CANNOT reproduce is cross-context event dispatch, which
 * is exactly how the worst bug of this row shipped: `agent/created` is a
 * host-wide announcement, and the fake delivers it only to listeners registered
 * on the fake ctx. The roster gate is therefore asserted here explicitly — the
 * `standard-session` cases below are the contract, not a formality.
 * @module test/mask
 */
import assert from 'node:assert/strict';

import { DENY, PRESET_ID, apply } from '../presets/dsh-simple-orchestrator/mask.js';

/**
 * Build a fake host for one test.
 *
 * The fake `restrict()` mirrors the real one's two load-bearing behaviors:
 * naming an unknown tool throws BEFORE recording anything, and a successful
 * restriction emits `tools/change` — the event that would drive the mask into a
 * loop if it marked an agent after restricting it rather than before.
 * @param options - `presetOf` answers `composedPreset`, `rejectNames` are names
 *   the fake registry refuses, and `roster`/`registry` remove those services.
 */
function createHarness(options = {}) {
  const {
    presetOf = () => PRESET_ID,
    rejectNames = [],
    roster = true,
    registry = true,
  } = options;
  const listeners = new Map();
  const states = new WeakMap();
  const agents = [];
  const warnings = [];

  const emit = (event, payload) => {
    for (const listener of listeners.get(event) ?? []) listener(payload);
  };

  const ctx = {
    logger: { warn: (message) => warnings.push(message) },
    on(event, listener) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
    },
    get(service) {
      if (service === 'agents') return registry ? { list: () => [...agents] } : undefined;
      if (service === 'agentPresets') return roster ? { composedPreset: (agentCtx) => presetOf(agentCtx) } : undefined;
      return undefined;
    },
  };

  const addAgent = ({ origin, id } = {}) => {
    const state = { names: new Set(), calls: 0 };
    const agent = {
      id: id ?? `agent-${agents.length + 1}`,
      session: { header: origin === undefined ? {} : { origin } },
      ctx: {
        inject(_deps, callback) {
          callback({
            tools: {
              restrict(filter) {
                state.calls += 1;
                for (const toolName of filter.deny ?? []) {
                  if (rejectNames.includes(toolName)) throw new Error(`tools.restrict() names unknown global tool "${toolName}"`);
                  state.names.add(toolName);
                }
                emit('tools/change', {});
                return () => {};
              },
            },
          });
        },
      },
    };
    states.set(agent, state);
    agents.push(agent);
    return agent;
  };

  return {
    ctx,
    emit,
    warnings,
    addAgent,
    stateOf: (agent) => states.get(agent),
    install: () => apply(ctx),
  };
}

/**
 * Assert one agent got the whole deny list (or none of it).
 * @param harness - the fake host.
 * @param agent - the agent under test.
 * @param names - expected denied tool names; [] means untouched.
 */
function assertDenied(harness, agent, names) {
  const state = harness.stateOf(agent);
  assert.deepEqual([...state.names].sort(), [...names].sort());
}

// ── the primary path: agent/created ─────────────────────────────────────────

{
  const harness = createHarness();
  harness.install();
  const agent = harness.addAgent();
  harness.emit('agent/created', { agent });
  assertDenied(harness, agent, DENY);
  assert.equal(harness.stateOf(agent).calls, DENY.length, 'one restrict() call per name, so one absent name cannot void the mask');
  assert.deepEqual(harness.warnings, []);
}

{
  const harness = createHarness();
  harness.install();
  const child = harness.addAgent({ origin: 'subagent' });
  harness.emit('agent/created', { agent: child });
  assertDenied(harness, child, []);
  assert.equal(harness.stateOf(child).calls, 0, 'a worker keeps the full coding toolset');
}

{
  // THE REGRESSION THIS FILE EXISTS FOR: `agent/created` is a host-wide
  // announcement and reaches this row for every agent in the process. A session
  // of any OTHER preset (standard, creative, a copied one) is a top-level agent
  // with no subagent origin — the roster answer is the only thing between it and
  // being masked down to the orchestrator's toolset.
  const harness = createHarness({ presetOf: () => 'standard' });
  harness.install();
  const agent = harness.addAgent({ id: 'standard-session' });
  harness.emit('agent/created', { agent });
  assertDenied(harness, agent, []);
  assert.equal(harness.stateOf(agent).calls, 0, 'a session of another preset must not be masked');
  assert.deepEqual(harness.warnings, []);

  const creative = harness.addAgent({ id: 'creative-session' });
  harness.emit('agent/created', { agent: creative });
  assert.equal(harness.stateOf(creative).calls, 0, 'nor a creative-mode one');
}

{
  // An agent announced BEFORE its composition (composedPreset still blank):
  // the creation path must fail open, and the reconcile — which runs when the
  // freshly composed scope gains its first tool layer — must finish the job.
  let running;
  const harness = createHarness({ presetOf: () => running });
  harness.install();
  const agent = harness.addAgent({ id: 'late-composition' });
  harness.emit('agent/created', { agent });
  assert.equal(harness.stateOf(agent).calls, 0, 'no roster answer yet means no mask yet');
  running = PRESET_ID;
  harness.emit('tools/change', {});
  assertDenied(harness, agent, DENY);
}

// ── idempotence: the mask must not chase its own tools/change ───────────────

{
  const harness = createHarness();
  harness.install();
  const agent = harness.addAgent({ id: 'orchestrator' });
  harness.emit('agent/created', { agent });
  harness.emit('agent/created', { agent });
  harness.emit('tools/change', {});
  harness.emit('tools/change', {});
  assertDenied(harness, agent, DENY);
  assert.equal(harness.stateOf(agent).calls, DENY.length, 'repeated events must not re-restrict the same agent');
}

// ── the reconcile path: preset switch and pre-existing agents ──────────────

{
  // A blank session switched INTO this preset: `recompose()` re-links the
  // existing agent and emits tools/change, so no agent/created ever fires.
  const harness = createHarness();
  harness.install();
  const agent = harness.addAgent({ id: 'switched' });
  harness.emit('tools/change', {});
  assertDenied(harness, agent, DENY);
}

{
  // An agent that already existed when the row applied (the mount happens
  // inside the agent factory's setup, so this is the switch case again).
  const harness = createHarness();
  const agent = harness.addAgent({ id: 'pre-existing' });
  harness.install();
  assertDenied(harness, agent, DENY);
}

{
  // Same shape, other preset: the roster check is the only thing keeping this
  // process-wide reconciliation from masking other sessions.
  const harness = createHarness({ presetOf: () => 'standard' });
  const agent = harness.addAgent({ id: 'standard-session' });
  harness.install();
  harness.emit('tools/change', {});
  assertDenied(harness, agent, []);
  assert.equal(harness.stateOf(agent).calls, 0);
}

// ── failure modes ──────────────────────────────────────────────────────────

{
  // POSIX has no `pwsh`; the remaining names must still land.
  const harness = createHarness({ rejectNames: ['pwsh'] });
  harness.install();
  const agent = harness.addAgent();
  harness.emit('agent/created', { agent });
  assertDenied(harness, agent, DENY.filter((tool) => tool !== 'pwsh'));
  assert.equal(harness.stateOf(agent).calls, DENY.length, 'every name is attempted, not short-circuited');
  assert.deepEqual(harness.warnings, [], 'a partially applied mask is not a warning');
}

{
  // The harness renamed or dropped every tool: the mask is a no-op, which must
  // be loud rather than silent.
  const harness = createHarness({ rejectNames: DENY });
  harness.install();
  const agent = harness.addAgent({ id: 'unmaskable' });
  harness.emit('agent/created', { agent });
  assertDenied(harness, agent, []);
  assert.equal(harness.warnings.length, 1);
  assert.match(harness.warnings[0], /NOT masked/);
  assert.match(harness.warnings[0], /unmaskable/);
}

{
  // A rosterless deployment masks nothing on the creation path — failing open
  // there is the safe direction, since such a deployment has no other presets
  // to protect but also no way to tell whose agent is whose.
  const harness = createHarness({ roster: false, registry: false });
  harness.install();
  const agent = harness.addAgent();
  harness.emit('agent/created', { agent });
  assertDenied(harness, agent, []);
  assert.deepEqual(harness.warnings, [], 'declining to mask without a roster is not a warning');
}

{
  // Without the agents registry the reconcile path degrades to a no-op instead
  // of throwing inside someone else's `tools/change` listener.
  const harness = createHarness({ registry: false });
  harness.install();
  assert.doesNotThrow(() => harness.emit('tools/change', {}));
}

console.log('ok: mask — created/reconcile paths, idempotence, degraded registries');
