import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentStateTracker } from "../src/agentStateDetection";
import { createHookProcessor } from "../src/terminalRuntime/hookProcessor";
import type {
  PersistedTerminal,
  TerminalServerMessage,
  TerminalSession,
} from "../src/terminalRuntime/types";

describe("createHookProcessor", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories) {
      rmSync(directory, { recursive: true, force: true });
    }
    temporaryDirectories.length = 0;
  });

  const createTemporaryDirectory = () => {
    const directory = mkdtempSync(join(tmpdir(), "octogent-hook-processor-test-"));
    temporaryDirectories.push(directory);
    return directory;
  };

  const createActiveSession = (messages: TerminalServerMessage[] = []): TerminalSession => {
    const stateTracker = new AgentStateTracker();
    return {
      terminalId: "terminal-1",
      tentacleId: "terminal-1",
      pty: {} as TerminalSession["pty"],
      clients: new Set(),
      directListeners: new Set([(message) => messages.push(message)]),
      cols: 80,
      rows: 24,
      agentState: stateTracker.currentState,
      stateTracker,
      isBootstrapCommandSent: true,
      scrollbackChunks: [],
      scrollbackBytes: 0,
    };
  };

  it("maps Codex permission requests to waiting-for-permission state", () => {
    const messages: TerminalServerMessage[] = [];
    const session = createActiveSession(messages);
    const terminals = new Map<string, PersistedTerminal>();
    const sessions = new Map<string, TerminalSession>([["terminal-1", session]]);
    const onStateChange = vi.fn();
    const hookProcessor = createHookProcessor({
      terminals,
      sessions,
      transcriptDirectoryPath: createTemporaryDirectory(),
      getApiBaseUrl: () => "http://127.0.0.1:8787",
      persistRegistry: vi.fn(),
      deliverChannelMessages: vi.fn(() => 0),
      releaseSessionKeepAlive: vi.fn(() => true),
      onStateChange,
    });

    expect(
      hookProcessor.handleHook("permission-request", { reason: "approval needed" }, "terminal-1"),
    ).toEqual({ ok: true });

    expect(session.agentState).toBe("waiting_for_permission");
    expect(onStateChange).toHaveBeenCalledWith("terminal-1", "waiting_for_permission", undefined);
    expect(messages).toContainEqual({
      type: "state",
      state: "waiting_for_permission",
    });
  });

  it("maps Codex stop hooks without transcript internals to idle and releases keepalive", () => {
    const messages: TerminalServerMessage[] = [];
    const session = createActiveSession(messages);
    session.agentState = "processing";
    session.stateTracker.forceState("processing");
    const terminals = new Map<string, PersistedTerminal>();
    const sessions = new Map<string, TerminalSession>([["terminal-1", session]]);
    const releaseSessionKeepAlive = vi.fn(() => true);
    const hookProcessor = createHookProcessor({
      terminals,
      sessions,
      transcriptDirectoryPath: createTemporaryDirectory(),
      getApiBaseUrl: () => "http://127.0.0.1:8787",
      persistRegistry: vi.fn(),
      deliverChannelMessages: vi.fn(() => 0),
      releaseSessionKeepAlive,
    });

    expect(hookProcessor.handleHook("stop", {}, "terminal-1")).toEqual({ ok: true });

    expect(session.agentState).toBe("idle");
    expect(releaseSessionKeepAlive).toHaveBeenCalledWith("terminal-1");
    expect(messages).toContainEqual({ type: "state", state: "idle" });
  });
});
