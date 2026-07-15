import type { TerminalAgentProvider } from "./agentRuntime";

export type WorkspaceSetupStepId =
  | "initialize-workspace"
  | "ensure-gitignore"
  | "check-codex"
  | "check-claude"
  | "check-git"
  | "check-curl"
  | "create-tentacles";

export type WorkspaceSetupProviderChoice = {
  provider: TerminalAgentProvider;
  label: string;
  available: boolean;
  selected: boolean;
};

export type WorkspaceSetupStep = {
  id: WorkspaceSetupStepId;
  title: string;
  description: string;
  complete: boolean;
  required: boolean;
  actionLabel: string | null;
  statusText: string;
  guidance: string | null;
  command: string | null;
};

export type WorkspaceSetupSnapshot = {
  isFirstRun: boolean;
  shouldShowSetupCard: boolean;
  defaultAgentProvider: TerminalAgentProvider;
  configuredAgentProvider: TerminalAgentProvider | null;
  needsProviderSelection: boolean;
  providerChoices: WorkspaceSetupProviderChoice[];
  hasAnyTentacles: boolean;
  tentacleCount: number;
  steps: WorkspaceSetupStep[];
};
