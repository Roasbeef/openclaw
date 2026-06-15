import { describe, expect, it } from "vitest";
import { buildKeybaseApprovalPendingMessages } from "./approval-handler.runtime.js";

describe("keybase approval handler runtime", () => {
  it("keeps short native approval prompts in a single message", () => {
    expect(
      buildKeybaseApprovalPendingMessages({
        text: "React with :white_check_mark: to approve.",
      }),
    ).toEqual({
      promptText: "React with :white_check_mark: to approve.",
    });
  });

  it("bounds the reaction-bearing approval prompt and preserves chunkable details", () => {
    const text = `React with :white_check_mark: to approve.\n\n${"x".repeat(5_000)}`;
    const result = buildKeybaseApprovalPendingMessages({
      limit: 1_024,
      text,
    });

    expect(result.promptText.length).toBeLessThanOrEqual(1_024);
    expect(result.promptText).toContain("React with :white_check_mark:");
    expect(result.promptText).toContain("full details follow");
    expect(result.detailText).toBe(text);
  });

  // M-7(b): truncating with `String.prototype.slice` on UTF-16 units can
  // split a non-BMP emoji surrogate pair, producing a lone surrogate that
  // breaks strict JSON parsers downstream. The code-point-aware truncation
  // must keep every surrogate pair intact even when a non-BMP code point
  // straddles the cut.
  it("does not split astral-plane surrogate pairs at the truncation boundary", () => {
    // Build a text that comfortably exceeds the 512-unit minimum limit and
    // that has a non-BMP emoji straddling the truncation cut. U+1F4A9 is 2
    // UTF-16 code units / 1 code point. With limit=MIN, headLimit=MIN-NOTICE
    // measured in code points; a naive UTF-16 .slice(headLimit) on a body
    // that is mostly emoji would land mid-surrogate.
    const padding = "x".repeat(100);
    const text = `${padding}${"\u{1F4A9}".repeat(MIN)}`;
    const result = buildKeybaseApprovalPendingMessages({
      limit: MIN,
      text,
    });

    // Full text must have triggered truncation (was the point of the test).
    expect(result.detailText).toBe(text);
    expect(result.promptText.length).toBeLessThanOrEqual(MIN);

    // No lone high or low surrogate may remain in the prompt text. A clean
    // string round-trips through `Array.from` -> join unchanged.
    const codePoints = Array.from(result.promptText);
    expect(codePoints.join("")).toBe(result.promptText);
    for (const ch of result.promptText) {
      const code = ch.codePointAt(0) ?? 0;
      expect(code >= 0xd800 && code <= 0xdfff).toBe(false);
    }
  });
});

const MIN = 512;
