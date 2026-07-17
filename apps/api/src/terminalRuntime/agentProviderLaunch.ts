import type { TerminalAgentProvider } from "@octogent/core";

export type ShellLaunch = {
  command: string;
  args: string[];
};

export type AgentProviderLaunch = {
  command: string;
  args: string[];
  cwd: string;
  label: string;
  promptDelivery: "argv" | "deferred-paste";
  bootstrapInput?: string;
};

type BuildAgentProviderLaunchOptions = {
  provider: TerminalAgentProvider;
  cwd: string;
  initialPrompt?: string;
  shellLaunch: ShellLaunch;
};

export const TERMINAL_AGENT_PROVIDER_LABELS: Record<TerminalAgentProvider, string> = {
  codex: "Codex",
  "claude-code": "Claude Code",
};

export const buildAgentProviderLaunch = ({
  provider,
  cwd,
  initialPrompt,
  shellLaunch,
}: BuildAgentProviderLaunchOptions): AgentProviderLaunch => {
  if (provider === "codex") {
    return {
      command: "codex",
      args: [
        "--cd",
        cwd,
        "--sandbox",
        "workspace-write",
        "--ask-for-approval",
        "on-request",
        "--no-alt-screen",
        ...(initialPrompt ? [initialPrompt] : []),
      ],
      cwd,
      label: TERMINAL_AGENT_PROVIDER_LABELS.codex,
      promptDelivery: "argv",
    };
  }

  return {
    command: shellLaunch.command,
    args: shellLaunch.args,
    cwd,
    label: TERMINAL_AGENT_PROVIDER_LABELS["claude-code"],
    promptDelivery: "deferred-paste",
    bootstrapInput: "claude",
  };
};
