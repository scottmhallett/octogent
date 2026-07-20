import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  mergeUsageChartResponses,
  scanOctogentTranscriptUsageChart,
} from "../src/claudeSessionScanner";

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = () => {
  const directory = mkdtempSync(join(tmpdir(), "octogent-usage-test-"));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("scanOctogentTranscriptUsageChart", () => {
  it("estimates daily usage from provider-neutral transcript events", async () => {
    const transcriptDirectory = createTemporaryDirectory();
    mkdirSync(transcriptDirectory, { recursive: true });
    writeFileSync(
      join(transcriptDirectory, `${encodeURIComponent("codex-terminal-1")}.jsonl`),
      [
        {
          type: "session_start",
          eventId: "codex-terminal-1:1",
          sessionId: "codex-terminal-1",
          tentacleId: "codex-terminal-1",
          timestamp: "2026-03-06T10:00:00.000Z",
        },
        {
          type: "input_submit",
          eventId: "codex-terminal-1:2",
          sessionId: "codex-terminal-1",
          tentacleId: "codex-terminal-1",
          submitId: "codex-terminal-1:input:2",
          text: "inspect repo",
          timestamp: "2026-03-06T10:00:01.000Z",
        },
        {
          type: "output_chunk",
          eventId: "codex-terminal-1:3",
          sessionId: "codex-terminal-1",
          tentacleId: "codex-terminal-1",
          chunkId: "codex-terminal-1:output:3",
          text: "\u001b[32mFound package.json\u001b[0m",
          timestamp: "2026-03-06T10:00:02.000Z",
        },
      ]
        .map((event) => JSON.stringify(event))
        .join("\n"),
      "utf8",
    );

    const result = await scanOctogentTranscriptUsageChart(transcriptDirectory, "/tmp/octogent");

    expect(result).toMatchObject({
      source: "octogent-transcript-estimate",
      estimated: true,
      models: ["codex-estimate"],
      days: [
        {
          date: "2026-03-06",
          totalTokens: 8,
          sessions: 1,
        },
      ],
    });
  });
});

describe("mergeUsageChartResponses", () => {
  it("keeps Claude history and Codex transcript estimates in mixed-provider charts", () => {
    const result = mergeUsageChartResponses(
      {
        source: "claude-session-history",
        estimated: false,
        projects: ["octogent"],
        models: ["claude-sonnet"],
        days: [
          {
            date: "2026-03-06",
            totalTokens: 100,
            projects: [{ key: "octogent", tokens: 100 }],
            models: [{ key: "claude-sonnet", tokens: 100 }],
            sessions: 1,
          },
        ],
      },
      {
        source: "octogent-transcript-estimate",
        estimated: true,
        projects: ["octogent"],
        models: ["codex-estimate"],
        days: [
          {
            date: "2026-03-06",
            totalTokens: 25,
            projects: [{ key: "octogent", tokens: 25 }],
            models: [{ key: "codex-estimate", tokens: 25 }],
            sessions: 1,
          },
          {
            date: "2026-03-07",
            totalTokens: 40,
            projects: [{ key: "octogent", tokens: 40 }],
            models: [{ key: "codex-estimate", tokens: 40 }],
            sessions: 1,
          },
        ],
      },
    );

    expect(result).toMatchObject({
      source: "mixed",
      estimated: true,
      projects: ["octogent"],
      models: ["claude-sonnet", "codex-estimate"],
      days: [
        {
          date: "2026-03-06",
          totalTokens: 125,
          sessions: 2,
          projects: [{ key: "octogent", tokens: 125 }],
          models: [
            { key: "claude-sonnet", tokens: 100 },
            { key: "codex-estimate", tokens: 25 },
          ],
        },
        {
          date: "2026-03-07",
          totalTokens: 40,
          sessions: 1,
        },
      ],
    });
  });
});
