import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { keybaseQaCliRegistration } from "./qa-cli.js";

describe("keybase qa cli registration", () => {
  it("registers the keybase qa command without loading the runtime", () => {
    const qa = new Command("qa");

    keybaseQaCliRegistration.register(qa);

    expect(keybaseQaCliRegistration.commandName).toBe("keybase");
    expect(qa.commands.map((command) => command.name())).toEqual(["keybase"]);
    expect(qa.commands[0]?.description()).toContain("Keybase live QA lane");
  });
});
