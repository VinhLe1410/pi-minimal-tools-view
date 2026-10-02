# pi-minimal-tools-view

Minimal tool views for [Pi](https://pi.dev). Consecutive tool activity shares one summary:

```text
● ran 3 commands · read 5 times · edited 2 times (1 failed)
```

Click the summary to reveal the original tool rows under tree connectors. Builtins, codemode, and addon tools keep their native renderers, previews, details, and interactions. This extension groups their display without registering or replacing any tools.

## Install

```bash
pi install git:github.com/VinhLe1410/pi-minimal-tools-view
```

Keep your normal tool and addon configuration. This package does not provide codemode or change which tools are active. Aggregation starts enabled.

**Upgrading from the replacement-renderer version:** remove the `"-builtin:codemode"` exclusion added for this package, or re-enable Pi's built-in codemode through `/config`. Keep other extension settings and your existing tool selection. Run `/reload` after updating.

## Controls

| Action | Behavior |
| --- | --- |
| Click an aggregate summary | Reveal or regroup the original tool rows |
| Interact with a revealed row | Use its native click and expansion behavior |
| Ctrl+O | Keep Pi's normal global tool-detail expansion |
| `/minimal-tools-view` | Toggle aggregation |
| `/minimal-tools-view on` | Enable aggregation |
| `/minimal-tools-view off` | Restore the normal transcript, including thinking |

Hidden groups stay aggregated even when Ctrl+O expands their underlying tools. Revealing a group afterward shows those details immediately.

Clicks work in fullscreen mode. Regular mode leaves mouse input to the terminal; use `/minimal-tools-view off` to inspect rows there.

Reload resets aggregation to on and regroups revealed rows.

## Behavior

- Visible assistant text, user messages, and other visible notices separate aggregates.
- Thinking is completely hidden while aggregation is enabled. Thinking-only turns do not split groups.
- The input border stays `Working…`, without counts.
- Counts describe invocations, not unique files. Bash and PowerShell invocations count as commands.
- Codemode contributes its reported child calls to the aggregate. Revealing it shows the original codemode row, not separate child rows.
- Addon tools count as invocations, with wording such as `used lookup 2 times`. Their internal work is not counted unless it appears in codemode child-call details.
- Running and cancelled counts remain visible. Failures end the aggregate line as `(n failed)`.
- Tool registration, execution, settings, model-facing results, and saved messages are unchanged.
- Revealed rows can include native output previews. They no longer use this package's custom per-block summaries or detail styling.

## Compatibility

Tested against Pi 1.0.0. The transcript view uses private Pi component fields and layout. Detected shape changes disable aggregation and show a warning.

There are no tool replacements, renderer-state changes, global component-prototype patches, or keyboard interception. Tree wrappers reuse the original tool components and forward mouse coordinates. Rows render within the width left after indentation and tree connectors.

Addon renderers are not individually certified. They must follow Pi's component width and input contracts.

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
- `activity.ts`: call validation and activity counts.
- `session-view.ts`: session lifecycle, working label, and toggle command.
- `transcript.ts`: host-shape checks, grouping, and visibility.
- `tree.ts`: branch connectors and mouse forwarding.
- `tests/minimal-tools-view.test.ts`: UI regression tests.

The package is distributed through Git. It is marked private to prevent accidental npm publication.
