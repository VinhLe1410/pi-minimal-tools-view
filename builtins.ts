import { homedir } from "node:os";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createPowerShellToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  getLanguageFromPath,
  renderDiff,
  type ExtensionAPI,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { Static, TSchema } from "typebox";
import { codeBody, minimalTool, type BodyRenderers, type SummaryPart } from "./tool-render.ts";

function shortPath(value: string | undefined) {
  const path = value || ".";
  const home = homedir();
  if (path === home) return "~";
  return path.startsWith(home + "/") ? "~" + path.slice(home.length) : path;
}

function editStats(patch: string): SummaryPart[] {
  let added = 0;
  let removed = 0;
  let inHunk = false;
  // Edit patches describe one file. Only hunk lines count as changes.
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@ ")) inHunk = true;
    else if (inHunk && line.startsWith("+")) added++;
    else if (inHunk && line.startsWith("-")) removed++;
  }
  return [{ count: added, color: "success", prefix: "+" }, "/", { count: removed, color: "error", prefix: "-" }];
}

function writeStats(content: string): SummaryPart[] {
  const count = content ? content.split("\n").length - (content.endsWith("\n") ? 1 : 0) : 0;
  return [{ count, color: "success" }, ` line${count === 1 ? "" : "s"}`];
}

export default function minimalBuiltins(pi: ExtensionAPI) {
  const cwd = process.cwd();
  function register<TParams extends TSchema, TDetails, TState>(
    tool: ToolDefinition<TParams, TDetails, TState>,
    describe: (args: Static<TParams>) => string,
    body: BodyRenderers<TParams, TDetails, TState> & {
      stats?: (args: Static<TParams>, details: TDetails) => readonly SummaryPart[];
    } = {},
  ) {
    const label = (args: Static<TParams>) => [tool.name, describe(args)].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    pi.registerTool(minimalTool({ ...tool, defaultActive: false }, {
      ...body,
      call: (args) => label(args),
      result: (args, result, options, isError) => {
        if (isError) return label(args) + " (failed)";
        return !options.isPartial && body.stats
          ? [label(args), " (", ...body.stats(args, result.details), ")"]
          : label(args);
      },
    }));
  }

  // Settings are available after startup, so apply them when these tools execute.
  const read = createReadToolDefinition(cwd);
  register({
    ...read,
    execute(...args) {
      return createReadToolDefinition(cwd, {
        autoResizeImages: pi.getSettings().images?.autoResize ?? true,
      }).execute(...args);
    },
  }, (args) => args.path ? shortPath(args.path) : "", { callBody: false });

  const bash = createBashToolDefinition(cwd);
  register({
    ...bash,
    execute(...args) {
      const settings = pi.getSettings();
      return createBashToolDefinition(cwd, {
        commandPrefix: settings.shellCommandPrefix,
        shellPath: settings.shellPath,
      }).execute(...args);
    },
  }, (args) => args.command || "");

  register(createPowerShellToolDefinition(cwd), (args) => args.command || "");
  register(createEditToolDefinition(cwd), (args) => args.path ? shortPath(args.path) : "", {
    stats: (_args, details) => {
      if (!details) throw new Error("Expected a patch for a successful edit");
      return editStats(details.patch);
    },
    callBody: false,
    resultBody: (result, _options, theme, context) => {
      // The actual diff comes from the completed tool result, without a pre-execution file read.
      const content = context.isError
        ? theme.fg("error", result.content.filter((block) => block.type === "text").map((block) => block.text).join("\n"))
        : renderDiff(result.details?.diff ?? "");
      const component = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
      component.setText(content);
      return component;
    },
  });
  register(createWriteToolDefinition(cwd), (args) => args.path ? shortPath(args.path) : "", {
    stats: (args) => writeStats(args.content),
    callBody: (args, theme, context) => codeBody(args.content || "", getLanguageFromPath(args.path || ""), theme, context.lastComponent),
  });
  register(createGrepToolDefinition(cwd), (args) => [args.pattern, shortPath(args.path)].filter(Boolean).join(" "), { callBody: false });
  register(createFindToolDefinition(cwd), (args) => [args.pattern, shortPath(args.path)].filter(Boolean).join(" "), { callBody: false });
  register(createLsToolDefinition(cwd), (args) => shortPath(args.path), { callBody: false });
}
