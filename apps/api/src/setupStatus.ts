import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import type {
  TerminalAgentProvider,
  WorkspaceSetupProviderChoice,
  WorkspaceSetupSnapshot,
  WorkspaceSetupStep,
} from "@octogent/core";

import { readDeckTentacles } from "./deck/readDeckTentacles";
import {
  deriveProjectIdFromWorkspace,
  ensureOctogentGitignoreEntry,
  ensureProjectScaffold,
  hasOctogentGitignoreEntry,
  loadProjectConfig,
  migrateStateToGlobal,
  registerProject,
} from "./projectPersistence";
import { readSetupState, setDefaultAgentProvider } from "./setupState";
import { collectStartupPrerequisiteReport } from "./startupPrerequisites";
import { hasOctogentCodexHooks } from "./terminalRuntime/codexHooks";

const PROVIDER_LABELS: Record<TerminalAgentProvider, string> = {
  codex: "Codex",
  "claude-code": "Claude Code",
};

export const resolveDefaultAgentProvider = (
  projectStateDir: string,
  availability = collectStartupPrerequisiteReport().availability,
): {
  defaultAgentProvider: TerminalAgentProvider;
  configuredAgentProvider: TerminalAgentProvider | null;
  needsProviderSelection: boolean;
  providerChoices: WorkspaceSetupProviderChoice[];
} => {
  const setupState = readSetupState(projectStateDir);
  const configuredAgentProvider = setupState.defaultAgentProvider ?? null;
  const availableProviders: TerminalAgentProvider[] = [];
  if (availability.codex) availableProviders.push("codex");
  if (availability.claude) availableProviders.push("claude-code");

  const autoSelectedProvider: TerminalAgentProvider =
    availableProviders.length === 1 && availableProviders[0]
      ? availableProviders[0]
      : "claude-code";
  const defaultAgentProvider = configuredAgentProvider ?? autoSelectedProvider;
  const needsProviderSelection =
    configuredAgentProvider === null && availability.codex && availability.claude;

  return {
    defaultAgentProvider,
    configuredAgentProvider,
    needsProviderSelection,
    providerChoices: (["claude-code", "codex"] as TerminalAgentProvider[]).map((provider) => ({
      provider,
      label: PROVIDER_LABELS[provider],
      available: provider === "codex" ? availability.codex : availability.claude,
      selected: provider === defaultAgentProvider,
    })),
  };
};

export const initializeWorkspaceFiles = (
  workspaceCwd: string,
  projectStateDir: string,
  defaultAgentProvider?: TerminalAgentProvider,
) => {
  const projectName = loadProjectConfig(workspaceCwd)?.displayName;
  const projectConfig = ensureProjectScaffold(
    workspaceCwd,
    projectName,
    deriveProjectIdFromWorkspace(workspaceCwd),
  );
  registerProject(workspaceCwd, projectConfig.displayName);
  mkdirSync(join(projectStateDir, "state"), { recursive: true });
  migrateStateToGlobal(workspaceCwd, projectStateDir);
  if (defaultAgentProvider) {
    setDefaultAgentProvider(projectStateDir, defaultAgentProvider);
  }

  return { projectConfig, projectStateDir };
};

export const ensureWorkspaceGitignore = (workspaceCwd: string) =>
  ensureOctogentGitignoreEntry(workspaceCwd);

export const readWorkspaceSetupSnapshot = (
  workspaceCwd: string,
  projectStateDir: string,
): WorkspaceSetupSnapshot => {
  const prerequisites = collectStartupPrerequisiteReport();
  const projectConfig = loadProjectConfig(workspaceCwd);
  const octogentDir = join(workspaceCwd, ".octogent");
  const hasProjectScaffold =
    projectConfig !== null &&
    existsSync(join(octogentDir, "tentacles")) &&
    existsSync(join(octogentDir, "worktrees")) &&
    existsSync(join(projectStateDir, "state"));
  const hasGitignore = hasOctogentGitignoreEntry(workspaceCwd);
  const tentacles = readDeckTentacles(workspaceCwd, projectStateDir);
  const tentacleCount = tentacles.length;
  const hasAnyTentacles = tentacleCount > 0;
  const setupState = readSetupState(projectStateDir);
  const isFirstRun = !hasAnyTentacles && !setupState.tentaclesInitializedAt;
  const verifiedSteps = setupState.verifiedSteps ?? {};
  const isCodexVerified = Boolean(verifiedSteps["check-codex"]);
  const isClaudeVerified = Boolean(verifiedSteps["check-claude"]);
  const isGitVerified = Boolean(verifiedSteps["check-git"]);
  const isCurlVerified = Boolean(verifiedSteps["check-curl"]);
  const hasCodex = prerequisites.availability.codex;
  const hasClaudeCode = prerequisites.availability.claude;
  const hasGit = prerequisites.availability.git;
  const hasCurl = prerequisites.availability.curl;
  const hasCodexHooks = hasOctogentCodexHooks(workspaceCwd);
  const providerResolution = resolveDefaultAgentProvider(
    projectStateDir,
    prerequisites.availability,
  );

  const codexStep: WorkspaceSetupStep = {
    id: "check-codex",
    title: "Check Codex",
    description: "Verify the Codex workflow is available on this machine.",
    complete: hasCodex && isCodexVerified && hasCodexHooks,
    required: providerResolution.defaultAgentProvider === "codex",
    actionLabel: "Check Codex",
    statusText: hasCodex
      ? isCodexVerified && hasCodexHooks
        ? "Codex is available and Octogent hooks are installed."
        : hasCodexHooks
          ? "Confirm Codex before using it as the planner."
          : "Install Octogent Codex hooks before using Codex as the planner."
      : "Codex is unavailable.",
    guidance: hasCodex
      ? isCodexVerified
        ? hasCodexHooks
          ? null
          : "Initialize the workspace to install Octogent Codex hooks, then review them with `/hooks` if Codex prompts."
        : "Click to verify the Codex workflow on this machine."
      : "Install Codex and run `codex login` before using Codex terminals.",
    command: hasCodex ? null : "codex login",
  };

  const claudeStep: WorkspaceSetupStep = {
    id: "check-claude",
    title: "Check Claude Code",
    description: "Verify the Claude Code workflow is available on this machine.",
    complete: hasClaudeCode && isClaudeVerified,
    required: providerResolution.defaultAgentProvider === "claude-code",
    actionLabel: "Check Claude Code",
    statusText: hasClaudeCode
      ? isClaudeVerified
        ? "Claude Code is available."
        : "Confirm Claude Code before using it as the planner."
      : "Claude Code is unavailable.",
    guidance: hasClaudeCode
      ? isClaudeVerified
        ? null
        : "Click to verify the Claude Code workflow on this machine."
      : "Install Claude Code and log in before using Claude terminals.",
    command: hasClaudeCode ? null : "claude login",
  };

  const providerSteps =
    providerResolution.defaultAgentProvider === "codex"
      ? [codexStep, claudeStep]
      : [claudeStep, codexStep];

  const steps: WorkspaceSetupStep[] = [
    {
      id: "initialize-workspace",
      title: "Initialize workspace",
      description: "Create Octogent project files and runtime directories.",
      complete: hasProjectScaffold,
      required: true,
      actionLabel: "Initialize workspace",
      statusText: hasProjectScaffold
        ? "Workspace files are ready."
        : "Create .octogent project files before continuing.",
      guidance: hasProjectScaffold
        ? null
        : "Workspace initialization failed. Run the Octogent initializer in this repository.",
      command: hasProjectScaffold ? null : "octogent init",
    },
    {
      id: "ensure-gitignore",
      title: "Ignore .octogent",
      description: "Add .octogent to .gitignore, or create .gitignore when it is missing.",
      complete: hasGitignore,
      required: true,
      actionLabel: "Update .gitignore",
      statusText: hasGitignore
        ? ".gitignore covers .octogent."
        : "Add .octogent to .gitignore before creating tentacles.",
      guidance: hasGitignore
        ? null
        : "Git ignore entry is missing. Create or update .gitignore with the Octogent workspace path.",
      command: hasGitignore ? null : "printf '.octogent\\n' >> .gitignore",
    },
    ...providerSteps,
    {
      id: "check-git",
      title: "Check Git",
      description: "Verify Git is available for worktree-backed tentacles.",
      complete: hasGit && isGitVerified,
      required: false,
      actionLabel: "Check Git",
      statusText: hasGit
        ? isGitVerified
          ? "Git is available."
          : "Confirm Git before launching worktree-backed tentacles."
        : "Git is unavailable.",
      guidance: hasGit
        ? isGitVerified
          ? null
          : "Click to verify Git support for worktree terminal flows."
        : "Install Git to enable worktree terminals and branch flows.",
      command: hasGit ? null : "git --version",
    },
    {
      id: "check-curl",
      title: "Check curl",
      description: "Verify curl is available for Claude hook callbacks.",
      complete: hasCurl && isCurlVerified,
      required: false,
      actionLabel: "Check curl",
      statusText: hasCurl
        ? isCurlVerified
          ? "curl is available."
          : "Confirm curl before using Claude hook callbacks."
        : "curl is unavailable.",
      guidance: hasCurl
        ? isCurlVerified
          ? null
          : "Click to verify hook callback support on this machine."
        : "Install curl to restore Claude hook callbacks.",
      command: hasCurl ? null : "curl --version",
    },
    {
      id: "create-tentacles",
      title: "Create tentacles",
      description: "Create at least one tentacle before launching a coding agent.",
      complete: hasAnyTentacles,
      required: true,
      actionLabel: null,
      statusText: hasAnyTentacles
        ? `${tentacleCount} tentacle${tentacleCount === 1 ? "" : "s"} ready.`
        : "Create your first tentacle to continue.",
      guidance: hasAnyTentacles
        ? null
        : "Use the planner or manual creation to add at least one tentacle.",
      command: null,
    },
  ];

  return {
    isFirstRun,
    shouldShowSetupCard: isFirstRun || (!hasAnyTentacles && (!hasProjectScaffold || !hasGitignore)),
    defaultAgentProvider: providerResolution.defaultAgentProvider,
    configuredAgentProvider: providerResolution.configuredAgentProvider,
    needsProviderSelection: providerResolution.needsProviderSelection,
    providerChoices: providerResolution.providerChoices,
    hasAnyTentacles,
    tentacleCount,
    steps,
  };
};

export { setDefaultAgentProvider };
