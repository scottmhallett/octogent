import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import {
  type CodexAppServerMessage,
  type CodexAppServerNotification,
  type CodexAppServerRequest,
  type CodexAppServerRequestId,
  type CodexAppServerResponse,
  buildCodexInitializeRequest,
  buildCodexInitializedNotification,
  parseCodexAppServerMessage,
  serializeCodexAppServerMessage,
} from "./codexAppServerProtocol";

type JsonLineTransport = {
  writeLine: (line: string) => void;
  onLine: (listener: (line: string) => void) => void;
  onClose: (listener: (error?: Error) => void) => void;
  close: () => void;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export type CodexAppServerClientOptions = {
  transport: JsonLineTransport;
  requestIdStart?: number;
};

export type CodexAppServerProcessTransportOptions = {
  command?: string;
  args?: string[];
  cwd?: string;
};

const isResponse = (message: CodexAppServerMessage): message is CodexAppServerResponse =>
  "id" in message && !("method" in message);

const isNotification = (message: CodexAppServerMessage): message is CodexAppServerNotification =>
  "method" in message && !("id" in message);

export class CodexAppServerClient {
  private readonly transport: JsonLineTransport;
  private nextRequestId: number;
  private closed = false;
  private readonly pendingRequests = new Map<CodexAppServerRequestId, PendingRequest>();
  private readonly notificationListeners = new Set<
    (notification: CodexAppServerNotification) => void
  >();
  private readonly closeListeners = new Set<(error?: Error) => void>();

  constructor({ transport, requestIdStart = 1 }: CodexAppServerClientOptions) {
    this.transport = transport;
    this.nextRequestId = requestIdStart;
    this.transport.onLine((line) => {
      this.handleLine(line);
    });
    this.transport.onClose((error) => {
      this.closed = true;
      const closeError = error ?? new Error("Codex app-server connection closed.");
      this.closePending(closeError);
      for (const listener of this.closeListeners) {
        listener(closeError);
      }
    });
  }

  onNotification(listener: (notification: CodexAppServerNotification) => void): () => void {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }

  onClose(listener: (error?: Error) => void): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  async initialize(): Promise<unknown> {
    const result = await this.requestWithId(buildCodexInitializeRequest(0));
    this.notify(buildCodexInitializedNotification());
    return result;
  }

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const request: CodexAppServerRequest = {
      id: this.nextRequestId,
      method,
      params,
    };
    this.nextRequestId += 1;
    return this.requestWithId(request);
  }

  notify(notification: CodexAppServerNotification): void {
    if (this.closed) {
      throw new Error("Codex app-server client is closed.");
    }
    this.transport.writeLine(serializeCodexAppServerMessage(notification));
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.transport.close();
    this.closePending(new Error("Codex app-server client closed."));
  }

  private requestWithId(request: CodexAppServerRequest): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new Error("Codex app-server client is closed."));
    }

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(request.id, { resolve, reject });
      this.transport.writeLine(serializeCodexAppServerMessage(request));
    });
  }

  private handleLine(line: string): void {
    const message = parseCodexAppServerMessage(line);
    if (!message) {
      return;
    }

    if (isResponse(message)) {
      const pending = this.pendingRequests.get(message.id);
      if (!pending) {
        return;
      }
      this.pendingRequests.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (isNotification(message)) {
      for (const listener of this.notificationListeners) {
        listener(message);
      }
    }
  }

  private closePending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}

export const createCodexAppServerProcessTransport = ({
  command = "codex",
  args = ["app-server", "--stdio"],
  cwd,
}: CodexAppServerProcessTransportOptions = {}): JsonLineTransport => {
  const child = spawn(command, args, {
    cwd,
    stdio: ["pipe", "pipe", "inherit"],
  });

  const stdin = child.stdin as Writable;
  const stdout = child.stdout as Readable;
  const lineListeners = new Set<(line: string) => void>();
  const closeListeners = new Set<(error?: Error) => void>();

  const lineReader = createInterface({ input: stdout });
  lineReader.on("line", (line) => {
    for (const listener of lineListeners) {
      listener(line);
    }
  });
  child.on("error", (error) => {
    for (const listener of closeListeners) {
      listener(error);
    }
  });
  child.on("close", () => {
    for (const listener of closeListeners) {
      listener();
    }
  });

  return {
    writeLine: (line) => {
      stdin.write(line);
    },
    onLine: (listener) => {
      lineListeners.add(listener);
    },
    onClose: (listener) => {
      closeListeners.add(listener);
    },
    close: () => {
      lineReader.close();
      child.kill();
    },
  };
};
