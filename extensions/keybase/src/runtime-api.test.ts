import { describe, expect, it } from "vitest";

describe("keybase qa runtime api surface", () => {
  it("keeps runner discovery lightweight", async () => {
    const runtimeApi = await import("../runtime-api.js");

    expect(Object.keys(runtimeApi).toSorted()).toEqual(["qaRunnerCliRegistrations"]);
  });
});
