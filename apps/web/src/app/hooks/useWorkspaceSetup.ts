import type {
  TerminalAgentProvider,
  WorkspaceSetupSnapshot,
  WorkspaceSetupStepId,
} from "@octogent/core";
import { useCallback, useEffect, useState } from "react";

import { buildWorkspaceSetupStepUrl, buildWorkspaceSetupUrl } from "../../runtime/runtimeEndpoints";

type UseWorkspaceSetupResult = {
  workspaceSetup: WorkspaceSetupSnapshot | null;
  isWorkspaceSetupLoading: boolean;
  workspaceSetupError: string | null;
  refreshWorkspaceSetup: () => Promise<WorkspaceSetupSnapshot | null>;
  runWorkspaceSetupStep: (stepId: WorkspaceSetupStepId) => Promise<WorkspaceSetupSnapshot | null>;
  setDefaultAgentProvider: (
    defaultAgentProvider: TerminalAgentProvider,
  ) => Promise<WorkspaceSetupSnapshot | null>;
};

const readErrorMessage = async (response: Response, fallback: string) => {
  try {
    const payload = (await response.json()) as { error?: unknown };
    return typeof payload.error === "string" ? payload.error : fallback;
  } catch (_error) {
    return fallback;
  }
};

export const useWorkspaceSetup = (): UseWorkspaceSetupResult => {
  const [workspaceSetup, setWorkspaceSetup] = useState<WorkspaceSetupSnapshot | null>(null);
  const [isWorkspaceSetupLoading, setIsWorkspaceSetupLoading] = useState(true);
  const [workspaceSetupError, setWorkspaceSetupError] = useState<string | null>(null);

  const refreshWorkspaceSetup = useCallback(async () => {
    try {
      setWorkspaceSetupError(null);
      const response = await fetch(buildWorkspaceSetupUrl(), {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Unable to load workspace setup."));
      }
      const payload = (await response.json()) as WorkspaceSetupSnapshot;
      setWorkspaceSetup(payload);
      return payload;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load workspace setup.";
      setWorkspaceSetupError(message);
      return null;
    } finally {
      setIsWorkspaceSetupLoading(false);
    }
  }, []);

  const runWorkspaceSetupStep = useCallback(async (stepId: WorkspaceSetupStepId) => {
    try {
      setWorkspaceSetupError(null);
      const response = await fetch(buildWorkspaceSetupStepUrl(stepId), {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, `Unable to run ${stepId}.`));
      }
      const payload = (await response.json()) as WorkspaceSetupSnapshot;
      setWorkspaceSetup(payload);
      return payload;
    } catch (error) {
      const message = error instanceof Error ? error.message : `Unable to run ${stepId}.`;
      setWorkspaceSetupError(message);
      return null;
    }
  }, []);

  const setDefaultAgentProvider = useCallback(
    async (defaultAgentProvider: TerminalAgentProvider) => {
      try {
        setWorkspaceSetupError(null);
        const response = await fetch(buildWorkspaceSetupUrl(), {
          method: "PATCH",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ defaultAgentProvider }),
        });
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, "Unable to update provider."));
        }
        const payload = (await response.json()) as WorkspaceSetupSnapshot;
        setWorkspaceSetup(payload);
        return payload;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to update provider.";
        setWorkspaceSetupError(message);
        return null;
      }
    },
    [],
  );

  useEffect(() => {
    void refreshWorkspaceSetup();
  }, [refreshWorkspaceSetup]);

  return {
    workspaceSetup,
    isWorkspaceSetupLoading,
    workspaceSetupError,
    refreshWorkspaceSetup,
    runWorkspaceSetupStep,
    setDefaultAgentProvider,
  };
};
