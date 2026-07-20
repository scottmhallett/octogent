import type { AgentRuntimeState } from "@octogent/core";

import type { ConversationTranscriptEventPayload } from "./conversations";
import type { TerminalServerMessage } from "./types";

export type CodexAppServerRequestId = number | string;

export type CodexAppServerRequest = {
  id: CodexAppServerRequestId;
  method: string;
  params: Record<string, unknown>;
};

export type CodexAppServerNotification = {
  method: string;
  params: Record<string, unknown>;
};

export type CodexAppServerResponse = {
  id: CodexAppServerRequestId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

export type CodexAppServerMessage =
  | CodexAppServerRequest
  | CodexAppServerNotification
  | CodexAppServerResponse;

type ThreadStatus =
  | { type: "idle" | "notLoaded" | "systemError" }
  | { type: "active"; activeFlags?: string[] };

type BuildThreadStartRequestOptions = {
  id: CodexAppServerRequestId;
  cwd: string;
};

type BuildTurnStartRequestOptions = {
  id: CodexAppServerRequestId;
  threadId: string;
  inputText: string;
  cwd?: string;
};

type MapNotificationOptions = {
  nextTimestamp?: () => string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

const asRecord = (value: unknown): Record<string, unknown> | null =>
  isRecord(value) ? value : null;

const asThreadStatus = (value: unknown): ThreadStatus | null => {
  const record = asRecord(value);
  const type = asString(record?.type);
  if (type === "idle" || type === "notLoaded" || type === "systemError") {
    return { type };
  }

  if (type === "active") {
    const activeFlags = Array.isArray(record?.activeFlags)
      ? record.activeFlags.filter((flag): flag is string => typeof flag === "string")
      : [];
    return { type, activeFlags };
  }

  return null;
};

const getNestedString = (value: unknown, path: string[]): string | null => {
  let current: unknown = value;
  for (const segment of path) {
    const record = asRecord(current);
    if (!record) {
      return null;
    }
    current = record[segment];
  }
  return asString(current);
};

export const parseCodexAppServerMessage = (line: string): CodexAppServerMessage | null => {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const method = asString(parsed.method);
  const params = asRecord(parsed.params);
  const hasId = typeof parsed.id === "number" || typeof parsed.id === "string";

  if (method && params && hasId) {
    return {
      id: parsed.id,
      method,
      params,
    };
  }

  if (method && params) {
    return {
      method,
      params,
    };
  }

  if (hasId && (Object.hasOwn(parsed, "result") || Object.hasOwn(parsed, "error"))) {
    const errorRecord = asRecord(parsed.error);
    const code = typeof errorRecord?.code === "number" ? errorRecord.code : null;
    const message = asString(errorRecord?.message);
    return {
      id: parsed.id,
      ...(Object.hasOwn(parsed, "result") ? { result: parsed.result } : {}),
      ...(code !== null && message
        ? {
            error: {
              code,
              message,
              ...(Object.hasOwn(errorRecord, "data") ? { data: errorRecord.data } : {}),
            },
          }
        : {}),
    };
  }

  return null;
};

export const serializeCodexAppServerMessage = (
  message: CodexAppServerRequest | CodexAppServerNotification,
): string => `${JSON.stringify(message)}\n`;

export const buildCodexInitializeRequest = (
  id: CodexAppServerRequestId,
): CodexAppServerRequest => ({
  id,
  method: "initialize",
  params: {
    clientInfo: {
      name: "octogent",
      title: "Octogent",
      version: "0.1.0",
    },
    capabilities: {
      experimentalApi: true,
    },
  },
});

export const buildCodexInitializedNotification = (): CodexAppServerNotification => ({
  method: "initialized",
  params: {},
});

export const buildCodexThreadStartRequest = ({
  id,
  cwd,
}: BuildThreadStartRequestOptions): CodexAppServerRequest => ({
  id,
  method: "thread/start",
  params: {
    cwd,
    runtimeWorkspaceRoots: [cwd],
    sandbox: "workspace-write",
    approvalPolicy: "on-request",
    threadSource: "local",
  },
});

export const buildCodexTurnStartRequest = ({
  id,
  threadId,
  inputText,
  cwd,
}: BuildTurnStartRequestOptions): CodexAppServerRequest => ({
  id,
  method: "turn/start",
  params: {
    threadId,
    input: [{ type: "text", text: inputText }],
    ...(cwd ? { cwd, runtimeWorkspaceRoots: [cwd] } : {}),
  },
});

export const mapCodexThreadStatusToRuntimeState = (
  status: ThreadStatus | null,
): AgentRuntimeState | null => {
  if (!status) {
    return null;
  }

  if (status.type === "idle") {
    return "idle";
  }

  if (status.type === "systemError") {
    return "idle";
  }

  if (status.type === "active") {
    if (status.activeFlags?.includes("waitingOnApproval")) {
      return "waiting_for_permission";
    }
    if (status.activeFlags?.includes("waitingOnUserInput")) {
      return "waiting_for_user";
    }
    return "processing";
  }

  return null;
};

export const codexAppServerNotificationToTerminalMessages = (
  notification: CodexAppServerNotification,
): TerminalServerMessage[] => {
  if (notification.method === "thread/status/changed") {
    const state = mapCodexThreadStatusToRuntimeState(asThreadStatus(notification.params.status));
    return state ? [{ type: "state", state }] : [];
  }

  if (
    notification.method === "item/agentMessage/delta" ||
    notification.method === "item/reasoning/textDelta" ||
    notification.method === "item/reasoning/summaryTextDelta"
  ) {
    const delta = asString(notification.params.delta);
    return delta ? [{ type: "output", data: delta }] : [];
  }

  if (
    notification.method === "command/exec/outputDelta" ||
    notification.method === "item/commandExecution/outputDelta" ||
    notification.method === "item/fileChange/outputDelta"
  ) {
    const delta = asString(notification.params.delta);
    return delta ? [{ type: "output", data: delta }] : [];
  }

  if (notification.method === "turn/started") {
    return [{ type: "state", state: "processing" }];
  }

  if (notification.method === "turn/completed") {
    return [{ type: "state", state: "idle" }];
  }

  return [];
};

export const codexAppServerNotificationToTranscriptEvents = (
  notification: CodexAppServerNotification,
  options: MapNotificationOptions = {},
): ConversationTranscriptEventPayload[] => {
  const timestamp = options.nextTimestamp?.() ?? new Date().toISOString();

  if (notification.method === "thread/status/changed") {
    const state = mapCodexThreadStatusToRuntimeState(asThreadStatus(notification.params.status));
    return state ? [{ type: "state_change", state, timestamp }] : [];
  }

  if (notification.method === "turn/started") {
    const turnId = getNestedString(notification.params, ["turn", "id"]);
    return turnId
      ? [
          {
            type: "output_chunk",
            chunkId: `codex-app-server:turn-started:${turnId}`,
            text: "",
            timestamp,
          },
        ]
      : [];
  }

  if (
    notification.method === "item/agentMessage/delta" ||
    notification.method === "item/reasoning/textDelta" ||
    notification.method === "item/reasoning/summaryTextDelta" ||
    notification.method === "command/exec/outputDelta" ||
    notification.method === "item/commandExecution/outputDelta" ||
    notification.method === "item/fileChange/outputDelta"
  ) {
    const delta = asString(notification.params.delta);
    const chunkId =
      asString(notification.params.itemId) ??
      asString(notification.params.processId) ??
      asString(notification.params.turnId) ??
      `codex-app-server:${notification.method}:${timestamp}`;
    return delta
      ? [
          {
            type: "output_chunk",
            chunkId,
            text: delta,
            timestamp,
          },
        ]
      : [];
  }

  if (notification.method === "turn/completed") {
    return [{ type: "state_change", state: "idle", timestamp }];
  }

  return [];
};
