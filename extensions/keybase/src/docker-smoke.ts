// Thin re-export shim for the public docker-smoke surface.
// The implementation lives under ./docker-smoke/ — this file preserves the
// original import path for consumers (CLI scripts, tests) that import from
// "extensions/keybase/src/docker-smoke.js".

export {
  type KeybaseDockerSmokeFilesResult,
  type RunCommand,
  type RunCommandResult,
  resolveDefaultKeybaseDockerOutputDir,
  writeKeybaseDockerSmokeFiles,
} from "./docker-smoke/scaffold.js";

export {
  type KeybaseDockerSmokeImageResult,
  buildKeybaseDockerSmokeImage,
} from "./docker-smoke/build-image.js";

export {
  type KeybaseDockerBlackboxResult,
  type KeybaseDockerBlackboxScenarioId,
  type KeybaseDockerBlackboxScenarioResult,
  type KeybaseDockerBlackboxSuiteResult,
  normalizeKeybaseBlackboxScenarioIds,
  renderKeybaseBlackboxSummary,
  runKeybaseDockerBlackboxSmoke,
  runKeybaseDockerBlackboxSuite,
} from "./docker-smoke/suite.js";
