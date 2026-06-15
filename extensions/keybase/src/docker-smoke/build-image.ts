import { execFile } from "node:child_process";
import path from "node:path";
import {
  DEFAULT_BASE_IMAGE_NAME,
  DEFAULT_IMAGE_NAME,
  DEFAULT_PLATFORM,
  type RunCommand,
  type RunCommandResult,
} from "./scaffold.js";

export interface KeybaseDockerSmokeImageResult {
  baseImageName: string;
  imageName: string;
  platform: string;
}

export async function defaultRunCommand(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<RunCommandResult> {
  return await new Promise<RunCommandResult>((resolve, reject) => {
    execFile(
      command,
      [...args],
      {
        cwd,
        encoding: "utf8",
        env:
          command === "docker"
            ? {
                ...process.env,
                DOCKER_BUILDKIT: process.env.DOCKER_BUILDKIT?.trim() || "1",
              }
            : process.env,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

export async function buildKeybaseDockerSmokeImage(
  params: {
    baseImageName?: string;
    imageName?: string;
    platform?: string;
    repoRoot: string;
  },
  deps: {
    runCommand?: RunCommand;
  } = {},
): Promise<KeybaseDockerSmokeImageResult> {
  const repoRoot = path.resolve(params.repoRoot);
  const baseImageName = params.baseImageName ?? DEFAULT_BASE_IMAGE_NAME;
  const imageName = params.imageName ?? DEFAULT_IMAGE_NAME;
  const platform = params.platform ?? DEFAULT_PLATFORM;
  const runCommand = deps.runCommand ?? defaultRunCommand;

  await runCommand(
    "docker",
    [
      "build",
      "--platform",
      platform,
      "-t",
      baseImageName,
      "--build-arg",
      "OPENCLAW_EXTENSIONS=keybase",
      "-f",
      "Dockerfile",
      ".",
    ],
    repoRoot,
  );

  await runCommand(
    "docker",
    [
      "build",
      "--platform",
      platform,
      "-t",
      imageName,
      "--build-arg",
      `OPENCLAW_BASE_IMAGE=${baseImageName}`,
      "-f",
      "extensions/keybase/docker/Dockerfile",
      ".",
    ],
    repoRoot,
  );

  return {
    baseImageName,
    imageName,
    platform,
  };
}
