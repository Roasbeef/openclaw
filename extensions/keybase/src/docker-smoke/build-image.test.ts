import { describe, expect, it } from "vitest";
import { buildKeybaseDockerSmokeImage } from "./build-image.js";

describe("buildKeybaseDockerSmokeImage", () => {
  it("builds the base openclaw image and the keybase overlay image", async () => {
    const calls: string[] = [];
    const result = await buildKeybaseDockerSmokeImage(
      {
        baseImageName: "openclaw:keybase-base",
        imageName: "openclaw:keybase-test",
        platform: "linux/amd64",
        repoRoot: "/repo/openclaw",
      },
      {
        async runCommand(command, args, cwd) {
          calls.push([command, ...args, `@${cwd}`].join(" "));
          return { stderr: "", stdout: "" };
        },
      },
    );

    expect(result).toEqual({
      baseImageName: "openclaw:keybase-base",
      imageName: "openclaw:keybase-test",
      platform: "linux/amd64",
    });
    expect(calls).toEqual([
      expect.stringContaining(
        "docker build --platform linux/amd64 -t openclaw:keybase-base --build-arg OPENCLAW_EXTENSIONS=keybase -f Dockerfile . @/repo/openclaw",
      ),
      expect.stringContaining(
        "docker build --platform linux/amd64 -t openclaw:keybase-test --build-arg OPENCLAW_BASE_IMAGE=openclaw:keybase-base -f extensions/keybase/docker/Dockerfile . @/repo/openclaw",
      ),
    ]);
  });
});
