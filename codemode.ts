import {
  createCodemodeExtension,
  type CodemodeToolDetails,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { codeBody, minimalTool, type SummaryPart } from "./render.ts";

type SummaryCall = Pick<CodemodeToolDetails["calls"][number], "name" | "status">;

function isSummaryCall(value: unknown): value is SummaryCall {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    "status" in value &&
    (value.status === "running" ||
      value.status === "ok" ||
      value.status === "error" ||
      value.status === "cancelled")
  );
}

export function getCalls(details: unknown): readonly SummaryCall[] {
  if (details === undefined) return [];
  if (
    typeof details !== "object" ||
    details === null ||
    !("calls" in details) ||
    !Array.isArray(details.calls) ||
    !details.calls.every(isSummaryCall)
  ) {
    throw new Error("Unexpected codemode call details");
  }
  return details.calls;
}

function scriptSource(args: unknown) {
  return typeof args === "object" && args !== null && "code" in args && typeof args.code === "string" ? args.code : "";
}

export function summarize(calls: readonly SummaryCall[], isPartial: boolean, isError: boolean): SummaryPart[] {
  const counts = new Map<string, number>();
  for (const call of calls) {
    const name = call.name === "bash" || call.name === "powershell" ? "command" : call.name;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const parts: SummaryPart[] = [{ count: calls.length }, ` tool call${calls.length === 1 ? "" : "s"}`];
  for (const [name, count] of counts) {
    const plural = count !== 1 && ["read", "command", "edit", "write"].includes(name);
    parts.push(" · ", { count }, ` ${name}${plural ? "s" : ""}`);
  }

  const notices: SummaryPart[][] = [];
  const failed = calls.filter((call) => call.status === "error").length;
  const cancelled = calls.filter((call) => call.status === "cancelled").length;
  const running = calls.filter((call) => call.status === "running").length;
  if (failed) notices.push([{ count: failed }, " failed"]);
  else if (isError) notices.push(["failed"]);
  if (cancelled) notices.push([{ count: cancelled }, " cancelled"]);
  if (isPartial) notices.push(running ? [{ count: running }, " running"] : ["running"]);
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
        result: (_args, result, options, isError) => summarize(getCalls(result.details), options.isPartial, isError),
        callBody: (args, theme, context) => codeBody(scriptSource(args).trimEnd(), "javascript", theme, context.lastComponent),
      }));
    },
  });
}
