import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import minimalBuiltins from "./builtins.ts";
import minimalCodemode from "./codemode.ts";
import aggregateTools from "./aggregate.ts";

export default async function minimalToolsView(pi: ExtensionAPI) {
  minimalBuiltins(pi);
  await minimalCodemode(pi);
  aggregateTools(pi);
}
