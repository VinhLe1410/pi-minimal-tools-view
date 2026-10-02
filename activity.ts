import type { CodemodeToolDetails } from "@earendil-works/pi-coding-agent";

type ActivityCall = Pick<CodemodeToolDetails["calls"][number], "name" | "status">;

export type ActivitySnapshot = {
  calls: readonly ActivityCall[];
  active: boolean;
  scriptFailed: boolean;
};

export class ActivityShapeError extends Error {}

function isCall(value: unknown): value is ActivityCall {
  return typeof value === "object" && value !== null &&
    "name" in value && typeof value.name === "string" &&
    "status" in value && (value.status === "running" || value.status === "ok" ||
      value.status === "error" || value.status === "cancelled");
}

export function getCalls(details: unknown): readonly ActivityCall[] {
  if (details === undefined) return [];
  if (typeof details !== "object" || details === null ||
    !("calls" in details) || !Array.isArray(details.calls) || !details.calls.every(isCall)) {
    throw new ActivityShapeError("Unexpected codemode call details");
  }
  return details.calls;
}

export function summarizeActivity(snapshots: readonly ActivitySnapshot[]) {
  const counts = new Map<string, number>();
  let running = 0;
  let failed = 0;
  let cancelled = 0;
  let active = false;
  for (const snapshot of snapshots) {
    let callFailures = 0;
    for (const call of snapshot.calls) {
      const name = call.name === "bash" || call.name === "powershell" ? "command" : call.name;
      counts.set(name, (counts.get(name) ?? 0) + 1);
      if (call.status === "running") running++;
      if (call.status === "cancelled") cancelled++;
      if (call.status === "error") callFailures++;
    }
    // A failed wrapper adds a failure only when none of its calls failed.
    failed += callFailures || (snapshot.scriptFailed ? 1 : 0);
    active ||= snapshot.active;
  }
  return { counts, running, failed, cancelled, active };
}
