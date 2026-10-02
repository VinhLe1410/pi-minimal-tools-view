import type { Theme } from "@earendil-works/pi-coding-agent";
import { Container, truncateToWidth, type Component, type TuiMouseEvent } from "@earendil-works/pi-tui";

class TreeRow implements Component {
  private contentWidth = 0;
  private contentHeight = 0;
  private skipped = 0;
  private offsetX = 0;

  constructor(
    private readonly tool: Component,
    private readonly last: boolean,
    private readonly theme: Theme,
    private readonly padding: number,
  ) {}

  render(width: number): string[] {
    const inset = Math.min(this.padding, Math.max(0, width));
    this.offsetX = inset + 3;
    this.contentWidth = Math.max(0, width - this.offsetX);
    const source = this.tool.render(this.contentWidth);
    this.contentHeight = source.length;
    this.skipped = 0;
    // Pi adds a leading spacer to each tool. The aggregate already separates this list.
    while (source[this.skipped] === "") this.skipped++;
    const indent = " ".repeat(inset);
    const available = Math.max(0, width - inset);
    return source.slice(this.skipped).map((line, index) => {
      const branch = index === 0 ? this.last ? "└─ " : "├─ " : this.last ? "   " : "│  ";
      return indent + truncateToWidth(this.theme.fg("borderMuted", branch) + line, available);
    });
  }

  handleMouse(event: TuiMouseEvent) {
    if (event.x < this.offsetX) return undefined;
    return this.tool.handleMouse?.({
      ...event,
      x: event.x - this.offsetX,
      y: event.y + this.skipped,
      width: this.contentWidth,
      height: this.contentHeight,
    });
  }

  invalidate() {
    this.tool.invalidate();
  }
}

export function minimalTree(tools: readonly Component[], theme: Theme, padding: number): Component {
  const tree = new Container();
  for (const [index, tool] of tools.entries()) {
    tree.addChild(new TreeRow(tool, index === tools.length - 1, theme, padding));
  }
  return tree;
}
