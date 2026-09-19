/**
 * The orchestrator's tool mask: deny the code, shell, and network tools to the
 * TOP-LEVEL agent of this preset, and to nothing else.
 *
 * Why this exists at all is in `agent.cordis.yml` beside this file and in
 * docs/adr/0001: a child agent joins its parent's composition and a child's
 * `toolFilter` can only remove inherited tools, so the only way to give workers
 * the full coding toolset while the orchestrator owns none is to mount the tools
 * and mask the top-level agent.
 *
 * Three properties are load-bearing and easy to break by "tidying up":
 *
 * 1. NO IMPORTS. The row is referenced as `./mask.js` from the composition, so
 *    the harness imports this file from wherever the preset directory happens to
 *    live — the profile's `node_modules` under a bundle install, or
 *    `<dshHome>/.agent-presets/<id>` under a copied one. Only the second layout
 *    has no `node_modules` above it, and there the harness's own base-URL
 *    override does not apply (it only redirects the row's own specifier, not
 *    this module's imports). Services are therefore reached by name through
 *    `ctx.get()`.
 *
 * 2. ONE `restrict()` CALL PER NAME, EACH TOLERATING FAILURE. The registry
 *    rejects a name it does not know — `pwsh` is absent on POSIX, and a future
 *    harness may rename a tool — and it rejects it BEFORE recording anything, so
 *    a failed call leaves no partial restriction behind. A single call naming
 *    every tool would fail whole on one absent name and leave the orchestrator
 *    unmasked, which is the one outcome this file must not produce silently;
 *    hence the per-name `catch` plus the warning when nothing landed.
 *
 * 3. IDEMPOTENCE BEFORE THE RESTRICTION, NOT AFTER. `restrict()` emits
 *    `tools/change`, which is also how a preset switch (which re-links an
 *    existing agent's scope instead of creating one) reaches this row. Marking
 *    the agent first is what stops that from looping.
 *
 * A restriction filters what a scope INHERITS and never what its own layer
 * registers, and an agent's scope is parented to this preset's standing key —
 * not to its parent agent's scope. That is exactly why children keep the tools:
 * they inherit the standing composition, and the mask was installed on the
 * orchestrator's own scope, which no child chains through.
 *
 * @module ./mask.js (loaded as a composition row by @deepseek-ai/dsh-agent-presets)
 */

/** Cordis plugin name. */
export const name = 'orchestrator-mask';

/**
 * The preset id whose top-level agents this row masks. Must stay equal to the
 * preset DIRECTORY's name; `test/composition.mjs` asserts exactly that, because
 * a rename that missed this constant would silently stop masking.
 */
export const PRESET_ID = 'dsh-simple-orchestrator';

/**
 * The tools the top-level orchestrator must never see: everything that can read
 * a file, write a file, run a command, or reach the network.
 *
 * The network tools are here because a lookup is work like any other: the
 * orchestrator asks a subagent for facts from outside the workspace instead of
 * fetching them itself, which also keeps the two web prompt sections (registered
 * per tool, and gated on that tool's visibility) out of its prompt.
 *
 * Every other tool this composition mounts is deliberately KEPT visible, and
 * `test/composition.mjs` holds the other half of that contract — it fails when a
 * mounted row can contribute a tool name that is in neither this list nor the
 * test's KEEP list, so a new tool row cannot quietly widen the orchestrator.
 */
export const DENY = [
  'read',
  'write',
  'edit',
  'read_image',
  'glob',
  'grep',
  'bash',
  'pwsh',
  'web_search',
  'web_fetch',
];

/**
 * Mask every top-level agent of this preset, now and as they appear.
 *
 * @param ctx - this row's context, inside the preset's standing mount. The
 *   mount's listeners receive the events of the agents JOINED to it, which is
 *   what makes the `agent/created` path safe without a roster lookup.
 */
export function apply(ctx) {
  /** Agents already handled, so a repeated event never re-restricts one. */
  const masked = new WeakSet();

  /**
   * Install the deny restriction on one agent the first time it is seen.
   * @param agent - a candidate agent from an event or the registry.
   */
  const maskOnce = (agent) => {
    if (agent === undefined || agent === null) return;
    if (masked.has(agent)) return;
    // Depth 0 is the orchestrator; every child (including a fork, a workflow
    // worker, and a ralph round) carries `origin: 'subagent'` in its durable
    // creation header and keeps the full toolset.
    if (agent.session?.header?.origin === 'subagent') return;
    masked.add(agent);
    try {
      agent.ctx.inject(['tools'], (runtimeCtx) => {
        let installed = 0;
        for (const toolName of DENY) {
          try {
            runtimeCtx.tools.restrict({ deny: [toolName] });
            installed += 1;
          } catch {
            // Not registered in this deployment (platform-gated or renamed).
          }
        }
        if (installed === 0) {
          ctx.logger?.warn(
            `orchestrator-mask: none of [${DENY.join(', ')}] could be denied for agent "${agent.id}" — check the harness tool names; the orchestrator is NOT masked`,
          );
        }
      });
    } catch (error) {
      // The restriction lives in a fiber owned by the agent's scope, so a
      // failure here means the agent is already gone or `tools` is unreadable.
      // Un-mark it: a later sighting gets another chance.
      masked.delete(agent);
      ctx.logger?.warn(`orchestrator-mask: failed to mask agent "${agent.id}": ${String(error)}`);
    }
  };

  /**
   * Catch agents that were composed BEFORE this row applied — the preset switch
   * case: `agentPresets.recompose()` re-links an existing agent's scope and
   * emits `tools/change` instead of creating one, so no `agent/created` fires.
   * The roster answers "which preset is this agent running" from the live scope
   * chain, which is what keeps other presets' sessions out of this loop.
   */
  const reconcile = () => {
    const agents = ctx.get('agents');
    const roster = ctx.get('agentPresets');
    if (agents === undefined || roster === undefined) return;
    try {
      for (const agent of agents.list()) {
        if (agent?.session?.header?.origin === 'subagent') continue;
        if (roster.composedPreset(agent.ctx) !== PRESET_ID) continue;
        maskOnce(agent);
      }
    } catch (error) {
      ctx.logger?.warn(`orchestrator-mask: reconcile failed: ${String(error)}`);
    }
  };

  ctx.on('agent/created', ({ agent }) => {
    maskOnce(agent);
  });
  ctx.on('tools/change', reconcile);
  reconcile();
}
