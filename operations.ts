import { homedir } from "node:os";

export type OperationStatus = "running" | "ok" | "error" | "cancelled";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function shortPath(value: string | undefined) {
  const path = value || ".";
  const home = homedir();
  if (path === home) return "~";
  return path.startsWith(home + "/") ? "~" + path.slice(home.length) : path;
}
