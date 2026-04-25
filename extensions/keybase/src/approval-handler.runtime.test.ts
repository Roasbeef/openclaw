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
});
