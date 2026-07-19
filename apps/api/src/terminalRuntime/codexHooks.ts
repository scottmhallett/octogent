import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CODEX_HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "Stop",
] as const;

type CodexHookEventName = (typeof CODEX_HOOK_EVENTS)[number];

type CodexCommandHook = {
  type: "command";
  command: string;
  timeout: number;
  statusMessage?: string;
};

type CodexHookEntry = {
  matcher: string;
  hooks: CodexCommandHook[];
};

type CodexHooksByEvent = Record<CodexHookEventName, CodexHookEntry[]>;

type CodexHooksConfig = {
  hooks: CodexHooksByEvent;
};

const parseHooksConfig = (fileContents: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(fileContents) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
};

const hookCommand = (apiBaseUrl: string, hookName: string) =>
  `curl -s -X POST "${apiBaseUrl}/api/hooks/${hookName}?octogent_session=$OCTOGENT_SESSION_ID" -H 'Content-Type: application/json' -d @- || true`;

const codeIntelCommand = (apiBaseUrl: string) =>
  `curl -s -X POST "${apiBaseUrl}/api/code-intel/events" -H "X-Octogent-Session: $OCTOGENT_SESSION_ID" -H 'Content-Type: application/json' -d @- || true`;

export const buildCodexHooksConfig = (apiBaseUrl: string): CodexHooksConfig => ({
  hooks: {
    SessionStart: [
      {
        matcher: "*",
        hooks: [
          {
            type: "command",
            command: hookCommand(apiBaseUrl, "session-start"),
            timeout: 5,
            statusMessage: "Notifying Octogent",
          },
        ],
      },
    ],
    UserPromptSubmit: [
      {
        matcher: "*",
        hooks: [
          {
            type: "command",
            command: hookCommand(apiBaseUrl, "user-prompt-submit"),
            timeout: 5,
            statusMessage: "Updating Octogent activity",
          },
        ],
      },
    ],
    PreToolUse: [
      {
        matcher: "*",
        hooks: [
          {
            type: "command",
            command: hookCommand(apiBaseUrl, "pre-tool-use"),
            timeout: 5,
            statusMessage: "Updating Octogent tool state",
          },
        ],
      },
    ],
    PermissionRequest: [
      {
        matcher: "*",
        hooks: [
          {
            type: "command",
            command: hookCommand(apiBaseUrl, "permission-request"),
            timeout: 5,
            statusMessage: "Updating Octogent approval state",
          },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: "*",
        hooks: [
          {
            type: "command",
            command: codeIntelCommand(apiBaseUrl),
            timeout: 5,
            statusMessage: "Updating Octogent code intel",
          },
        ],
      },
    ],
    Stop: [
      {
        matcher: "*",
        hooks: [
          {
            type: "command",
            command: hookCommand(apiBaseUrl, "stop"),
            timeout: 15,
            statusMessage: "Completing Octogent turn",
          },
        ],
      },
    ],
  },
});

export const getCodexHooksPath = (targetCwd: string) => join(targetCwd, ".codex", "hooks.json");

export const hasOctogentCodexHooks = (targetCwd: string): boolean => {
  const hooksPath = getCodexHooksPath(targetCwd);
  if (!existsSync(hooksPath)) {
    return false;
  }

  const hooksConfig = parseHooksConfig(readFileSync(hooksPath, "utf8"));
  if (!hooksConfig) {
    return false;
  }

  const hooks = hooksConfig.hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) {
    return false;
  }

  return CODEX_HOOK_EVENTS.every((eventName) =>
    Array.isArray((hooks as Record<string, unknown>)[eventName]),
  );
};

export const installCodexHooksInDirectory = (targetCwd: string, apiBaseUrl: string) => {
  const targetCodexDir = join(targetCwd, ".codex");
  const targetHooksPath = getCodexHooksPath(targetCwd);
  mkdirSync(targetCodexDir, { recursive: true });
  writeFileSync(targetHooksPath, `${JSON.stringify(buildCodexHooksConfig(apiBaseUrl), null, 2)}\n`);
};
