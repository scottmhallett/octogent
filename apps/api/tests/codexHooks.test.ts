import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildCodexHooksConfig,
  getCodexHooksPath,
  hasOctogentCodexHooks,
  installCodexHooksInDirectory,
  mergeCodexHooksConfig,
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

    expect(Object.keys(config.hooks)).toEqual([
      "SessionStart",
      "UserPromptSubmit",
      "PreToolUse",
      "PermissionRequest",
      "PostToolUse",
      "Stop",
    ]);
    expect(config.hooks.PermissionRequest[0]?.hooks[0]?.command).toContain(
      "/api/hooks/permission-request",
    );
    expect(config.hooks.PermissionRequest[0]?.hooks[0]?.command).toContain("-o /dev/null");
    expect(config.hooks.PostToolUse[0]?.hooks[0]?.command).toContain("/api/code-intel/events");
    expect(config.hooks.PostToolUse[0]?.hooks[0]?.command).toContain("X-Octogent-Session");
    expect(config.hooks.PostToolUse[0]?.hooks[0]?.command).toContain("-o /dev/null");
  });

  it("installs project hooks.json and detects it later", () => {
    const workspaceCwd = createTemporaryDirectory();

    installCodexHooksInDirectory(workspaceCwd, "http://127.0.0.1:8787");

    const hooksPath = getCodexHooksPath(workspaceCwd);
    expect(existsSync(hooksPath)).toBe(true);
    expect(hasOctogentCodexHooks(workspaceCwd)).toBe(true);

    const hooksConfig = JSON.parse(readFileSync(hooksPath, "utf8")) as Record<string, unknown>;
    const hooks = hooksConfig.hooks as Record<string, unknown>;
    expect(hooks.SessionStart).toBeDefined();
    expect(hooks.Stop).toBeDefined();
  });

  it("does not detect user-only hook arrays as installed Octogent hooks", () => {
    const workspaceCwd = createTemporaryDirectory();
    mkdirSync(join(workspaceCwd, ".codex"), { recursive: true });
    const hooksPath = getCodexHooksPath(workspaceCwd);
    const userHookEntry = {
      matcher: "*",
      hooks: [{ type: "command", command: "node ./scripts/user-hook.js", timeout: 3 }],
    };

    writeFileSync(
      hooksPath,
      `${JSON.stringify(
        {
          hooks: {
            SessionStart: [userHookEntry],
            UserPromptSubmit: [userHookEntry],
            PreToolUse: [userHookEntry],
            PermissionRequest: [userHookEntry],
            PostToolUse: [userHookEntry],
            Stop: [userHookEntry],
          },
        },
        null,
        2,
      )}\n`,
    );

    expect(hasOctogentCodexHooks(workspaceCwd)).toBe(false);
  });

  it("detects partial Octogent hook configs as incomplete and repairs them", () => {
    const workspaceCwd = createTemporaryDirectory();
    mkdirSync(join(workspaceCwd, ".codex"), { recursive: true });
    const hooksPath = getCodexHooksPath(workspaceCwd);
    const partialConfig = buildCodexHooksConfig("http://127.0.0.1:8787");
    (partialConfig.hooks as Partial<typeof partialConfig.hooks>).Stop = undefined;
    partialConfig.hooks.PreToolUse.unshift({
      matcher: "Read",
      hooks: [{ type: "command", command: "node ./scripts/user-hook.js", timeout: 3 }],
    });
    writeFileSync(hooksPath, `${JSON.stringify(partialConfig, null, 2)}\n`);

    expect(hasOctogentCodexHooks(workspaceCwd)).toBe(false);

    installCodexHooksInDirectory(workspaceCwd, "http://127.0.0.1:9000");

    expect(hasOctogentCodexHooks(workspaceCwd)).toBe(true);
    const hooksConfig = JSON.parse(readFileSync(hooksPath, "utf8")) as Record<string, unknown>;
    const hooks = hooksConfig.hooks as Record<string, unknown[]>;
    expect(hooks.PreToolUse).toEqual(
      expect.arrayContaining([
        {
          matcher: "Read",
          hooks: [{ type: "command", command: "node ./scripts/user-hook.js", timeout: 3 }],
        },
      ]),
    );
    expect(JSON.stringify(hooks.Stop)).toContain("http://127.0.0.1:9000");
  });

  it("preserves existing non-Octogent hooks and top-level settings when installing", () => {
    const workspaceCwd = createTemporaryDirectory();
    mkdirSync(join(workspaceCwd, ".codex"), { recursive: true });
    const hooksPath = getCodexHooksPath(workspaceCwd);
    const userHook = {
      matcher: "Read",
      hooks: [
        {
          type: "command",
          command: "node ./scripts/audit-read.js",
          timeout: 3,
        },
      ],
    };

    writeFileSync(
      hooksPath,
      `${JSON.stringify(
        {
          customSetting: true,
          hooks: {
            PreToolUse: [userHook],
            Notification: [
              {
                matcher: "*",
                hooks: [{ type: "command", command: "node ./scripts/notify.js", timeout: 5 }],
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
    );

    installCodexHooksInDirectory(workspaceCwd, "http://127.0.0.1:8787");

    const hooksConfig = JSON.parse(readFileSync(hooksPath, "utf8")) as Record<string, unknown>;
    const hooks = hooksConfig.hooks as Record<string, unknown>;
    expect(hooksConfig.customSetting).toBe(true);
    expect(hooks.PreToolUse).toEqual(expect.arrayContaining([userHook]));
    expect(hooks.Notification).toEqual([
      {
        matcher: "*",
        hooks: [{ type: "command", command: "node ./scripts/notify.js", timeout: 5 }],
      },
    ]);
    expect(hooks.SessionStart).toBeDefined();
  });

  it("replaces previous Octogent hooks instead of duplicating them", () => {
    const workspaceCwd = createTemporaryDirectory();
    mkdirSync(join(workspaceCwd, ".codex"), { recursive: true });
    const hooksPath = getCodexHooksPath(workspaceCwd);

    installCodexHooksInDirectory(workspaceCwd, "http://127.0.0.1:8787");
    installCodexHooksInDirectory(workspaceCwd, "http://127.0.0.1:9000");

    const hooksConfig = JSON.parse(readFileSync(hooksPath, "utf8")) as Record<string, unknown>;
    const hooks = hooksConfig.hooks as Record<string, unknown[]>;
    const postToolUseEntries = hooks.PostToolUse ?? [];
    const postToolUseCommands = postToolUseEntries.flatMap((entry) => {
      const record = entry as { hooks?: Array<{ command?: string }> };
      return record.hooks?.map((hook) => hook.command ?? "") ?? [];
    });

    expect(postToolUseEntries).toHaveLength(1);
    expect(postToolUseCommands).toHaveLength(1);
    expect(postToolUseCommands[0]).toContain("http://127.0.0.1:9000");
    expect(postToolUseCommands[0]).not.toContain("http://127.0.0.1:8787");
  });

  it("backs up malformed hooks config before replacing it", () => {
    const workspaceCwd = createTemporaryDirectory();
    mkdirSync(join(workspaceCwd, ".codex"), { recursive: true });
    const hooksPath = getCodexHooksPath(workspaceCwd);
    writeFileSync(hooksPath, "{ invalid json");

    installCodexHooksInDirectory(workspaceCwd, "http://127.0.0.1:8787");

    const codexDir = join(workspaceCwd, ".codex");
    const backupFile = readdirSync(codexDir).find((file) => file.startsWith("hooks.json.invalid-"));
    expect(backupFile).toBeDefined();
    expect(readFileSync(join(codexDir, backupFile as string), "utf8")).toBe("{ invalid json");
    expect(hasOctogentCodexHooks(workspaceCwd)).toBe(true);
  });

  it("merges Octogent hooks into parsed configs without mutating unrelated events", () => {
    const merged = mergeCodexHooksConfig(
      {
        hooks: {
          Stop: [
            {
              matcher: "user-stop",
              hooks: [{ type: "command", command: "node ./stop.js", timeout: 1 }],
            },
          ],
        },
      },
      "http://127.0.0.1:8787",
    );

    const hooks = merged.hooks as Record<string, unknown>;
    expect(hooks.Stop).toEqual(
      expect.arrayContaining([
        {
          matcher: "user-stop",
          hooks: [{ type: "command", command: "node ./stop.js", timeout: 1 }],
        },
      ]),
    );
    expect(hooks.SessionStart).toBeDefined();
  });
});
