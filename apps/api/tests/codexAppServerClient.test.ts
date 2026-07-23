import { describe, expect, it } from "vitest";

import { CodexAppServerClient } from "../src/terminalRuntime/codexAppServerClient";
import type { CodexAppServerNotification } from "../src/terminalRuntime/codexAppServerProtocol";

class FakeJsonLineTransport {
  writtenLines: string[] = [];
  private lineListeners = new Set<(line: string) => void>();
  private closeListeners = new Set<(error?: Error) => void>();

  writeLine(line: string) {
    this.writtenLines.push(line);
  }

  onLine(listener: (line: string) => void) {
    this.lineListeners.add(listener);
  }

  onClose(listener: (error?: Error) => void) {
    this.closeListeners.add(listener);
  }

  close() {
    for (const listener of this.closeListeners) {
      listener();
    }
  }

  emitLine(line: string) {
    for (const listener of this.lineListeners) {
      listener(line);
    }
  }
}

describe("CodexAppServerClient", () => {
  it("performs initialize handshake and routes responses by id", async () => {
    const transport = new FakeJsonLineTransport();
    const client = new CodexAppServerClient({ transport, requestIdStart: 10 });

    const initializePromise = client.initialize();
    expect(transport.writtenLines).toEqual([
      `${JSON.stringify({
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
      })}\n`,
    ]);

    transport.emitLine('{"id":0,"result":{"userAgent":"codex-test"}}');
    await expect(initializePromise).resolves.toEqual({ userAgent: "codex-test" });
    expect(transport.writtenLines.at(-1)).toBe('{"method":"initialized","params":{}}\n');

    const requestPromise = client.request("thread/start", { cwd: "/repo" });
    expect(transport.writtenLines.at(-1)).toBe(
      '{"id":10,"method":"thread/start","params":{"cwd":"/repo"}}\n',
    );
    transport.emitLine('{"id":10,"result":{"thread":{"id":"thr_1"}}}');
    await expect(requestPromise).resolves.toEqual({ thread: { id: "thr_1" } });
  });

  it("emits notifications and rejects pending requests on close", async () => {
    const transport = new FakeJsonLineTransport();
    const client = new CodexAppServerClient({ transport });
    const notifications: CodexAppServerNotification[] = [];
    client.onNotification((notification) => {
      notifications.push(notification);
    });

    transport.emitLine(
      '{"method":"thread/status/changed","params":{"threadId":"thr","status":{"type":"idle"}}}',
    );
    expect(notifications).toEqual([
      {
        method: "thread/status/changed",
        params: {
          threadId: "thr",
          status: { type: "idle" },
        },
      },
    ]);

    const requestPromise = client.request("thread/start", { cwd: "/repo" });
    client.close();
    await expect(requestPromise).rejects.toThrow("Codex app-server connection closed.");
  });

  it("marks the client closed when the transport closes externally", async () => {
    const transport = new FakeJsonLineTransport();
    const client = new CodexAppServerClient({ transport });
    const closeEvents: string[] = [];
    client.onClose((error) => {
      closeEvents.push(error?.message ?? "closed");
    });

    const requestPromise = client.request("thread/start", { cwd: "/repo" });
    expect(transport.writtenLines).toHaveLength(1);

    transport.close();

    await expect(requestPromise).rejects.toThrow("Codex app-server connection closed.");
    await expect(client.request("thread/start", { cwd: "/repo" })).rejects.toThrow(
      "Codex app-server client is closed.",
    );
    expect(() => {
      client.notify({ method: "initialized", params: {} });
    }).toThrow("Codex app-server client is closed.");
    expect(transport.writtenLines).toHaveLength(1);
    expect(closeEvents).toEqual(["Codex app-server connection closed."]);
  });
});
