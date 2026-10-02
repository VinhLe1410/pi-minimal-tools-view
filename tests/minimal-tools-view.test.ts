import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import minimalToolsView from "../index.ts";
import {
  AssistantMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
  createBashToolDefinition,
  createCodemodeExtension,
  createEditToolDefinition,
  createPowerShellToolDefinition,
  createReadToolDefinition,
  DefaultResourceLoader,
  SettingsManager,
  getMarkdownTheme,
  initTheme,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Container, MouseRegion, ProcessTerminal, Spacer, Text, TuiMainScreen, stripTerminalSequences, visibleWidth, type Component, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { findChat, installTranscriptView, ViewShapeError } from "../transcript.ts";

initTheme("dark");
const tui = new TuiMainScreen(new ProcessTerminal());
let renderTheme: Theme | undefined;
// Obtain the host's renderer theme without importing private modules.
new ToolExecutionComponent("capture", "capture", {}, {}, {
  renderCall(_args: unknown, theme: Theme) {
    renderTheme = theme;
    return new Text("", 0, 0);
  },
}, tui, process.cwd());
if (!renderTheme) throw new Error("Expected Pi's tool renderer theme");
const activeTheme = renderTheme;
const addonEvents: TuiMouseEvent[] = [];

const extensions = await (async () => {
  const directory = mkdtempSync(join(tmpdir(), "minimal-tools-view-"));
  try {
    const loader = new DefaultResourceLoader({
      cwd: directory,
      agentDir: directory,
      settingsManager: SettingsManager.inMemory(),
      extensionFactories: [
        minimalToolsView,
        createCodemodeExtension(),
        (pi) => pi.registerTool({
          ...createReadToolDefinition(directory),
          name: "lookup",
          renderShell: "self",
          renderCall: () => new Text("lookup", 0, 0),
          renderResult: (_result, options, theme) => new MouseRegion(
            new Text(theme.fg("accent", options.expanded ? "LOOKUP_DETAILS" : "LOOKUP_PREVIEW"), 0, 0),
            (event) => {
              addonEvents.push(event);
              return { handled: true };
            },
          ),
        }),
      ],
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await loader.reload();
    const result = loader.getExtensions();
    assert.deepEqual(result.errors, []);
    return result.extensions;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
})();

const definitions = [
  createReadToolDefinition(process.cwd()),
  createBashToolDefinition(process.cwd()),
  createPowerShellToolDefinition(process.cwd()),
  createEditToolDefinition(process.cwd()),
  ...extensions.flatMap((extension) => [...extension.tools.values()].map((tool) => tool.definition)),
];

function assistant(text = "", thinking = "private reasoning", toolCall = false, stopReason = "stop") {
  return new AssistantMessageComponent({
    role: "assistant",
    content: [
      { type: "thinking", thinking },
      ...(text ? [{ type: "text" as const, text }] : []),
      ...(toolCall ? [{ type: "toolCall" as const, id: "call", name: "codemode", arguments: { code: "" } }] : []),
    ],
    api: "openai-responses", provider: "openai", model: "test",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: stopReason === "aborted" ? "aborted" : stopReason === "error" ? "error" : "stop",
    timestamp: 0,
  }, true, getMarkdownTheme());
}

function call(name: string, status = "ok") {
  return { name, status, id: "same-temporary-id", args: "{}" };
}

let toolId = 0;
function tool(name: string, calls: ReturnType<typeof call>[] = [], isPartial = false, isError = false) {
  const definition = definitions.find((tool) => tool.name === name);
  const component = new ToolExecutionComponent(name, String(++toolId), {
    path: "src/a.ts", command: "echo fixture", code: "fixture_script();",
  }, {}, definition, tui, process.cwd());
  component.updateResult({
    content: [{ type: "text", text: isError ? "failure" : "result" }],
    details: name === "codemode" ? { calls } : undefined,
    isError,
  }, isPartial);
  return component;
}

function plain(lines: readonly string[]) {
  return stripTerminalSequences(lines.join("\n"));
}

function attach(chat: Container, options: Partial<Parameters<typeof installTranscriptView>[1]> = {}) {
  return installTranscriptView(chat, {
    enabled: () => true, theme: () => activeTheme, padding: () => 1,
    requestRender: () => {},
    incompatible: (error) => { throw error; },
    ...options,
  });
}

function render(children: Container["children"]) {
  const chat = new Container();
  chat.children = children;
  const restore = attach(chat);
  try {
    return plain(chat.render(160));
  } finally {
    restore();
  }
}

function clickRow(chat: Component, text: string, overrides: Partial<TuiMouseEvent> = {}) {
  const lines = chat.render(160);
  const y = lines.findIndex((line) => plain([line]).includes(text));
  assert.ok(y >= 0, `Missing row: ${text}`);
  return chat.handleMouse?.({
    type: "click", button: "left", x: 7, y, screenX: 7, screenY: y,
    width: 160, height: lines.length, shift: false, alt: false, ctrl: false,
    ...overrides,
  });
}

// Tree rows replace the host's leading spacer with a branch connector.
function nativeLines(component: Component, width: number) {
  const lines = component.render(width).slice();
  while (lines[0] === "") lines.shift();
  return lines;
}

function assertNativeRows(chat: Container, tools: readonly Component[], width = 160) {
  const actual = chat.render(width).slice(2);
  const expected = tools.flatMap((tool) => nativeLines(tool, width - 4));
  assert.deepEqual(plain(actual).split("\n").map((line) => line.slice(4)), plain(expected).split("\n"));
  // Native ANSI styling remains intact after the tree prefix.
  assert.ok(actual.every((line, index) => line.endsWith(expected[index])));
}

test("the view registers no tools and coexists with host codemode and addons", () => {
  const [view, codemode, addon] = extensions;
  assert.ok(view && codemode && addon);
  assert.equal(view.tools.size, 0);
  assert.ok(view.commands.has("minimal-tools-view"));
  assert.deepEqual([...codemode.tools.keys()], ["codemode"]);
  assert.deepEqual([...addon.tools.keys()], ["lookup"]);
});

test("consecutive codemode snapshots become one aggregate without exposing their contents", () => {
  const rows: Component[] = [
    [call("bash"), call("read"), call("read")],
    [...Array.from({ length: 4 }, () => call("read")), call("bash")],
    [call("bash", "error"), call("bash"), call("read")],
    Array.from({ length: 7 }, () => call("bash")),
    [call("bash")],
    [call("read"), call("read"), call("bash")],
  ].map((calls) => tool("codemode", calls));
  rows.splice(5, 0, assistant());
  assert.equal(render(rows).trim(), "● ran 13 commands · read 9 times (1 failed)");
});

test("aggregation preserves conversation order and spacing as messages arrive and groups open", () => {
  const first = [tool("read"), tool("bash")];
  const chat = new Container();
  chat.children = [first[0], new Spacer(1), assistant(), new Spacer(1), first[1]];
  const restore = attach(chat);
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
    assert.ok(clickRow(chat, "ran 1 command")?.handled);
    const revealed = lines(chat);
    assert.deepEqual(revealed.slice(0, header.length), header);
    assert.deepEqual(revealed.slice(-conversation.length), conversation);
    assert.equal(revealed.length, header.length + conversation.length +
      first.reduce((height, tool) => height + nativeLines(tool, 156).length, 0));
    assert.ok(clickRow(chat, "ran 1 command")?.handled);
    assert.deepEqual(lines(chat), [...header, ...conversation]);
  } finally {
    restore();
  }
});

test("activity counts track snapshots, cancellation, and failures without double-counting wrappers", () => {
  const component = tool("codemode", [call("read", "running"), call("read", "running")], true);
  assert.equal(render([component]).trim(), "◌ read 2 times · 2 running");
  component.updateResult({
    content: [], details: { calls: [call("read"), call("read", "cancelled")] }, isError: false,
  });
  assert.equal(render([component]).trim(), "● read 2 times · 1 cancelled");
  const children = [
    tool("bash", [], false, true),
    tool("codemode", [call("read", "cancelled"), call("edit", "error")], false, true),
    tool("codemode", [call("write")], false, true),
    tool("codemode", [], false, true),
  ];
  assert.equal(render(children).trim(),
    "● ran 1 command · read 1 time · edited 1 time · wrote 1 time · 1 cancelled (4 failed)");
  for (const name of ["read", "bash", "powershell", "lookup"]) {
    assert.equal(render([tool("codemode", [call(name, "error")], false, true)]).trim(),
      render([tool(name, [], false, true)]).trim());
  }
});

test("activity wording covers builtins, addon invocations, and empty or active codemode", () => {
  const output = render([
    tool("codemode", [
      call("read"), call("read"), call("bash"), call("powershell"), call("bash"),
      call("edit"), call("write"), call("write"), call("grep"), call("find"), call("ls"),
    ]),
    tool("lookup"), tool("lookup"),
  ]).trim();
  assert.equal(output,
    "● ran 3 commands · read 2 times · edited 1 time · wrote 2 times · searched text 1 time · searched for files 1 time · listed files 1 time · used lookup 2 times");
  assert.equal(render([tool("codemode")]).trim(), "● no operations");
  assert.equal(render([tool("codemode", [], true)]).trim(), "◌ working…");
});

test("assistant errors and abort notices survive thinking removal", () => {
  assert.match(render([assistant("", "private reasoning", false, "aborted")]), /Operation aborted/);
  assert.match(render([assistant("", "private reasoning", false, "error")]), /Error:/);
});

test("revealing mixed tools preserves native rendering, expansion, styling, and width", () => {
  const tools = [tool("read"), tool("bash"), tool("codemode", [call("read")]), tool("lookup"), tool("unknown")];
  const chat = new Container();
  chat.children = tools;
  const original = chat.render(160);
  let enabled = true;
  const restore = attach(chat, { enabled: () => enabled });
  try {
    for (const width of [0, 1, 3, 6, 20, 80, 160]) {
      assert.ok(chat.render(width).every((line) => visibleWidth(line) <= width));
    }
    assert.ok(clickRow(chat, "ran 1 command")?.handled);
    assertNativeRows(chat, tools);
    for (const expanded of [true, false]) {
      for (const tool of tools) tool.setExpanded(expanded);
      for (const width of [0, 1, 3, 6, 20, 80, 160]) {
        assert.ok(chat.render(width).every((line) => visibleWidth(line) <= width));
      }
      assertNativeRows(chat, tools);
    }
    enabled = false;
    assert.deepEqual(chat.render(160), original);
  } finally {
    restore();
  }
});

test("native and addon mouse interactions survive tree indentation and leading-space removal", () => {
  const read = tool("read");
  const addon = tool("lookup");
  read.updateResult({ content: [{ type: "text", text: "const cheese = true;" }], isError: false });
  const chat = new Container();
  chat.children = [read, addon];
  const restore = attach(chat);
  try {
    clickRow(chat, "read 1 time");
    assert.doesNotMatch(plain(chat.render(160)), /const cheese/);
    assert.ok(clickRow(chat, "read src/a.ts")?.handled);
    assert.match(plain(chat.render(160)), /const cheese/);
    assertNativeRows(chat, [read, addon]);
    assert.ok(clickRow(chat, "read src/a.ts")?.handled);
    assert.doesNotMatch(plain(chat.render(160)), /const cheese/);

    addonEvents.length = 0;
    assert.equal(clickRow(chat, "LOOKUP_PREVIEW", { x: 1 }), undefined);
    assert.equal(addonEvents.length, 0);
    assert.ok(clickRow(chat, "LOOKUP_PREVIEW")?.handled);
    const event = addonEvents[0];
    assert.ok(event);
    assert.deepEqual({ x: event.x, y: event.y, width: event.width, height: event.height },
      { x: 3, y: 0, width: 156, height: 1 });
    assert.equal(event.screenX, 7);
    assert.equal(event.screenY, chat.render(160).findIndex((line) => plain([line]).includes("LOOKUP_PREVIEW")));
    // The addon's handled click must not become the host's expansion click.
    assert.match(plain(chat.render(160)), /LOOKUP_PREVIEW/);
    assert.doesNotMatch(plain(chat.render(160)), /LOOKUP_DETAILS/);
  } finally {
    restore();
  }
});

test("revealed groups follow streaming updates while other groups and expanded details stay hidden", () => {
  const first = tool("codemode", [call("read", "running")], true);
  const chat = new Container();
  chat.addChild(first);
  const originalRender = chat.render;
  let enabled = true;
  let repaints = 0;
  const restore = attach(chat, {
    enabled: () => enabled,
    requestRender: () => { repaints++; },
  });
  try {
    assert.equal(clickRow(chat, "read 1 time", { type: "drag" }), undefined);
    assert.equal(clickRow(chat, "read 1 time", { button: "right" }), undefined);
    assert.equal(clickRow(chat, "read 1 time", { y: 0 }), undefined);
    assert.equal(repaints, 0);
    assert.ok(clickRow(chat, "read 1 time")?.handled);
    assert.equal(repaints, 1);
    first.updateResult({
      content: [{ type: "text", text: "COMPLETED_READ" }],
      details: { calls: [call("read")] }, isError: false,
    });
    chat.addChild(assistant());
    const next = tool("bash");
    chat.addChild(next);
    assert.match(plain(chat.render(160)), /ran 1 command · read 1 time/);
    assertNativeRows(chat, [first, next]);

    chat.addChild(assistant("New finding"));
    const hidden = tool("lookup");
    chat.addChild(hidden);
    // Pi's Ctrl+O updates the original rows, including hidden ones.
    for (const component of [first, next, hidden]) component.setExpanded(true);
    assert.match(plain(chat.render(160)), /COMPLETED_READ/);
    assert.doesNotMatch(plain(chat.render(160)), /LOOKUP_DETAILS/);
    clickRow(chat, "used lookup");
    assert.match(plain(chat.render(160)), /LOOKUP_DETAILS/);
    clickRow(chat, "ran 1 command");
    assert.doesNotMatch(plain(chat.render(160)), /COMPLETED_READ/);
    assert.match(plain(chat.render(160)), /LOOKUP_DETAILS/);

    enabled = false;
    const normal = chat.render(160);
    assert.match(plain(normal), /COMPLETED_READ/);
    restore();
    assert.equal(chat.render, originalRender);
    assert.deepEqual(chat.render(160), normal);
  } finally {
    restore();
  }
});

test("render failures restore the original transcript and assistant contents", () => {
  const chat = new Container();
  const reply = assistant("Answer");
  const originalChildren = [tool("read"), reply];
  chat.children = originalChildren;
  const originalReply = reply.render(160);
  const originalRender = reply.render;
  reply.render = () => { throw new Error("renderer failed"); };
  const restore = attach(chat);
  try {
    assert.throws(() => chat.render(160), /renderer failed/);
    assert.equal(chat.children, originalChildren);
    reply.render = originalRender;
    assert.deepEqual(reply.render(160), originalReply);
  } finally {
    reply.render = originalRender;
    restore();
  }
});

test("incompatible codemode details fail visibly and retain normal rendering", () => {
  for (const details of [
    null, {}, { calls: "changed" }, { calls: [null] },
    { calls: [{ name: 42, status: "ok" }] },
    { calls: [{ name: "read", status: "changed" }] },
  ]) {
    const chat = new Container();
    const component = tool("codemode");
    component.updateResult({ content: [{ type: "text", text: "original output" }], details, isError: false });
    chat.addChild(component);
    const normal = chat.render(160);
    let reported = false;
    const restore = attach(chat, { incompatible: (error) => { reported = error instanceof ViewShapeError; } });
    try {
      assert.deepEqual(chat.render(160), normal);
      assert.ok(reported);
    } finally {
      restore();
    }
  }
});

test("chat discovery follows the mounted document rather than any nested container", () => {
  const chat = new Container();
  const document = new Container();
  document.addChild(new Container());
  document.addChild(chat);
  assert.equal(findChat({ children: [document, new Container()] }), chat);
  assert.throws(() => findChat({ children: [] }), ViewShapeError);
});
