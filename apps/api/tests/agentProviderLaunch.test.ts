import { describe, expect, it } from "vitest";

import { buildAgentProviderLaunch } from "../src/terminalRuntime/agentProviderLaunch";

describe("buildAgentProviderLaunch", () => {
  it("builds a direct Codex launch command with PTY-safe flags and prompt argument", () => {
    const launch = buildAgentProviderLaunch({
      provider: "codex",
      cwd: "/repo/.octogent/worktrees/tentacle-1",
      initialPrompt: "Investigate the failing test.",
      shellLaunch: { command: "/bin/zsh", args: ["-i"] },
    });

    expect(launch).toEqual({
      command: "codex",
      args: [
        "--cd",
        "/repo/.octogent/worktrees/tentacle-1",
        "--sandbox",
        "workspace-write",
        "--ask-for-approval",
        "on-request",
        "--no-alt-screen",
        "Investigate the failing test.",
      ],
      cwd: "/repo/.octogent/worktrees/tentacle-1",
      label: "Codex",
      promptDelivery: "argv",
    });
  });

  it("keeps Claude launch shell-backed with a bootstrap command", () => {
    const launch = buildAgentProviderLaunch({
      provider: "claude-code",
      cwd: "/repo",
      shellLaunch: { command: "/bin/zsh", args: ["-i"] },
    });

    expect(launch).toEqual({
      command: "/bin/zsh",
      args: ["-i"],
      cwd: "/repo",
      label: "Claude Code",
      promptDelivery: "deferred-paste",
      bootstrapInput: "claude",
    });
  });
});
