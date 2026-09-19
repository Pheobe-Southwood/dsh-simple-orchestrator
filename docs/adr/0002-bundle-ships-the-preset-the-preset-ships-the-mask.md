# 0002. Ship the preset inside the bundle, and the mask inside the preset

Date: 2026-09-19
Status: accepted

## Context

Installing this preset should be one command
(`dsh plugin --profile web add github:Pheobe-Southwood/dsh-simple-orchestrator`),
and the result must be a preset that a person can also copy out of the repo and
drop into `<dshHome>/.agent-presets/` without losing the thing that makes it an
orchestrator.

Those two wants pull the code apart. A roster scans only the roots it is told
about: the shipped root inside `dsh-agent-presets`, whatever `roots` a deployment
configures, and the harness home's `.agent-presets`. Nothing in a preset
directory can add a second root, and the roster derives its root set once at
construction — so discovery has to be arranged by a bundle layer, not by the
preset.

A bundle layer can compute a path, but only from what a patch expression can see:
`with (ctx) { … }` gives `baseUrl` (plus real globals). `baseUrl` is anchored at
the **profile directory** — the profile's `cordis.yml` exists on disk only so a
real include root can anchor it there — and `dsh plugin add` materializes every
dependency under that same directory's `node_modules`. The shipped `cordis`
preset already uses exactly this idiom to point a preset at its own `skills/`
directory, which is what makes it a house pattern rather than an invention.

## Decision

- `cordis.patch.yml` injects one `roots` entry pointing at
  `node_modules/dsh-simple-orchestrator/presets/` resolved from `baseUrl`, and it
  restates every other key the deployment's Web layer sets on the `agent-presets`
  row (`default`, `includeShippedRoot`, `includeUserRoot`), because a patch
  replaces the targeted row's whole `config`.
- The mask is `presets/dsh-simple-orchestrator/mask.js`, referenced as
  `./mask.js` by the composition — a preset-carried row — and NOT a host row in
  this package's `lib/`. It reaches the harness through `ctx.get()` and has no
  imports at all.

## Consequences

- The preset directory is the unit of meaning. Copying it into
  `.agent-presets/` yields a fully masked orchestrator with no bundle, no
  profile edit, and no import path that could break: `./mask.js` resolves against
  the composition's own directory, and having no imports is what keeps that true
  in a layout where no `node_modules` sits above the file.
- Because the mask is preset-carried, a host row in `lib/` would be dead weight —
  it could only be reached through the bundle, which the copy-only install does
  not have.
- `trust: system` records that the preset belongs to the deployment's bundle
  rather than to a person: it is not offered for deletion, and upgrades keep it
  current.
- The known cost: this bundle layer owns the `agent-presets` row's config. A
  later bundle layer patching the same row would replace it and take the root
  with it, and a deployment that restates that row must restate our roots entry
  too. The profile's own `cordis.patch.yml` and the home-level
  `$DSH_HOME/cordis.patch.yml` are applied after every bundle layer, so a user
  override always wins.
