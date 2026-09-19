# dsh-simple-orchestrator

An agent preset for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
whose top-level agent **cannot touch code**: it reads skills, asks the user,
searches the web, tracks progress, and delegates — and every subagent it starts
gets the complete coding toolset.

The preset's display name is **编排模式** and its id is `dsh-simple-orchestrator`.

## What it is for

Delegation is the point, not an implementation detail:

- The orchestrator owns no file and no shell tool. `read`, `write`, `edit`,
  `read_image`, `glob`, `grep`, `bash`, and `pwsh` are not in its catalog, so a
  session on this preset cannot "just quickly look" — it has to say what it wants
  and hand that to a worker.
- Every worker is a full coding agent: it inherits this preset's composition,
  which mounts the complete toolset, and it may delegate further (depth ≤ 3).
- Waiting is free. The orchestrator does not hold a turn open for its workers: a
  settled subagent wakes the session, so a delegation round-trip costs no
  polling. A worker that stalls or hands back a half-finished result is nudged
  with a message rather than started over.

## Install

```sh
dsh plugin --profile web add github:Pheobe-Southwood/dsh-simple-orchestrator
```

Then **restart dsh**: the profile's bundle list is read at boot, so the preset
appears in the picker on the next start (new sessions can pick 编排模式; the
default preset for new sessions is unchanged — still `standard`).

The install is one command because the package declares `dsh.bundle`: the CLI's
reconcile step appends it to `dsh.profile.bundles`, and its `cordis.patch.yml`
adds this package's `presets/` directory to the roster's roots. Nothing has to be
hand-written into the profile's own patch file.

Verified on this machine, without touching the real profile:

```
$ DSH_HOME=/tmp/probe dsh plugin --profile web add link:$PWD
$ DSH_HOME=/tmp/probe dsh --profile web --dump-config
# == @deepseek-ai/dsh-web-app, patched by dsh-simple-orchestrator
- id: agent-presets
  name: '@deepseek-ai/dsh-agent-presets'
  config:
    default: standard
    includeShippedRoot: true
    includeUserRoot: true
    roots:
      - path: !!js >-
          process.getBuiltinModule('node:url').fileURLToPath(new
          URL('node_modules/dsh-simple-orchestrator/presets/', baseUrl))
        trust: system
```

`--dump-config` composes the layers without evaluating `!!js`, which is why the
expression is shown unevaluated; `test/roots-path.mjs` evaluates it against both
shapes `baseUrl` can take, and `test/discovery.mjs` runs the harness's own
`discoverPresets()` over the result.

The preset is also usable with no bundle at all: copy
`presets/dsh-simple-orchestrator/` into `${DSH_HOME:-~/.dsh}/.agent-presets/`.
The mask is a row the preset carries (`./mask.js`), so a copied directory is
still a masked orchestrator — the roster re-reads its roots on every call, so it
shows up without a restart.

## The tool surface

**Kept** — what the orchestrator may see:

| Tool | Why |
| --- | --- |
| `skill` | load task instructions from the skill catalog |
| `ask_user_question` | decisions belong to the user |
| `web_search`, `web_fetch` | facts from outside the workspace |
| `todo_write` | multi-step delegation needs a visible plan |
| `exit_plan_mode` | approval gate before work starts |
| `get_goal`, `create_goal`, `update_goal` | work that spans several turns |
| `present` | declare a deliverable produced by a worker |
| `job_output`, `job_list`, `job_kill` | collect or stop background work |
| `subagent`, `subagent_fork` | start workers |
| `send_message`, `interrupt_agent`, `list_agents` | steer and observe workers |
| `workflow`, `ralph` | fan-out and fresh-agent iteration |

**Denied** — removed from the orchestrator alone:
`read`, `write`, `edit`, `read_image`, `glob`, `grep`, `bash`, `pwsh`.

Workers see the union of both lists; the composition is their ceiling. Two tool
names are deliberately not part of the mask's business: `subagent`,
`subagent_fork`, and `list_subagent_models` are registered by the delegation tool
into each agent's OWN scope, which no restriction can name or hide — which is
also why they are always available to the orchestrator.

## How it works

A child agent **joins its parent's composition** — `applyChildComposition()`
calls `composeFrom(childCtx, parent.ctx)` — and a child's tool scoping can only
remove inherited tools, never add one. So "the orchestrator has no code tools
while its workers do" cannot be expressed by mounting fewer rows: that would
produce blind workers.

This preset mounts the complete toolset (so workers get it) and installs a
restriction on the top-level agent through the public `tools.restrict()` API. A
restriction filters what a scope *inherits*, and an agent's scope is parented to
the preset's standing key rather than to its parent agent's scope — so the mask
hides the tools from the orchestrator and reaches no worker.

See [docs/adr/0001](docs/adr/0001-mount-full-composition-and-mask-the-orchestrator.md)
for the rejected alternatives, and
[docs/adr/0002](docs/adr/0002-bundle-ships-the-preset-the-preset-ships-the-mask.md)
for why the mask travels inside the preset directory.

The persona is deliberately short, and stays that way: it states only what no
tool description can — the capabilities the orchestrator lacks, the full toolset
its workers have, how the two split the work, and how waiting and a stalled
worker are handled — because how a tool is used, what its parameters are, and
when to call it belong to that tool's own description and prompt section.
`send_message` is the single tool name it carries, since "have that subagent
continue" has to land on a tool the model can reach for. `test/composition.mjs`
enforces the budget and rejects any other tool inventory.

## Verify

```sh
npm run check                                            # lint + tests, no harness needed
dsh --profile web --dump-config | grep -A8 'id: agent-presets'
```

After a restart, start a session on 编排模式 and confirm two things: the
orchestrator's tool list is exactly the KEEP table, and a subagent can actually
read and write files.

`test/discovery.mjs` runs the harness's own `discoverPresets()` against this
package's `presets/` directory and fails if any composition row cannot be
resolved; it skips itself when no dsh install is found (point
`DSH_HARNESS_ANCHOR` at a profile's `package.json` to force it).

## Limits

- **The mask is a runtime restriction, not an absence.** The tools exist in the
  process; the orchestrator cannot call them. A session log therefore shows a
  top-level agent that never touched a file, and a worker of the same session
  that did.
- **This bundle layer owns the `agent-presets` row's config.** A patch replaces a
  row's whole config, so a later bundle layer patching that row would drop this
  package's root. The profile's own `cordis.patch.yml` and the home-level
  `$DSH_HOME/cordis.patch.yml` are applied last and always win.
- **Installing needs a restart.** The bundle list is read at boot; the roster is
  not.
- **Workers are as capable as the full coding preset.** Limits on what a worker
  may do belong on the subagent rows (`toolFilter`, `maxDepth`) — see
  `agent.cordis.yml`.
- **Editing `mask.js` alone does not affect a running process.** A preset
  generation is keyed on the composition file's mtime and size, so touch
  `agent.cordis.yml` or restart.
- **A blank session switched into this preset** is masked through the
  `tools/change` reconcile path rather than at creation. If the deployment
  composes no agent-preset roster, that fallback logs a warning and only the
  creation path applies.

## Development

```sh
npm install
npm run check     # eslint + node test/run.js
```

| Test | What it pins down |
| --- | --- |
| `test/composition.mjs` | the composition's rows, display metadata, the patch layer, and the KEEP ∪ DENY parity contract |
| `test/mask.mjs` | the mask's behavior against a fake registry: creation, subagents, idempotence, preset switch, absent tool names, degraded services |
| `test/roots-path.mjs` | the patch's `!!js` expression evaluated both ways `baseUrl` can arrive |
| `test/discovery.mjs` | the installed harness's own roster health check (skips without a harness) |

## License

MIT — see [LICENSE](LICENSE).
