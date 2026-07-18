import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildCodexHooksConfig,
  getCodexHooksPath,
  hasOctogentCodexHooks,
  installCodexHooksInDirectory,
} from "../src/terminalRuntime/codexHooks";

describe("Codex hook config", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories) {
      rmSync(directory, { recursive: true, force: true });
    }
    temporaryDirectories.length = 0;
  });

  const createTemporaryDirectory = () => {
    const directory = mkdtempSync(join(tmpdir(), "octogent-codex-hooks-test-"));
    temporaryDirectories.push(directory);
    return directory;
  };

  it("builds Octogent lifecycle hooks for Codex events", () => {
    const config = buildCodexHooksConfig("http://127.0.0.1:8787");

    expect(Object.keys(config)).toEqual([
      "SessionStart",
      "UserPromptSubmit",
      "PreToolUse",
      "PermissionRequest",
      "PostToolUse",
      "Stop",
    ]);
    expect(config.PermissionRequest[0]?.hooks[0]?.command).toContain(
      "/api/hooks/permission-request",
    );
    expect(config.PostToolUse[0]?.hooks[0]?.command).toContain("/api/code-intel/events");
    expect(config.PostToolUse[0]?.hooks[0]?.command).toContain("X-Octogent-Session");
  });

  it("installs project hooks.json and detects it later", () => {
    const workspaceCwd = createTemporaryDirectory();

    installCodexHooksInDirectory(workspaceCwd, "http://127.0.0.1:8787");

    const hooksPath = getCodexHooksPath(workspaceCwd);
    expect(existsSync(hooksPath)).toBe(true);
    expect(hasOctogentCodexHooks(workspaceCwd)).toBe(true);

    const hooksConfig = JSON.parse(readFileSync(hooksPath, "utf8")) as Record<string, unknown>;
    expect(hooksConfig.SessionStart).toBeDefined();
    expect(hooksConfig.Stop).toBeDefined();
  });
});
