import { describe, expect, it } from "vitest";
// The runtime is plain ESM JavaScript shipped inside skill/; import its pure helpers directly.
// @ts-expect-error — untyped .mjs module
import { parseBlocks, safeTarget, stripThinking } from "../skill/runtime/run_executor.mjs";

describe("run_executor helpers", () => {
  it("parses blocks with language and path", () => {
    const text =
      "```python path=src/a.py\nprint(1)\n```\n\n```ts path=src/b.ts\nexport const b = 2;\n```";
    const blocks = parseBlocks(text) as { lang: string; path: string; code: string }[];
    expect(blocks).toEqual([
      { lang: "python", path: "src/a.py", code: "print(1)\n" },
      { lang: "ts", path: "src/b.ts", code: "export const b = 2;\n" },
    ]);
  });

  it("tolerates CRLF, missing language, and c# / c++ info strings", () => {
    const text = "```c# path=A.cs\r\nclass A {}\r\n```\r\n``` path=x.txt\nhi\n```";
    const blocks = parseBlocks(text) as { path: string }[];
    expect(blocks.map((b) => b.path)).toEqual(["A.cs", "x.txt"]);
  });

  it("ignores fences without a path", () => {
    expect(parseBlocks("```js\nconsole.log(1)\n```")).toEqual([]);
  });

  it("strips <think> blocks", () => {
    expect(stripThinking("<think>hmm\nmore</think>\n```js path=a.js\n1\n```")).toBe(
      "```js path=a.js\n1\n```",
    );
  });

  it("refuses paths that escape the root", () => {
    const root = "/repo";
    expect(safeTarget(root, "src/a.ts")).toMatch(/[\\/]repo[\\/]src[\\/]a\.ts$/);
    expect(() => safeTarget(root, "../etc/passwd")).toThrow(/outside root/);
    expect(() => safeTarget(root, "/etc/passwd")).toThrow(/absolute/);
    expect(() => safeTarget(root, "C:\\Windows\\x")).toThrow(/absolute/);
    expect(() => safeTarget(root, "src/../../x")).toThrow(/outside root/);
  });
});
