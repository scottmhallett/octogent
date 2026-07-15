import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { setDefaultAgentProvider } from "../src/setupState";
import { resolveDefaultAgentProvider } from "../src/setupStatus";

const availability = (
  overrides: Partial<Record<"claude" | "codex" | "git" | "gh" | "curl", boolean>>,
) => ({
  claude: false,
  codex: false,
  git: false,
  gh: false,
  curl: false,
  ...overrides,
});

describe("default agent provider resolution", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const createStateDir = () => {
    const dir = mkdtempSync(join(tmpdir(), "octogent-provider-"));
    tempDirs.push(dir);
    return dir;
  };

  it("auto-selects Codex when it is the only available provider", () => {
    const stateDir = createStateDir();

    const result = resolveDefaultAgentProvider(stateDir, availability({ codex: true }));

    expect(result.defaultAgentProvider).toBe("codex");
    expect(result.configuredAgentProvider).toBeNull();
    expect(result.needsProviderSelection).toBe(false);
  });

  it("requires explicit selection when both providers are available", () => {
    const stateDir = createStateDir();

    const result = resolveDefaultAgentProvider(
      stateDir,
      availability({ claude: true, codex: true }),
    );

    expect(result.defaultAgentProvider).toBe("claude-code");
    expect(result.configuredAgentProvider).toBeNull();
    expect(result.needsProviderSelection).toBe(true);
  });

  it("uses a persisted provider selection over availability defaults", () => {
    const stateDir = createStateDir();
    setDefaultAgentProvider(stateDir, "codex");

    const result = resolveDefaultAgentProvider(
      stateDir,
      availability({ claude: true, codex: true }),
    );

    expect(result.defaultAgentProvider).toBe("codex");
    expect(result.configuredAgentProvider).toBe("codex");
    expect(result.needsProviderSelection).toBe(false);
  });
});
