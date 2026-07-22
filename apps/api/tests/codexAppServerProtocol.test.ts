import { describe, expect, it } from "vitest";

import {
  buildCodexInitializeRequest,
  buildCodexInitializedNotification,
  buildCodexThreadStartRequest,
  buildCodexTurnStartRequest,
  codexAppServerNotificationToTerminalMessages,
  codexAppServerNotificationToTranscriptEvents,
  mapCodexThreadStatusToRuntimeState,
  parseCodexAppServerMessage,
  serializeCodexAppServerMessage,
} from "../src/terminalRuntime/codexAppServerProtocol";

describe("codex app-server protocol", () => {
  it("builds the initialize handshake and thread/turn requests", () => {
    expect(buildCodexInitializeRequest(0)).toEqual({
      id: 0,
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
    expect(buildCodexInitializedNotification()).toEqual({
      method: "initialized",
      params: {},
    });
    expect(buildCodexThreadStartRequest({ id: 1, cwd: "/repo" })).toEqual({
      id: 1,
      method: "thread/start",
      params: {
        cwd: "/repo",
        runtimeWorkspaceRoots: ["/repo"],
        sandbox: "workspace-write",
        approvalPolicy: "on-request",
        threadSource: "local",
      },
    });
    expect(
      buildCodexTurnStartRequest({
        id: 2,
        threadId: "thr_1",
        inputText: "Summarize this repo.",
        cwd: "/repo",
      }),
    ).toEqual({
      id: 2,
      method: "turn/start",
      params: {
        threadId: "thr_1",
        input: [{ type: "text", text: "Summarize this repo." }],
        cwd: "/repo",
        runtimeWorkspaceRoots: ["/repo"],
      },
    });
  });

  it("parses and serializes JSONL app-server messages", () => {
    expect(parseCodexAppServerMessage("")).toBeNull();
    expect(parseCodexAppServerMessage("{")).toBeNull();
    expect(
      parseCodexAppServerMessage('{"method":"turn/started","params":{"threadId":"thr"}}'),
    ).toEqual({
      method: "turn/started",
      params: { threadId: "thr" },
    });
    expect(parseCodexAppServerMessage('{"id":1,"result":{"ok":true}}')).toEqual({
      id: 1,
      result: { ok: true },
    });
    expect(parseCodexAppServerMessage('{"id":2,"error":{"code":-1,"message":"Nope"}}')).toEqual({
      id: 2,
      error: { code: -1, message: "Nope" },
    });
    expect(serializeCodexAppServerMessage({ method: "initialized", params: {} })).toBe(
      '{"method":"initialized","params":{}}\n',
    );
  });

  it("maps app-server thread statuses to Octogent runtime states", () => {
    expect(mapCodexThreadStatusToRuntimeState({ type: "idle" })).toBe("idle");
    expect(mapCodexThreadStatusToRuntimeState({ type: "systemError" })).toBe("idle");
    expect(
      mapCodexThreadStatusToRuntimeState({ type: "active", activeFlags: ["waitingOnApproval"] }),
    ).toBe("waiting_for_permission");
    expect(
      mapCodexThreadStatusToRuntimeState({ type: "active", activeFlags: ["waitingOnUserInput"] }),
    ).toBe("waiting_for_user");
    expect(mapCodexThreadStatusToRuntimeState({ type: "active", activeFlags: [] })).toBe(
      "processing",
    );
  });

  it("maps app-server notifications to terminal messages", () => {
    expect(
      codexAppServerNotificationToTerminalMessages({
        method: "thread/status/changed",
        params: {
          threadId: "thr",
          status: { type: "active", activeFlags: ["waitingOnApproval"] },
        },
      }),
    ).toEqual([{ type: "state", state: "waiting_for_permission" }]);
    expect(
      codexAppServerNotificationToTerminalMessages({
        method: "item/agentMessage/delta",
        params: { threadId: "thr", turnId: "turn", itemId: "item", delta: "hello" },
      }),
    ).toEqual([{ type: "output", data: "hello" }]);
    expect(
      codexAppServerNotificationToTerminalMessages({
        method: "turn/completed",
        params: { threadId: "thr", turn: { id: "turn" } },
      }),
    ).toEqual([{ type: "state", state: "idle" }]);
  });

  it("maps app-server notifications to provider-neutral transcript events", () => {
    const nextTimestamp = () => "2026-03-06T10:00:00.000Z";
    expect(
      codexAppServerNotificationToTranscriptEvents(
        {
          method: "thread/status/changed",
          params: { threadId: "thr", status: { type: "active", activeFlags: [] } },
        },
        { nextTimestamp },
      ),
    ).toEqual([
      {
        type: "state_change",
        state: "processing",
        timestamp: "2026-03-06T10:00:00.000Z",
      },
    ]);
    expect(
      codexAppServerNotificationToTranscriptEvents(
        {
          method: "item/agentMessage/delta",
          params: { threadId: "thr", turnId: "turn", itemId: "item", delta: "hello" },
        },
        { nextTimestamp },
      ),
    ).toEqual([
      {
        type: "output_chunk",
        chunkId: "item",
        text: "hello",
        timestamp: "2026-03-06T10:00:00.000Z",
      },
    ]);
  });
});
