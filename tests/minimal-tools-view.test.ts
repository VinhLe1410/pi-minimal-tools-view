import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { minimalTool, codeBody } from "../tool-render.ts";
import minimalToolsView from "../index.ts";
import {
  AssistantMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
  getMarkdownTheme,
  createReadToolDefinition,
  DefaultResourceLoader,
  SettingsManager,
  initTheme,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Container, ProcessTerminal, Spacer, Text, TuiMainScreen, visibleWidth, type Component, type TuiMouseEvent } from "@earendil-works/pi-tui";
import {
  findChat,
  installTranscriptView,
  ViewShapeError,
} from "../transcript.ts";

initTheme("dark");
const tui = new TuiMainScreen(new ProcessTerminal());
// Obtain the real theme passed to renderers, without importing private module paths.
let renderTheme: Theme | undefined;
const captureTool = {
  name: "capture",
  renderCall(_args: unknown, value: Theme) {
    renderTheme = value;
    return new Text("", 0, 0);
  },
};
new ToolExecutionComponent("capture", "capture", {}, {}, captureTool, tui, process.cwd());
if (!renderTheme) throw new Error("Expected Pi's tool renderer theme");
const activeTheme = renderTheme;

const codemodeTool = await (async () => {
  const directory = mkdtempSync(join(tmpdir(), "minimal-tools-view-"));
  try {
    const loader = new DefaultResourceLoader({
      cwd: directory,
      agentDir: directory,
      settingsManager: SettingsManager.inMemory(),
      extensionFactories: [minimalToolsView],
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await loader.reload();
    const result = loader.getExtensions();
    assert.deepEqual(result.errors, []);
    const definition = result.extensions[0]?.tools.get("codemode")?.definition;
    if (!definition) throw new Error("Expected the registered codemode tool");
    return definition;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
})();

function assistant(text = "", thinking = "private reasoning", toolCall = false, stopReason = "stop") {
  return new AssistantMessageComponent({
    role: "assistant",
    content: [
      { type: "thinking", thinking },
      ...(text ? [{ type: "text" as const, text }] : []),
      ...(toolCall ? [{ type: "toolCall" as const, id: "call", name: "codemode", arguments: { code: "" } }] : []),
    ],
    api: "openai-responses",
    provider: "openai",
    model: "test",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: stopReason === "aborted" ? "aborted" : stopReason === "error" ? "error" : "stop",
    timestamp: 0,
  }, true, getMarkdownTheme());
}

function call(name: string, status = "ok", args: Record<string, unknown> = {}, error?: string) {
  return { name, status, id: "same-temporary-id", args: JSON.stringify(args), error };
}

let toolId = 0;
function tool(name: string, calls: ReturnType<typeof call>[] = [], isPartial = false, isError = false) {
  const definition = name === "codemode" ? codemodeTool : minimalTool({
    ...createReadToolDefinition(process.cwd()),
    name,
    renderResult(result) {
      return new Text(result.content.filter((block) => block.type === "text").map((block) => block.text).join("\n"), 0, 0);
    },
  }, {
    call: () => name,
    result: () => name,
    callBody: (_args, theme, context) => codeBody("fixture_script();", "javascript", theme, context.lastComponent),
  });
  const component = new ToolExecutionComponent(name, String(++toolId), { code: "fixture_script();" }, {}, definition, tui, process.cwd());
  component.updateResult({
    content: [{ type: "text", text: isError ? "failure" : "result" }],
    details: name === "codemode" ? { calls } : undefined,
    isError,
  }, isPartial);
  return component;
}

function plain(lines: readonly string[]) {
  return lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
}

function render(children: Container["children"], width = 160) {
  const container = new Container();
  container.children = children;
  const restore = installTranscriptView(container, {
    enabled: () => true, theme: () => activeTheme, padding: () => 1,
    requestRender: () => {},
    incompatible: (error) => { throw error; },
  });
  try {
    return plain(container.render(width));
  } finally {
    restore();
  }
}

function clickSummary(chat: Container, text: string, overrides: Partial<TuiMouseEvent> = {}) {
  const lines = chat.render(160);
  const y = lines.findIndex((line) => plain([line]).includes(text));
  assert.ok(y >= 0, `Missing summary: ${text}`);
  return chat.handleMouse({
    type: "click", button: "left", x: 5, y, screenX: 5, screenY: y,
    width: 160, height: lines.length, shift: false, alt: false, ctrl: false,
    ...overrides,
  });
}

test("the six screenshot rows become one 22-call summary", () => {
  const rows: Component[] = [
    [call("bash"), call("read"), call("read")],
    [...Array.from({ length: 4 }, () => call("read")), call("bash")],
    [call("bash", "error"), call("bash"), call("read")],
    Array.from({ length: 7 }, () => call("bash")),
    [call("bash")],
    [call("read"), call("read"), call("bash")],
  ].map((calls) => tool("codemode", calls));
  rows.splice(5, 0, assistant());
  const output = render(rows);
  assert.equal(output.trim(), "● ran 13 commands · read 9 times (1 failed)");
  assert.doesNotMatch(output, /Thinking|reasoning|result|tool calls?|codemode|script/);
});

test("aggregation preserves conversation order and spacing as messages arrive and groups open", () => {
  const chat = new Container();
  chat.children = [
    tool("read"), new Spacer(1), assistant(), new Spacer(1), tool("bash"),
  ];
  const restore = installTranscriptView(chat, {
    enabled: () => true, theme: () => activeTheme, padding: () => 1,
    requestRender: () => {},
    incompatible: (error) => { throw error; },
  });
  // Remove color and horizontal padding, but retain every rendered row.
  const lines = (component: Component) => plain(component.render(160)).split("\n").map((line) => line.trim());
  const header = ["", "● ran 1 command · read 1 time"];
  try {
    assert.deepEqual(lines(chat), header);

    const steering = new UserMessageComponent("Check the fridge first.");
    const followUp = new UserMessageComponent("What else is there?");
    chat.addChild(assistant());
    // Pi inserts a spacer before each user message, outside its colored padding.
    chat.addChild(new Spacer(1));
    chat.addChild(steering);
    chat.addChild(tool("read"));
    chat.addChild(assistant("Found the inventory.", "thinking", true));
    chat.addChild(tool("edit"));
    chat.addChild(assistant("The cheese is in the fridge."));
    chat.addChild(new Spacer(1));
    chat.addChild(followUp);

    const conversation = [
      "", ...lines(steering),
      "", "● read 1 time",
      ...lines(assistant("Found the inventory.", "", true)),
      "", "● edited 1 time",
      ...lines(assistant("The cheese is in the fridge.", "")),
      "", ...lines(followUp),
    ];
    assert.deepEqual(lines(chat), [...header, ...conversation]);

    assert.ok(clickSummary(chat, "ran 1 command")?.handled);
    assert.deepEqual(lines(chat), [...header, "├─ read", "└─ bash", ...conversation]);

    assert.ok(clickSummary(chat, "ran 1 command")?.handled);
    assert.deepEqual(lines(chat), [...header, ...conversation]);
  } finally {
    restore();
  }
});

test("snapshots count parallel calls with temporary duplicate ids only once per snapshot", () => {
  const component = tool("codemode", [call("read", "running"), call("read", "running")], true);
  assert.match(render([component]), /◌ read 2 times · 2 running/);
  assert.equal(plain(component.render(160)).trim(), "● 2 tool calls · 2 reads (2 running)");
  component.updateResult({ content: [], details: { calls: [call("read"), call("read", "cancelled")] }, isError: false });
  assert.equal(render([component]).trim(), "● read 2 times · 1 cancelled");
  assert.equal(plain(component.render(160)).trim(), "● 2 tool calls · 2 reads (1 cancelled)");
});

test("wrapper failures remain visible without disclosing the execution route", () => {
  const emptyFailure = tool("codemode", [], false, true);
  assert.equal(render([emptyFailure]).trim(), "● (1 failed)");
  assert.equal(plain(emptyFailure.render(160)).trim(), "● 0 tool calls (failed)");
  const failedCalls = tool("codemode", [call("read", "error"), call("edit", "error")], false, true);
  assert.equal(plain(failedCalls.render(160)).trim(), "● 2 tool calls · 1 read · 1 edit (2 failed)");
  assert.equal(render([tool("codemode", [call("read")], false, true)]).trim(),
    "● read 1 time (1 failed)");
  for (const name of ["read", "bash", "powershell"]) {
    assert.equal(render([tool("codemode", [call(name, "error")], false, true)]).trim(),
      render([tool(name, [], false, true)]).trim());
    assert.equal(render([tool("codemode", [call(name)])]).trim(), render([tool(name)]).trim());
  }
});

test("activity wording covers singular and plural counts without a tool-call total", () => {
  const output = render([tool("codemode", [
    call("read"), call("read"), call("bash"), call("powershell"), call("bash"),
    call("edit"), call("write"), call("write"), call("grep"), call("find"), call("ls"), call("lookup"),
  ])]).trim();
  assert.equal(output,
    "● ran 3 commands · read 2 times · edited 1 time · wrote 2 times · searched text 1 time · searched for files 1 time · listed files 1 time · used lookup 1 time");
  assert.equal(render([tool("codemode")]).trim(), "● no operations");
  const active = tool("codemode", [], true);
  assert.equal(render([active]).trim(), "◌ working…");
  assert.equal(plain(active.render(160)).trim(), "● 0 tool calls (running)");
});

test("failures appear last and failed wrappers do not double-count operations", () => {
  const children = [
    tool("bash", [], false, true),
    tool("codemode", [call("read", "cancelled"), call("edit", "error")], false, true),
  ];
  assert.equal(render(children).trim(),
    "● ran 1 command · read 1 time · edited 1 time · 1 cancelled (2 failed)");
  children.push(tool("codemode", [call("write")], false, true));
  assert.equal(render(children).trim(),
    "● ran 1 command · read 1 time · edited 1 time · wrote 1 time · 1 cancelled (3 failed)");
});

test("assistant errors and abort notices survive thinking removal", () => {
  assert.match(render([assistant("", "private reasoning", false, "aborted")]), /Operation aborted/);
  assert.match(render([assistant("", "private reasoning", false, "error")]), /Error:/);
});

test("summary lines fit narrow widths and rerender after a resize", () => {
  const chat = new Container();
  chat.children = [tool("codemode", [call("read"), call("bash")])];
  const restore = installTranscriptView(chat, {
    enabled: () => true, theme: () => activeTheme, padding: () => 1,
    requestRender: () => {},
    incompatible: (error) => { throw error; },
  });
  try {
    for (const width of [0, 1, 5, 20, 80]) {
      assert.ok(chat.render(width).every((line) => visibleWidth(line) <= width));
    }
  } finally {
    restore();
  }
  assert.match(render([tool("read")], 80), /read 1 time/);
});

test("clicks reveal groups independently and toggling off restores the original view", () => {
  const chat = new Container();
  const first = tool("read");
  const second = tool("bash");
  first.updateResult({ content: [{ type: "text", text: "READ_OUTPUT" }], isError: false });
  second.updateResult({ content: [{ type: "text", text: "COMMAND_OUTPUT" }], isError: false });
  const originalChildren = [first, assistant("Answer"), second];
  chat.children = originalChildren;
  const normal = chat.render(160);
  const originalRender = chat.render;
  let enabled = true;
  let repaints = 0;
  const restore = installTranscriptView(chat, {
    enabled: () => enabled,
    theme: () => activeTheme,
    padding: () => 1,
    requestRender: () => { repaints++; },
    incompatible: (error) => { throw error; },
  });
  const grouped = chat.render(160).join("\n");
  assert.match(grouped, /read 1 time/);
  assert.doesNotMatch(grouped, /Thinking|READ_OUTPUT|COMMAND_OUTPUT/);

  assert.equal(clickSummary(chat, "read 1 time", { type: "drag" }), undefined);
  assert.equal(clickSummary(chat, "read 1 time", { button: "right" }), undefined);
  assert.equal(clickSummary(chat, "read 1 time", { y: 0 }), undefined);
  assert.equal(repaints, 0);
  assert.ok(clickSummary(chat, "read 1 time")?.handled);
  assert.equal(repaints, 1);
  const firstOpen = chat.render(160).join("\n");
  assert.match(plain(chat.render(160)), /read 1 time[\s\S]*└─ read/);
  assert.doesNotMatch(firstOpen, /Thinking|READ_OUTPUT|COMMAND_OUTPUT/);

  assert.ok(clickSummary(chat, "ran 1 command")?.handled);
  assert.match(plain(chat.render(160)), /└─ read[\s\S]*└─ bash/);
  assert.ok(clickSummary(chat, "read 1 time")?.handled);
  const firstClosed = chat.render(160).join("\n");
  assert.doesNotMatch(firstClosed, /READ_OUTPUT|Thinking/);
  assert.doesNotMatch(plain(chat.render(160)), /└─ read/);
  assert.match(plain(chat.render(160)), /└─ bash/);
  assert.equal(chat.children, originalChildren);

  enabled = false;
  assert.deepEqual(chat.render(160), normal);
  restore();
  assert.equal(chat.render, originalRender);
});

test("render failure always restores the original child arrays", () => {
  const chat = new Container();
  const reply = assistant("Answer");
  const originalChildren = [tool("read"), reply];
  chat.children = originalChildren;
  const originalReply = reply.render(160);
  const originalRender = reply.render;
  reply.render = () => { throw new Error("renderer failed"); };
  const restore = installTranscriptView(chat, {
    enabled: () => true, theme: () => activeTheme, padding: () => 1,
    requestRender: () => {},
    incompatible: (error) => { throw error; },
  });
  assert.throws(() => chat.render(160), /renderer failed/);
  assert.equal(chat.children, originalChildren);
  reply.render = originalRender;
  assert.deepEqual(reply.render(160), originalReply);
  restore();
});

test("incompatible codemode details fail visibly and retain normal rendering", () => {
  for (const details of [
    null,
    {},
    { calls: "changed" },
    { calls: [null] },
    { calls: [{ name: 42, status: "ok" }] },
    { calls: [{ name: "read", status: "changed" }] },
  ]) {
    const chat = new Container();
    const component = tool("codemode");
    component.updateResult({ content: [{ type: "text", text: "original output" }], details, isError: false });
    chat.addChild(component);
    const normal = chat.render(160);
    let reported = false;
    const restore = installTranscriptView(chat, {
      enabled: () => true, theme: () => activeTheme, padding: () => 1,
      requestRender: () => {},
      incompatible: (error) => { reported = error instanceof ViewShapeError; },
    });
    assert.deepEqual(chat.render(160), normal);
    assert.ok(reported);
    restore();
  }
});

test("Pi's global detail expansion changes only what revealed groups display", () => {
  function detailTool(name: string) {
    const component = new ToolExecutionComponent(name, String(++toolId), {}, {}, {
      renderCall: () => new Text(`${name} row`, 0, 0),
      renderResult: (_result: unknown, options: { expanded: boolean }) =>
        new Text(options.expanded ? `${name} FULL_DETAILS` : `${name} MINIMAL`, 0, 0),
    }, tui, process.cwd());
    component.updateResult({ content: [], isError: false });
    return component;
  }
  const first = detailTool("read");
  const second = detailTool("bash");
  const chat = new Container();
  chat.children = [first, assistant("Answer"), second];
  const restore = installTranscriptView(chat, {
    enabled: () => true, theme: () => activeTheme, padding: () => 1,
    requestRender: () => {},
    incompatible: (error) => { throw error; },
  });
  clickSummary(chat, "read 1 time");
  assert.match(chat.render(160).join("\n"), /read MINIMAL/);
  assert.doesNotMatch(chat.render(160).join("\n"), /FULL_DETAILS|bash MINIMAL/);

  // Pi's unchanged Ctrl+O action calls setExpanded() on all the original tool rows.
  first.setExpanded(true);
  second.setExpanded(true);
  const expanded = chat.render(160).join("\n");
  assert.match(expanded, /read FULL_DETAILS/);
  assert.doesNotMatch(expanded, /bash FULL_DETAILS/);

  clickSummary(chat, "ran 1 command");
  assert.match(chat.render(160).join("\n"), /read FULL_DETAILS[\s\S]*bash FULL_DETAILS/);
  clickSummary(chat, "read 1 time");
  assert.doesNotMatch(chat.render(160).join("\n"), /read FULL_DETAILS/);
  first.setExpanded(false);
  second.setExpanded(false);
  assert.match(chat.render(160).join("\n"), /bash MINIMAL/);
  assert.doesNotMatch(chat.render(160).join("\n"), /FULL_DETAILS|read MINIMAL/);
  restore();
});

test("revealed groups stay open while snapshots and consecutive tool rows arrive", () => {
  const first = tool("codemode", [call("read", "running")], true);
  const chat = new Container();
  chat.addChild(first);
  const restore = installTranscriptView(chat, {
    enabled: () => true, theme: () => activeTheme, padding: () => 1,
    requestRender: () => {},
    incompatible: (error) => { throw error; },
  });
  clickSummary(chat, "read 1 time");
  first.updateResult({
    content: [{ type: "text", text: "COMPLETED_READ" }],
    details: { calls: [call("read")] }, isError: false,
  });
  chat.addChild(assistant());
  const next = tool("bash");
  next.updateResult({ content: [{ type: "text", text: "NEXT_COMMAND" }], isError: false });
  chat.addChild(next);
  const continued = chat.render(160).join("\n");
  assert.match(continued, /ran 1 command · read 1 time/);
  assert.match(plain(chat.render(160)), /├─ 1 tool call · 1 read[\s\S]*└─ bash/);
  assert.doesNotMatch(continued, /Thinking|COMPLETED_READ|NEXT_COMMAND/);
  first.setExpanded(true);
  next.setExpanded(true);
  assert.match(chat.render(160).join("\n"), /COMPLETED_READ[\s\S]*NEXT_COMMAND/);

  chat.addChild(assistant("New finding"));
  const newGroup = tool("read");
  newGroup.updateResult({ content: [{ type: "text", text: "NEXT_GROUP" }], isError: false });
  chat.addChild(newGroup);
  assert.doesNotMatch(chat.render(160).join("\n"), /NEXT_GROUP/);
  clickSummary(chat, "ran 1 command");
  assert.doesNotMatch(chat.render(160).join("\n"), /COMPLETED_READ|NEXT_COMMAND|NEXT_GROUP/);
  restore();
});

test("revealed groups contain one original minimal row per block without child dots", () => {
  const first = tool("codemode", [
    call("bash", "ok", { command: "npm test" }),
    call("read", "ok", { path: "src/a.ts" }),
  ]);
  const last = tool("codemode", [call("edit", "error", { path: "src/a.ts" })], false, true);
  const chat = new Container();
  chat.children = [first, assistant(), last];
  const restore = installTranscriptView(chat, {
    enabled: () => true, theme: () => activeTheme, padding: () => 1,
    requestRender: () => {},
    incompatible: (error) => { throw error; },
  });
  clickSummary(chat, "ran 1 command");
  const collapsed = plain(chat.render(160));
  assert.equal(collapsed.trim(),
    "● ran 1 command · read 1 time · edited 1 time (1 failed)\n ├─ 2 tool calls · 1 command · 1 read\n └─ 1 tool call · 1 edit (1 failed)");
  assert.equal((collapsed.match(/●/g) ?? []).length, 1);
  assert.doesNotMatch(collapsed, /npm test|src\/a.ts|Thinking|fixture_script/);
  first.setExpanded(true);
  last.setExpanded(true);
  const expanded = chat.render(160);
  assert.match(plain(expanded), /fixture_script/);
  assert.equal((plain(expanded).match(/●/g) ?? []).length, 1);
  assert.ok(expanded.some((line) => line.includes("\x1b[48;")));
  for (const width of [0, 1, 3, 6, 20, 80]) {
    assert.ok(chat.render(width).every((line) => visibleWidth(line) <= width));
  }
  restore();
});

test("clicking a child row preserves native expansion, styling and mouse coordinates", () => {
  const definition = minimalTool(createReadToolDefinition(process.cwd()), {
    call: (args) => `read ${args.path}`,
    result: (args) => `read ${args.path}`,
    callBody: false,
  });
  const component = new ToolExecutionComponent("read", String(++toolId), { path: "src/a.ts" }, {},
    definition, tui, process.cwd());
  component.updateResult({ content: [{ type: "text", text: "const cheese = true;" }], isError: false });
  const chat = new Container();
  chat.addChild(component);
  let enabled = true;
  const restore = installTranscriptView(chat, {
    enabled: () => enabled, theme: () => activeTheme, padding: () => 1,
    requestRender: () => {},
    incompatible: (error) => { throw error; },
  });
  clickSummary(chat, "read 1 time");
  assert.equal(plain(chat.render(160)).trim(), "● read 1 time\n └─ read src/a.ts");
  assert.ok(clickSummary(chat, "read src/a.ts")?.handled);
  const expanded = chat.render(160);
  assert.match(plain(expanded), /const cheese = true;/);
  assert.equal((plain(expanded).match(/●/g) ?? []).length, 1);
  assert.ok(expanded.some((line) => line.includes("\x1b[48;")));
  assert.ok(clickSummary(chat, "read src/a.ts")?.handled);
  assert.doesNotMatch(plain(chat.render(160)), /const cheese/);

  enabled = false;
  assert.equal(plain(chat.render(160)).trim(), "● read src/a.ts");
  enabled = true;
  assert.equal(plain(chat.render(160)).trim(), "● read 1 time\n └─ read src/a.ts");
  restore();
});

test("clicking one block expands only that block and global expansion still affects hidden blocks", () => {
  const first = tool("codemode", [call("read")]);
  const second = tool("codemode", [call("bash"), call("bash")]);
  const hidden = tool("codemode", [call("edit")]);
  const chat = new Container();
  chat.children = [first, second, assistant("Finding"), hidden];
  const restore = installTranscriptView(chat, {
    enabled: () => true, theme: () => activeTheme, padding: () => 1,
    requestRender: () => {},
    incompatible: (error) => { throw error; },
  });
  clickSummary(chat, "ran 2 commands");
  assert.ok(clickSummary(chat, "1 tool call · 1 read")?.handled);
  assert.equal((plain(chat.render(160)).match(/fixture_script/g) ?? []).length, 1);
  assert.ok(clickSummary(chat, "1 tool call · 1 read")?.handled);
  assert.doesNotMatch(plain(chat.render(160)), /fixture_script/);

  for (const component of [first, second, hidden]) component.setExpanded(true);
  assert.equal((plain(chat.render(160)).match(/fixture_script/g) ?? []).length, 2);
  clickSummary(chat, "edited 1 time");
  assert.equal((plain(chat.render(160)).match(/fixture_script/g) ?? []).length, 3);
  clickSummary(chat, "ran 2 commands");
  assert.equal((plain(chat.render(160)).match(/fixture_script/g) ?? []).length, 1);
  restore();
});

test("chat discovery follows the mounted document rather than any nested container", () => {
  const chat = new Container();
  const document = new Container();
  document.addChild(new Container());
  document.addChild(chat);
  assert.equal(findChat({ children: [document, new Container()] }), chat);
  assert.throws(() => findChat({ children: [] }), ViewShapeError);
});
