import {
  createCodemodeExtension,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { getCalls, summarizeActivity } from "./activity.ts";
import { codeBody, minimalTool, type SummaryPart } from "./tool-render.ts";

function scriptSource(args: unknown) {
  return typeof args === "object" && args !== null && "code" in args && typeof args.code === "string" ? args.code : "";
}

function summarize(details: unknown, isPartial: boolean, isError: boolean): SummaryPart[] {
  const calls = getCalls(details);
  const summary = summarizeActivity([{ calls, active: isPartial, scriptFailed: isError }]);

  const parts: SummaryPart[] = [{ count: calls.length }, ` tool call${calls.length === 1 ? "" : "s"}`];
  for (const [name, count] of summary.counts) {
    const plural = count !== 1 && ["read", "command", "edit", "write"].includes(name);
    parts.push(" · ", { count }, ` ${name}${plural ? "s" : ""}`);
  }

  const notices: SummaryPart[][] = [];
  if (summary.failed) notices.push([{ count: summary.failed }, " failed"]);
  else if (summary.wrapperFailures) notices.push(["failed"]);
  if (summary.cancelled) notices.push([{ count: summary.cancelled }, " cancelled"]);
  if (summary.active) notices.push(summary.running ? [{ count: summary.running }, " running"] : ["running"]);
  if (notices.length) {
    parts.push(" (");
    notices.forEach((notice, index) => {
      if (index) parts.push(", ");
      parts.push(...notice);
    });
    parts.push(")");
  }
  return parts;
}

export default function minimalCodemode(pi: ExtensionAPI) {
  return createCodemodeExtension()({
    ...pi,
    registerTool(tool) {
      if (tool.name !== "codemode") {
        throw new Error("Expected Pi's codemode tool");
      }
      pi.registerTool(minimalTool(tool, {
        call: (_args, argsComplete) => argsComplete ? [{ count: 0 }, " tool calls"] : "writing tool call(s)",
        result: (_args, result, options, isError) => summarize(result.details, options.isPartial, isError),
        callBody: (args, theme, context) => codeBody(scriptSource(args).trimEnd(), "javascript", theme, context.lastComponent),
      }));
    },
  });
}
