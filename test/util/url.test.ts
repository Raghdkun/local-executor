import { describe, expect, it } from "vitest";
import { normalizeUrl } from "../../src/util/url.js";

describe("normalizeUrl", () => {
  it("adds a scheme, strips trailing slashes, and maps 0.0.0.0 to localhost", () => {
    expect(normalizeUrl("0.0.0.0:11434")).toBe("http://localhost:11434");
    expect(normalizeUrl("http://localhost:11434/")).toBe("http://localhost:11434");
    expect(normalizeUrl(" https://gpu-box:11434 ")).toBe("https://gpu-box:11434");
    expect(normalizeUrl("127.0.0.1:11434")).toBe("http://127.0.0.1:11434");
  });
});
