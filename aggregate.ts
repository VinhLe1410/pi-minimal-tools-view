import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  findChat,
  installTranscriptView,
  ViewShapeError,
} from "./transcript.ts";

const WIDGET_KEY = "pi-minimal-tools-view";

export default function aggregateTools(pi: ExtensionAPI) {
  let enabled = true;
  let context: ExtensionContext | undefined;
  let restore: (() => void) | undefined;
  let repaint: (() => void) | undefined;

  function incompatible(error: ViewShapeError) {
    enabled = false;
    context?.ui.setWorkingMessage();
    context?.ui.notify(`Minimal tools view disabled: ${error.message}`, "warning");
  }

  function dispose() {
    restore?.();
    restore = undefined;
    repaint = undefined;
    context?.ui.setWorkingMessage();
    context?.ui.setWidget(WIDGET_KEY, undefined, { placement: "belowEditor" });
    context = undefined;
  }

  pi.on("session_start", (_event, ctx) => {
    dispose();
    if (ctx.mode !== "tui") return;
    context = ctx;
    // An invisible widget supplies Pi's TUI without changing its layout.
    ctx.ui.setWidget(WIDGET_KEY, (tui) => {
      restore?.();
      try {
        restore = installTranscriptView(findChat(tui), {
          enabled: () => enabled,
          theme: () => ctx.ui.theme,
          padding: () => pi.getSettings().outputPad ?? 1,
          requestRender: () => tui.requestRender(),
          incompatible,
        });
        repaint = () => tui.requestRender();
      } catch (error) {
        if (!(error instanceof ViewShapeError)) throw error;
        incompatible(error);
      }
      return { render: () => [], invalidate() {} };
    }, { placement: "belowEditor" });
    if (enabled) ctx.ui.setWorkingMessage("Working…");
  });

  pi.on("session_shutdown", dispose);

  pi.registerCommand("minimal-tools-view", {
    description: "group tool calls between chat messages. Usage: /minimal-tools-view [on|off]",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("Minimal tools view is available only in the terminal UI", "warning");
        return;
      }
      const argument = args.trim().toLowerCase();
      if (argument !== "" && argument !== "on" && argument !== "off") {
        ctx.ui.notify("Usage: /minimal-tools-view [on|off]", "warning");
        return;
      }
      if (!restore) {
        ctx.ui.notify("Minimal tools view could not attach to Pi's chat container", "warning");
        return;
      }
      enabled = argument === "" ? !enabled : argument === "on";
      ctx.ui.setWorkingMessage(enabled ? "Working…" : undefined);
      repaint?.();
    },
  });
}
