import {
  AssistantMessageComponent,
  ToolExecutionComponent,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { MouseRegion, Spacer, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { isRecord, type OperationStatus } from "./operations.ts";
import { minimalTree } from "./tree.ts";

export class ViewShapeError extends Error {}

// npm development installs can contain another copy of Pi's component classes.
function isKind(value: unknown, kind: { name: string; prototype: object }) {
  return isRecord(value) && (kind.prototype.isPrototypeOf(value) ||
    (typeof value.constructor === "function" && value.constructor.name === kind.name));
}

function isComponent(value: unknown): value is Component {
  return isRecord(value) && typeof value.render === "function" && typeof value.invalidate === "function";
}

function isContainer(value: unknown): value is Component & { children: Component[] } {
  return isComponent(value) && "children" in value &&
    Array.isArray(value.children) && value.children.every(isComponent);
}

// Pi 1.0.0 mounts the transcript document first; chat is its last child.
export function findChat(tui: unknown) {
  if (!isRecord(tui) || !Array.isArray(tui.children)) {
    throw new ViewShapeError("Pi's TUI children are unavailable");
  }
  const document: unknown = tui.children[0];
  if (!isContainer(document)) {
    throw new ViewShapeError("Pi's transcript document is unavailable");
  }
  const chat = document.children.at(-1);
  if (!isContainer(chat)) {
    throw new ViewShapeError("Pi's chat container is unavailable");
  }
  return chat;
}

type Call = { name: string; status: OperationStatus; args?: string; error?: string };
type ToolSnapshot = { calls: readonly Call[]; active: boolean; scriptFailed: boolean };
type Group = { tools: Component[]; anchor: Component };
type GroupInteraction = { revealed: WeakSet<Component>; requestRender: () => void };

function isCall(value: unknown): value is Call {
  return isRecord(value) && typeof value.name === "string" &&
    (value.args === undefined || typeof value.args === "string") &&
    (value.error === undefined || typeof value.error === "string") &&
    (value.status === "running" || value.status === "ok" ||
      value.status === "error" || value.status === "cancelled");
}

function toolSnapshot(component: unknown): ToolSnapshot {
  if (!isRecord(component) || typeof component.toolName !== "string" ||
    typeof component.isPartial !== "boolean") {
    throw new ViewShapeError("Pi's tool component fields changed");
  }
  const result = component.result;
  if (result !== undefined && (!isRecord(result) || typeof result.isError !== "boolean")) {
    throw new ViewShapeError("Pi's tool result fields changed");
  }
  const failed = isRecord(result) && result.isError === true;
  if (component.toolName === "codemode") {
    const details = isRecord(result) ? result.details : undefined;
    if (details !== undefined && (!isRecord(details) || !Array.isArray(details.calls) ||
      !details.calls.every(isCall))) {
      throw new ViewShapeError("Unexpected codemode call details");
    }
    // Each update replaces a complete snapshot. Parallel calls can temporarily share an id.
    const calls = isRecord(details) && Array.isArray(details.calls) && details.calls.every(isCall)
      ? details.calls : [];
    return { calls, active: component.isPartial, scriptFailed: failed };
  }
  return {
    calls: [{ name: component.toolName, status: component.isPartial ? "running" : failed ? "error" : "ok" }],
    active: component.isPartial,
    scriptFailed: false,
  };
}

export function summarizeTools(tools: readonly unknown[]) {
  const snapshots = tools.map(toolSnapshot);
  const calls = snapshots.flatMap((snapshot) => snapshot.calls);
  const counts = new Map<string, number>();
  for (const call of calls) {
    const name = call.name === "bash" || call.name === "powershell" ? "command" : call.name;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return {
    total: calls.length,
    counts,
    running: calls.filter((call) => call.status === "running").length,
    // A failed wrapper does not add another failure when its operation already failed.
    failed: snapshots.reduce((total, snapshot) => {
      const failed = snapshot.calls.filter((call) => call.status === "error").length;
      return total + (failed || (snapshot.scriptFailed ? 1 : 0));
    }, 0),
    cancelled: calls.filter((call) => call.status === "cancelled").length,
    active: snapshots.some((snapshot) => snapshot.active),
  };
}

export function summaryText(summary: ReturnType<typeof summarizeTools>) {
  const parts: string[] = [];
  const commands = summary.counts.get("command");
  if (commands) parts.push(`ran ${commands} command${commands === 1 ? "" : "s"}`);
  const verbs = new Map([
    ["read", "read"],
    ["edit", "edited"],
    ["write", "wrote"],
    ["grep", "searched text"],
    ["find", "searched for files"],
    ["ls", "listed files"],
  ]);
  for (const [name, count] of summary.counts) {
    if (name === "command") continue;
    parts.push(`${verbs.get(name) ?? `used ${name}`} ${count} time${count === 1 ? "" : "s"}`);
  }
  if (summary.running) parts.push(`${summary.running} running`);
  if (summary.cancelled) parts.push(`${summary.cancelled} cancelled`);
  const text = parts.join(" · ");
  if (summary.failed) return `${text ? text + " " : ""}(${summary.failed} failed)`;
  return text || (summary.active ? "working…" : "no operations");
}

function summaryComponent(group: Group, theme: Theme, padding: number, interaction?: GroupInteraction): Component {
  const summary: Component = {
    render(width) {
      const summary = summarizeTools(group.tools);
      const color = summary.failed ? "error" : summary.cancelled ? "warning" : "muted";
      const prefix = theme.fg(summary.active ? "accent" : color, summary.active ? "◌" : "●");
      const inset = Math.min(padding, Math.max(0, width));
      const line = prefix + " " + theme.fg("muted", summaryText(summary));
      return ["", " ".repeat(inset) + truncateToWidth(line, Math.max(0, width - inset))];
    },
    invalidate() {},
  };
  if (!interaction) return summary;
  return new MouseRegion(summary, (event) => {
    // The summary's first row is spacing, not a click target.
    if (event.type !== "click" || event.button !== "left" || event.y !== 1) return undefined;
    if (interaction.revealed.has(group.anchor)) interaction.revealed.delete(group.anchor);
    else interaction.revealed.add(group.anchor);
    interaction.requestRender();
    return { handled: true };
  });
}

function assistantView(component: Component) {
  if (!isRecord(component) || !isContainer(component.contentContainer)) {
    throw new ViewShapeError("Pi's assistant content container changed");
  }
  const container = component.contentContainer;
  const kept: Component[] = [];
  let afterThinking = false;
  for (const child of container.children) {
    if (isKind(child, MouseRegion)) {
      afterThinking = true;
      continue;
    }
    if (afterThinking && isKind(child, Spacer)) {
      afterThinking = false;
      continue;
    }
    afterThinking = false;
    kept.push(child);
  }
  // Preserve text, including intermediate replies and error/abort notices.
  if (kept.every((child) => isKind(child, Spacer))) return undefined;

  function withVisibleChildren<T>(action: () => T) {
    const original = container.children;
    container.children = kept;
    try {
      return action();
    } finally {
      container.children = original;
    }
  }

  return {
    render: (width: number) => withVisibleChildren(() => component.render(width)),
    invalidate: () => component.invalidate(),
    handleMouse: (event) => withVisibleChildren(() => component.handleMouse?.(event)),
  } satisfies Component;
}

// The stored components never change. Only this render's child list is projected.
export function buildTranscriptView(children: readonly Component[], theme: Theme, padding = 1, interaction?: GroupInteraction) {
  const view: Component[] = [];
  let group: Group | undefined;
  function finishGroup() {
    if (group && interaction?.revealed.has(group.anchor)) {
      view.push(minimalTree(group.tools, theme, padding));
    }
    group = undefined;
  }
  for (const child of children) {
    if (isKind(child, ToolExecutionComponent)) {
      // Validate before hiding anything, so an incompatible host retains its normal view.
      toolSnapshot(child);
      if (!group) {
        group = { tools: [], anchor: child };
        view.push(summaryComponent(group, theme, padding, interaction));
      }
      group.tools.push(child);
    } else if (isKind(child, AssistantMessageComponent)) {
      const assistant = assistantView(child);
      if (assistant) {
        finishGroup();
        view.push(assistant);
      }
    } else {
      if (isKind(child, Spacer) && group) continue;
      finishGroup();
      view.push(child);
    }
  }
  finishGroup();
  return view;
}

export function installTranscriptView(
  chat: Component & { children: Component[] },
  options: {
    enabled: () => boolean;
    theme: () => Theme;
    padding: () => number;
    requestRender: () => void;
    incompatible: (error: ViewShapeError) => void;
  },
) {
  const originalRender = chat.render;
  const interaction: GroupInteraction = { revealed: new WeakSet(), requestRender: options.requestRender };
  function render(this: typeof chat, width: number) {
    if (!options.enabled()) return originalRender.call(this, width);
    let view: Component[];
    try {
      view = buildTranscriptView(this.children, options.theme(), options.padding(), interaction);
    } catch (error) {
      if (!(error instanceof ViewShapeError)) throw error;
      options.incompatible(error);
      return originalRender.call(this, width);
    }
    const originalChildren = this.children;
    this.children = view;
    try {
      return originalRender.call(this, width);
    } finally {
      this.children = originalChildren;
    }
  }
  chat.render = render;
  return () => {
    if (chat.render === render) chat.render = originalRender;
  };
}
