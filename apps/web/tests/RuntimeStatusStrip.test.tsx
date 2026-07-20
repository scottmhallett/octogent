import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RuntimeStatusStrip } from "../src/components/RuntimeStatusStrip";

describe("RuntimeStatusStrip", () => {
  it("shows loading placeholders before provider usage loads", () => {
    render(
      <RuntimeStatusStrip
        sparklinePoints=""
        usageData={null}
        claudeUsage={null}
        codexUsage={null}
      />,
    );

    const usage = screen.getByLabelText("Agent usage limits");
    expect(within(usage).getAllByText("···")).toHaveLength(4);
  });

  it("uses provider-specific labels for oauth-backed usage", () => {
    render(
      <RuntimeStatusStrip
        sparklinePoints=""
        usageData={null}
        claudeUsage={{
          status: "ok",
          source: "oauth-api",
          fetchedAt: "2026-04-09T10:00:00.000Z",
          primaryUsedPercent: 14,
          secondaryUsedPercent: 52,
        }}
        codexUsage={{
          status: "ok",
          source: "oauth-api",
          fetchedAt: "2026-04-09T10:00:00.000Z",
          primaryUsedPercent: 21,
          secondaryUsedPercent: 44,
        }}
      />,
    );

    const usage = screen.getByLabelText("Agent usage limits");
    expect(within(usage).getByText("Claude")).toBeInTheDocument();
    expect(within(usage).getByText("Codex")).toBeInTheDocument();
    expect(within(usage).getAllByText("5h")).toHaveLength(2);
    expect(within(usage).getByText("14%")).toBeInTheDocument();
    expect(within(usage).getByText("21%")).toBeInTheDocument();
    expect(within(usage).getByText("44%")).toBeInTheDocument();
    expect(within(usage).getByText("52%")).toBeInTheDocument();
  });

  it("does not label an empty token history chart as Claude-specific", () => {
    render(
      <RuntimeStatusStrip
        sparklinePoints=""
        usageData={null}
        claudeUsage={null}
        codexUsage={null}
      />,
    );

    expect(screen.getByLabelText("Token usage history unavailable")).toBeInTheDocument();
    expect(screen.getByText("TOKEN HISTORY —")).toBeInTheDocument();
    expect(screen.queryByText("CLAUDE TOKENS/DAY —")).toBeNull();
  });

  it("labels transcript-derived token history as estimated", () => {
    render(
      <RuntimeStatusStrip
        sparklinePoints=""
        usageData={{
          days: [
            {
              date: "2026-03-06",
              totalTokens: 42,
              projects: [],
              models: [],
              sessions: 1,
            },
          ],
          projects: [],
          models: [],
          source: "octogent-transcript-estimate",
          estimated: true,
        }}
        claudeUsage={null}
        codexUsage={null}
      />,
    );

    expect(screen.getByLabelText("Estimated token usage last 30 days")).toBeInTheDocument();
    expect(screen.getByText("EST. TOKENS/DAY · LAST 30 DAYS")).toBeInTheDocument();
  });

  it("renders sparse token history as narrow day columns", () => {
    render(
      <RuntimeStatusStrip
        sparklinePoints=""
        usageData={{
          days: [
            {
              date: "2026-03-06",
              totalTokens: 42,
              projects: [],
              models: [],
              sessions: 1,
            },
          ],
          projects: [],
          models: [],
          source: "octogent-transcript-estimate",
          estimated: true,
        }}
        claudeUsage={null}
        codexUsage={null}
      />,
    );

    const chart = screen.getByLabelText("Estimated token usage last 30 days");
    const rect = chart.querySelector("rect");
    expect(rect?.getAttribute("width")).toBe("4.333333333333333");
  });

  it("hides unavailable Claude usage when Codex usage is available", () => {
    render(
      <RuntimeStatusStrip
        sparklinePoints=""
        usageData={null}
        claudeUsage={{
          status: "unavailable",
          source: "none",
          fetchedAt: "2026-04-09T10:00:00.000Z",
          message: "Claude credentials not found. Run `claude login`.",
        }}
        codexUsage={{
          status: "ok",
          source: "oauth-api",
          fetchedAt: "2026-04-09T10:00:00.000Z",
          primaryUsedPercent: 21,
          secondaryUsedPercent: 44,
        }}
      />,
    );

    const usage = screen.getByLabelText("Agent usage limits");
    expect(within(usage).queryByText("Claude")).toBeNull();
    expect(within(usage).getByText("Codex")).toBeInTheDocument();
    expect(within(usage).getByText("21%")).toBeInTheDocument();
    expect(within(usage).getByText("44%")).toBeInTheDocument();
  });

  it("shows unavailable values instead of a permanent loading state", () => {
    render(
      <RuntimeStatusStrip
        sparklinePoints=""
        usageData={null}
        claudeUsage={{
          status: "unavailable",
          source: "none",
          fetchedAt: "2026-04-09T10:00:00.000Z",
          message: "Claude credentials not found. Run `claude login`.",
        }}
        codexUsage={{
          status: "unavailable",
          source: "none",
          fetchedAt: "2026-04-09T10:00:00.000Z",
          message: "Codex credentials not found. Run `codex login`.",
        }}
      />,
    );

    const usage = screen.getByLabelText("Agent usage limits");
    expect(within(usage).getAllByText("NA")).toHaveLength(4);
    expect(within(usage).queryByText("···")).toBeNull();
  });

  it("marks the refresh button as rotating while provider usage is refreshing", () => {
    render(
      <RuntimeStatusStrip
        sparklinePoints=""
        usageData={null}
        claudeUsage={null}
        codexUsage={null}
        isRefreshingClaudeUsage
        onRefreshClaudeUsage={() => {}}
        onRefreshCodexUsage={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Refresh agent usage" })).toHaveAttribute(
      "data-refreshing",
      "true",
    );
  });
});
