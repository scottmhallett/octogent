import { EventEmitter } from "node:events";

import type { AgentRuntimeState } from "@octogent/core";

import {
  CodexAppServerClient,
  type CodexAppServerProcessTransportOptions,
  createCodexAppServerProcessTransport,
} from "./codexAppServerClient";
import {
  type CodexAppServerNotification,
  buildCodexThreadStartRequest,
  buildCodexTurnStartRequest,
  codexAppServerNotificationToTerminalMessages,
  codexAppServerNotificationToTranscriptEvents,
} from "./codexAppServerProtocol";
import type { ConversationTranscriptEventPayload } from "./conversations";
import type { AgentSessionProcess, Disposable } from "./types";

type CreateCodexAppServerAgentProcessOptions = {
  cwd: string;
  initialPrompt?: string;
  initialInputDraft?: string;
  client?: CodexAppServerClient;
  transportOptions?: CodexAppServerProcessTransportOptions;
};

type AppServerEvents = {
  data: [string];
  exit: [{ exitCode: number; signal: number }];
  state: [AgentRuntimeState, string | undefined];
  transcriptEvent: [ConversationTranscriptEventPayload];
};

const timestamp = () => new Date().toISOString();

const asThreadId = (value: unknown): string | null => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const thread = record.thread;
  if (thread === null || typeof thread !== "object" || Array.isArray(thread)) {
    return null;
  }
  const threadRecord = thread as Record<string, unknown>;
  return typeof threadRecord.id === "string" ? threadRecord.id : null;
};

class CodexAppServerAgentProcess implements AgentSessionProcess {
  private readonly emitter = new EventEmitter<AppServerEvents>();
  private readonly client: CodexAppServerClient;
  private readonly cwd: string;
  private pendingInput = "";
  private threadId: string | null = null;
  private ready = false;
  private closed = false;
  private nextRequestId = 1;
  private readonly queuedPrompts: string[] = [];

  constructor({
    cwd,
    initialPrompt,
    initialInputDraft,
    client,
    transportOptions,
  }: CreateCodexAppServerAgentProcessOptions) {
    this.cwd = cwd;
    this.client =
      client ??
      new CodexAppServerClient({
        transport: createCodexAppServerProcessTransport({ cwd, ...transportOptions }),
      });
    this.client.onNotification((notification) => {
      this.handleNotification(notification);
    });

    const firstPrompt = initialPrompt ?? initialInputDraft;
    if (firstPrompt) {
      this.queuedPrompts.push(firstPrompt);
    }

    void this.start();
  }

  write(data: string): void {
    if (this.closed) {
      return;
    }

    for (const character of Array.from(data)) {
      if (character === "\r") {
        this.submitPendingInput();
        continue;
      }

      if (character === "\n") {
        this.pendingInput = `${this.pendingInput}\n`;
        continue;
      }

      if (character === "\b" || character === "\u007F") {
        this.pendingInput = this.pendingInput.slice(0, -1);
        continue;
      }

      this.pendingInput = `${this.pendingInput}${character}`;
    }
  }

  resize(_cols: number, _rows: number): void {
    // App-server mode has no PTY viewport to resize.
  }

  kill(_signal?: string): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.client.close();
    this.emitter.emit("exit", { exitCode: 0, signal: 0 });
  }

  onData(listener: (chunk: string) => void): Disposable {
    this.emitter.on("data", listener);
    return {
      dispose: () => {
        this.emitter.off("data", listener);
      },
    };
  }

  onExit(listener: (event: { exitCode: number; signal: number }) => void): Disposable {
    this.emitter.on("exit", listener);
    return {
      dispose: () => {
        this.emitter.off("exit", listener);
      },
    };
  }

  onState(listener: (state: AgentRuntimeState, toolName?: string) => void): Disposable {
    this.emitter.on("state", listener);
    return {
      dispose: () => {
        this.emitter.off("state", listener);
      },
    };
  }

  onTranscriptEvent(listener: (event: ConversationTranscriptEventPayload) => void): Disposable {
    this.emitter.on("transcriptEvent", listener);
    return {
      dispose: () => {
        this.emitter.off("transcriptEvent", listener);
      },
    };
  }

  private async start(): Promise<void> {
    try {
      this.emitter.emit("data", "[Codex app-server starting]\r\n");
      await this.client.initialize();
      const result = await this.client.request(
        "thread/start",
        buildCodexThreadStartRequest({
          id: this.nextRequestId,
          cwd: this.cwd,
        }).params,
      );
      this.nextRequestId += 1;
      this.threadId = asThreadId(result);
      if (!this.threadId) {
        throw new Error("Codex app-server did not return a thread id.");
      }

      this.ready = true;
      this.emitter.emit("data", `[Codex app-server thread ${this.threadId} ready]\r\n`);
      this.flushQueuedPrompts();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown app-server startup error.";
      this.emitter.emit("data", `[Codex app-server failed: ${message}]\r\n`);
      this.closed = true;
      this.emitter.emit("exit", { exitCode: 1, signal: 0 });
    }
  }

  private submitPendingInput(): void {
    const prompt = this.pendingInput;
    this.pendingInput = "";
    if (prompt.trim().length === 0) {
      return;
    }

    if (!this.ready || !this.threadId) {
      this.queuedPrompts.push(prompt);
      return;
    }

    this.startTurn(prompt);
  }

  private flushQueuedPrompts(): void {
    while (this.queuedPrompts.length > 0) {
      const prompt = this.queuedPrompts.shift();
      if (prompt) {
        this.startTurn(prompt);
      }
    }
  }

  private startTurn(prompt: string): void {
    if (!this.threadId || this.closed) {
      return;
    }

    this.emitter.emit("transcriptEvent", {
      type: "input_submit",
      submitId: `codex-app-server:input:${this.nextRequestId}`,
      text: prompt,
      timestamp: timestamp(),
    });
    this.emitter.emit("state", "processing", undefined);
    const request = buildCodexTurnStartRequest({
      id: this.nextRequestId,
      threadId: this.threadId,
      inputText: prompt,
      cwd: this.cwd,
    });
    this.nextRequestId += 1;
    void this.client.request(request.method, request.params).catch((error) => {
      const message =
        error instanceof Error ? error.message : "Unknown app-server turn start error.";
      this.emitter.emit("data", `[Codex app-server turn failed: ${message}]\r\n`);
      this.emitter.emit("state", "idle", undefined);
    });
  }

  private handleNotification(notification: CodexAppServerNotification): void {
    for (const message of codexAppServerNotificationToTerminalMessages(notification)) {
      if (message.type === "output") {
        this.emitter.emit("data", message.data);
      } else if (message.type === "state") {
        this.emitter.emit("state", message.state, message.toolName);
      }
    }

    for (const event of codexAppServerNotificationToTranscriptEvents(notification)) {
      if (event.type === "state_change") {
        continue;
      }
      this.emitter.emit("transcriptEvent", event);
    }
  }
}

export const createCodexAppServerAgentProcess = (
  options: CreateCodexAppServerAgentProcessOptions,
): AgentSessionProcess => new CodexAppServerAgentProcess(options);
