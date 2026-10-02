import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import minimalBuiltins from "./builtins.ts";
import minimalCodemode from "./codemode.ts";
import registerSessionView from "./session-view.ts";

export default async function minimalToolsView(pi: ExtensionAPI) {
  minimalBuiltins(pi);
  await minimalCodemode(pi);
  registerSessionView(pi);
}
