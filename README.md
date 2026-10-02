# pi-minimal-tools-view

Minimal tool views for [Pi](https://pi.dev). Consecutive tool activity shares one summary. Click it to reveal per-block rows, then click a row or press Ctrl+O to inspect its details.

```text
● ran 3 commands · read 5 times · edited 2 times (1 failed)
├─ 4 tool calls · 2 reads · 2 edits
├─ 3 tool calls · 2 commands · 1 read
└─ 3 tool calls · 1 command · 2 reads
```

The aggregate header keeps its status dot. Child rows use tree connectors instead of big dots. Detailed views retain their backgrounds, syntax-highlighted source, output, and diffs.

## Install

```bash
pi install git:github.com/VinhLe1410/pi-minimal-tools-view
```

This package provides its own renderer-backed codemode extension. Disable Pi's built-in codemode extension through `/config`, or merge this exclusion into your agent settings:

```json
{
  "extensions": ["-builtin:codemode"]
}
```

Do not replace other existing extension settings. Disable any other extensions that replace the same tool renderers. Run `/reload` after changing the configuration.

Aggregation starts enabled. Codemode is available through the package. To select codemode alongside Pi's default tools, merge `"+codemode"` into `defaultTools`.

## Controls

| Action | Behavior |
| --- | --- |
| Click an aggregate summary | Reveal or regroup its per-block rows |
| Click a child row | Toggle that block's original detailed view |
| Ctrl+O | Keep Pi's normal global tool-detail expansion |
| `/minimal-tools-view` | Toggle aggregation |
| `/minimal-tools-view on` | Enable aggregation |
| `/minimal-tools-view off` | Show standalone tool rows and thinking |

Hidden groups stay aggregated even when Ctrl+O expands their underlying tools. Revealing a group afterward shows those details immediately.

Clicks work in fullscreen mode. Regular mode leaves mouse input to the terminal; use `/minimal-tools-view off` to inspect rows there.

Reload resets aggregation to on and regroups revealed rows.

## Behavior

- Visible assistant text, user messages, and other visible notices separate aggregates.
- Thinking is completely hidden while aggregation is enabled. Thinking-only turns do not split groups.
- The input border stays `Working…`, without counts.
- Counts describe invocations, not unique files. Bash and PowerShell invocations count as commands.
- Codemode children keep counts for their own block. They are not flattened into individual command rows.
- Running and cancelled counts remain visible. Failures end the aggregate line as `(n failed)`.
- Tool execution, model-facing results, and saved messages are unchanged.

## Compatibility

Tested against Pi 1.0.0. The transcript view uses private Pi component fields and layout. Detected shape changes disable aggregation and show a warning.

There are no global component-prototype patches or keyboard interception. Tree wrappers reuse the original tool components and forward mouse coordinates.

Revealed state follows the first tool component in each group. New consecutive blocks stay revealed during streaming. Rebuilding history resets reveal state. The view rebuilds on each render rather than caching large histories.

## Development

Requires Node.js 22.19 or newer and pnpm. The package declares its pnpm version in `packageManager`.

```bash
git clone https://github.com/VinhLe1410/pi-minimal-tools-view.git
cd pi-minimal-tools-view
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
```

`pnpm typecheck` runs strict TypeScript checks. `pnpm test` runs the UI regression tests. `pnpm check` runs both.

Try the local extension without installing another copy:

```bash
pi --no-extensions -e .
```

Pi supplies the runtime peer dependencies. Matching host packages are development dependencies for tests; they are not bundled into the extension.

## Layout

- `index.ts`: the only extension entry point.
- `builtins.ts`: built-in tool definitions and minimal renderers.
- `codemode.ts`: codemode definition and per-block renderer.
- `activity.ts`: shared call validation and activity counts.
- `session-view.ts`: session lifecycle, working label, and toggle command.
- `transcript.ts`: host-shape checks, grouping, and visibility.
- `tree.ts`: branch connectors and mouse forwarding.
- `tool-render.ts`: shared tool rendering and detailed components.
- `tests/minimal-tools-view.test.ts`: UI regression tests.

The package is distributed through Git. It is marked private to prevent accidental npm publication.
