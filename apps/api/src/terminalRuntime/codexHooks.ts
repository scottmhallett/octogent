import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const parseHooksConfig = (fileContents: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(fileContents) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }
    return parsed;
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

const isOctogentCommandHook = (hook: unknown): boolean => {
  if (!isRecord(hook) || hook.type !== "command" || typeof hook.command !== "string") {
    return false;
  }

  return (
    hook.command.includes("/api/hooks/") ||
    hook.command.includes("/api/code-intel/events") ||
    hook.command.includes("X-Octogent-Session") ||
    hook.command.includes("OCTOGENT_SESSION_ID")
  );
};

const preserveNonOctogentEntry = (entry: unknown): unknown | null => {
  if (!isRecord(entry) || !Array.isArray(entry.hooks)) {
    return entry;
  }

  const hooks = entry.hooks.filter((hook) => !isOctogentCommandHook(hook));
  if (hooks.length === 0) {
    return null;
  }

  return { ...entry, hooks };
};

export const mergeCodexHooksConfig = (
  existingConfig: Record<string, unknown> | null,
  apiBaseUrl: string,
): Record<string, unknown> => {
  const managedConfig = buildCodexHooksConfig(apiBaseUrl);
  const existingHooks = isRecord(existingConfig?.hooks) ? existingConfig.hooks : {};
  const nextHooks: Record<string, unknown> = { ...existingHooks };

  for (const eventName of CODEX_HOOK_EVENTS) {
    const existingEntries = Array.isArray(existingHooks[eventName]) ? existingHooks[eventName] : [];
    const preservedEntries = existingEntries
      .map((entry) => preserveNonOctogentEntry(entry))
      .filter((entry): entry is unknown => entry !== null);
    nextHooks[eventName] = [...preservedEntries, ...managedConfig.hooks[eventName]];
  }

  return {
    ...(existingConfig ?? {}),
    hooks: nextHooks,
  };
};

const backupMalformedHooksConfig = (hooksPath: string) => {
  const backupPath = `${hooksPath}.invalid-${Date.now()}.bak`;
  copyFileSync(hooksPath, backupPath);
  return backupPath;
};

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

  const existingConfig = existsSync(targetHooksPath)
    ? parseHooksConfig(readFileSync(targetHooksPath, "utf8"))
    : null;
  if (existsSync(targetHooksPath) && existingConfig === null) {
    backupMalformedHooksConfig(targetHooksPath);
  }

  writeFileSync(
    targetHooksPath,
    `${JSON.stringify(mergeCodexHooksConfig(existingConfig, apiBaseUrl), null, 2)}\n`,
  );
};
