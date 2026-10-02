import {
  highlightCode,
  type AgentToolResult,
  type Theme,
  type ThemeColor,
  type ToolDefinition,
  type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { Box, Container, Text, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import type { Static, TSchema } from "typebox";

export type SummaryPart = string | { count: number; color?: ThemeColor; prefix?: "+" | "-" };
export type Summary = string | readonly SummaryPart[];
export type BodyRenderers<TParams extends TSchema, TDetails, TState> = {
  callBody?: false | ToolDefinition<TParams, TDetails, TState>["renderCall"];
  resultBody?: ToolDefinition<TParams, TDetails, TState>["renderResult"];
};

const INSET = 2;
const treeRows = new WeakSet<object>();

function isTreeRow(state: unknown) {
  return typeof state === "object" && state !== null && treeRows.has(state);
}

export function withMinimalTreeRow<T>(state: unknown, render: () => T) {
  // Third-party tools can have a different renderer state and keep their own rendering.
  if (typeof state !== "object" || state === null) return render();
  const alreadyInTree = treeRows.has(state);
  treeRows.add(state);
  try {
    return render();
  } finally {
    if (!alreadyInTree) treeRows.delete(state);
  }
}

function summaryText(summary: Summary, theme: Theme) {
  const parts = typeof summary === "string" ? [summary] : summary;
  return parts.map((part) => typeof part === "string"
    ? theme.fg("muted", part)
    : theme.fg(part.color ?? "accent", `${part.prefix ?? ""}${part.count}`)).join("");
}

class SummaryLine extends Text {
  constructor(private readonly getSummary: () => string, private readonly getInset: () => number) {
    super("", 0, 0);
  }

  override render(width: number): string[] {
    const inset = Math.min(this.getInset(), Math.max(0, width));
    return [" ".repeat(inset) + truncateToWidth(this.getSummary(), Math.max(0, width - inset - INSET))];
  }
}

class DetailsBox extends Box {
  constructor(private readonly theme: Theme, status: { isPartial: boolean; isError: boolean }) {
    super(1, 1, (text) => theme.bg(status.isPartial ? "toolPendingBg" : status.isError ? "toolErrorBg" : "toolSuccessBg", text));
  }

  setContent(call: Component | undefined, result: Component | undefined) {
    this.clear();
    if (call) this.addChild(call);
    if (result) this.addChild(result);
  }

  override render(width: number): string[] {
    const available = width - INSET * 2 - 1;
    if (available <= 0) return [];
    const prefix = " ".repeat(INSET) + this.theme.fg("borderMuted", "│");
    return super.render(available).map((line) => prefix + truncateToWidth(line, available));
  }
}

class HighlightedBody extends Text {
  private source?: string;
  private language?: string;
  private theme?: Theme;

  constructor() {
    super("", 0, 0);
  }

  update(source: string, language: string | undefined, theme: Theme) {
    if (source === this.source && language === this.language && theme === this.theme) return;
    this.source = source;
    this.language = language;
    this.theme = theme;
    const text = source.replace(/\r/g, "").replace(/\t/g, "   ");
    this.setText(language ? highlightCode(text, language).join("\n") : theme.fg("toolOutput", text));
  }

  override invalidate() {
    this.source = undefined;
    super.invalidate();
  }
}

export function codeBody(source: string, language: string | undefined, theme: Theme, previous?: Component) {
  const component = previous instanceof HighlightedBody ? previous : new HighlightedBody();
  component.update(source, language, theme);
  return component;
}

export function minimalTool<TParams extends TSchema, TDetails, TState>(
  tool: ToolDefinition<TParams, TDetails, TState>,
  summary: BodyRenderers<TParams, TDetails, TState> & {
    call: (args: Static<TParams>, argsComplete: boolean) => Summary;
    result: (
      args: Static<TParams>,
      result: AgentToolResult<TDetails>,
      options: ToolRenderResultOptions,
      isError: boolean,
    ) => Summary;
  },
): ToolDefinition<TParams, TDetails, TState> {
  const renderCall = summary.callBody === false ? undefined : summary.callBody ?? tool.renderCall;
  const renderResult = summary.resultBody ?? tool.renderResult;
  if (!renderResult) throw new Error(`Expected a result renderer for ${tool.name}`);

  const rows = new WeakMap<object, {
    text: Summary;
    hasResult: boolean;
    isPartial: boolean;
    isError: boolean;
    call?: Component;
    result?: Component;
    box?: DetailsBox;
  }>();
  function getRow(state: unknown) {
    if (typeof state !== "object" || state === null) {
      throw new Error("Expected tool renderer state to be an object");
    }
    let row = rows.get(state);
    if (!row) {
      row = { text: "", hasResult: false, isPartial: true, isError: false };
      rows.set(state, row);
    }
    return row;
  }

  return {
    ...tool,
    renderShell: "self",
    renderCall(args, theme, context) {
      const row = getRow(context.state);
      if (!summary.callBody || context.expanded) {
        row.call = renderCall?.(args, theme, { ...context, lastComponent: row.call });
      }
      row.isPartial = context.isPartial;
      row.isError = context.isError;
      if (!row.hasResult) row.text = summary.call(args, context.argsComplete);
      const view = new Container();
      view.addChild(new SummaryLine(
        () => (isTreeRow(context.state) ? "" : theme.fg("muted", "●") + " ") + summaryText(row.text, theme),
        () => isTreeRow(context.state) ? 0 : INSET,
      ));
      row.box = context.expanded ? new DetailsBox(theme, row) : undefined;
      if (row.box) {
        row.box.setContent(row.call, row.result);
        view.addChild(row.box);
      }
      return view;
    },
    renderResult(result, options, theme, context) {
      const row = getRow(context.state);
      // Native shell renderers maintain timing state and clean up their timers here.
      row.result = renderResult(result, options, theme, { ...context, lastComponent: row.result });
      row.text = summary.result(context.args, result, options, context.isError);
      row.hasResult = true;
      row.isPartial = options.isPartial;
      row.isError = context.isError;
      row.box?.setContent(row.call, row.result);
      // Both summary and details live in the call component, which reads this updated state.
      return new Container();
    },
  };
}
