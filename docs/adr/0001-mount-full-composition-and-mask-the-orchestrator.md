# 0001. Mount the full composition and mask the top-level agent

Date: 2026-09-19
Status: accepted

## Context

The preset's whole point is an asymmetry: the top-level agent must have no tool
that can read a file, write a file, or run a command, while the subagents it
delegates to must have all of them.

The harness makes that asymmetry impossible to express directly, and the reasons
are worth recording because every "simplification" of this preset runs into them:

- `applyChildComposition()` (`@deepseek-ai/dsh-subagent`) composes a child with
  `agentPresets.composeFrom(childCtx, parent.ctx)`: a child **joins its parent's
  preset**, it does not name one.
- A child's tool scoping is `ToolRestriction`, which is `allow`/`deny` over
  tools the child *inherits*. It can remove, never add.
- `childSessionMeta()` records the composition read from the parent's live scope
  chain, so the preset a child runs under is not a per-call choice either.

So a composition that omits `tool-fs` and `tool-bash` produces blind children,
not capable ones. The only remaining lever is the other direction: mount the
tools, and remove them from the one agent that must not have them.

`tools.restrict()` turns out to be exactly that lever, and its semantics are what
make it safe. A restriction filters what a scope **inherits** — the global layer
and every ancestor layer on its chain — and never what the scope's own layer
registers. An agent's scope key is parented to the preset's standing key
(`bindScopeParent(agentKey, standing.key)`), **not** to its parent agent's scope,
so:

- a restriction installed on the orchestrator's scope hides the preset's tools
  from it, and
- no child chains through that scope, so every worker keeps the full toolset,

which is precisely the intended shape, achieved with a public API rather than a
patched harness.

## Considered options

- **Only mount the four capabilities, accept blind children.** Pure YAML, zero
  custom code, and useless for the task this preset exists for: a worker that
  cannot open a file cannot do the work the orchestrator delegated.
- **Let workers reach a different preset.** Would require a custom delegation
  provider reimplementing the in-process run lifecycle, cancellation, and
  `childSessionMeta`'s child composition record — a fork of the harness's
  delegation contract, and a cold-resumed child would rebuild under the wrong
  composition.
- **Only delegate out-of-process (codex / claude-code).** Keeps the preset pure
  YAML but makes in-process delegation dead weight, and requires provisioning
  optional bundles plus external product accounts before the preset does anything
  at all.

## Consequences

- The composition looks wrong at first glance — a preset that advertises "no code
  tools" mounts `tool-fs` and `tool-bash` — so the first paragraph of
  `agent.cordis.yml` and `presets/dsh-simple-orchestrator/mask.js` both explain
  why. This ADR is the long form of that explanation.
- The mask is a runtime restriction, not an absence: a session log shows the
  orchestrator never calling those tools, but the process still holds them. The
  guarantee is "the top-level agent cannot call them", not "they are not loaded".
- Child capability is bounded by the composition, so this preset necessarily
  grants workers everything the full coding preset grants. A future desire to
  trim what workers get must be expressed as `toolFilter` on the subagent rows
  (which can name only inherited — i.e. preset-scope — tools, never the
  per-agent `subagent`/`subagent_fork` registrations) or as `maxDepth`.
- The tool name lists in `mask.js` and in `test/composition.mjs` are now a
  contract: the suite fails when a mounted row can contribute a tool that is in
  neither KEEP nor DENY, so widening what a worker can do forces a decision about
  whether the orchestrator may see it.
