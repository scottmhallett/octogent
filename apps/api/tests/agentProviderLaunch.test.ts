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

  it("uses the Codex draft as the prompt argument when no initial prompt is provided", () => {
    const launch = buildAgentProviderLaunch({
      provider: "codex",
      cwd: "/repo/.octogent/worktrees/docs",
      initialInputDraft: "You are working on the Docs section.",
      shellLaunch: { command: "/bin/zsh", args: ["-i"] },
    });

    expect(launch.args.at(-1)).toBe("You are working on the Docs section.");
  });

  it("prefers the explicit Codex initial prompt over a draft", () => {
    const launch = buildAgentProviderLaunch({
      provider: "codex",
      cwd: "/repo/.octogent/worktrees/docs",
      initialPrompt: "Run the planner.",
      initialInputDraft: "You are working on the Docs section.",
      shellLaunch: { command: "/bin/zsh", args: ["-i"] },
    });

    expect(launch.args.at(-1)).toBe("Run the planner.");
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
