import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CLAUDE_PROJECTS_DIR = join(homedir(), ".claude", "projects");

export type UsageSlice = {
  key: string;
  tokens: number;
};

export type UsageDayEntry = {
  date: string;
  totalTokens: number;
  projects: UsageSlice[];
  models: UsageSlice[];
  sessions: number;
};

export type UsageChartResponse = {
  days: UsageDayEntry[];
  projects: string[];
  models: string[];
  source?: "claude-session-history" | "octogent-transcript-estimate" | "mixed";
  estimated?: boolean;
};

type AssistantEvent = {
  type: string;
  timestamp: string;
  sessionId: string;
  message?: {
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
};

const isAssistantEvent = (value: unknown): value is AssistantEvent => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.type === "assistant" && typeof record.timestamp === "string";
};

const toDateKey = (timestamp: string): string | null => {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
};

type DayBucket = {
  totalTokens: number;
  projectTokens: Map<string, number>;
  modelTokens: Map<string, number>;
  sessions: Set<string>;
};

const ESCAPE_CHARACTER = String.fromCharCode(27);
const BELL_CHARACTER = String.fromCharCode(7);
const ANSI_CSI_RE = new RegExp(`${ESCAPE_CHARACTER}\\[[0-?]*[ -/]*[@-~]`, "g");
const ANSI_OSC_RE = new RegExp(
  `${ESCAPE_CHARACTER}\\][^${BELL_CHARACTER}]*(?:${BELL_CHARACTER}|${ESCAPE_CHARACTER}\\\\)`,
  "g",
);
const ANSI_SINGLE_CHAR_RE = new RegExp(`${ESCAPE_CHARACTER}[@-_]`, "g");

const stripControlCharacters = (value: string): string =>
  Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 10 || code === 9 || (code > 31 && code !== 127);
    })
    .join("");

const normalizeTranscriptUsageText = (value: string): string =>
  stripControlCharacters(
    value
      .replaceAll(`${ESCAPE_CHARACTER}[200~`, "")
      .replaceAll(`${ESCAPE_CHARACTER}[201~`, "")
      .replace(ANSI_OSC_RE, "")
      .replace(ANSI_CSI_RE, "")
      .replace(ANSI_SINGLE_CHAR_RE, "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n"),
  ).trim();

const estimateTokensFromText = (value: string): number =>
  Math.max(0, Math.ceil(normalizeTranscriptUsageText(value).length / 4));

const ensureBucket = (buckets: Map<string, DayBucket>, dateKey: string): DayBucket => {
  let bucket = buckets.get(dateKey);
  if (!bucket) {
    bucket = {
      totalTokens: 0,
      projectTokens: new Map(),
      modelTokens: new Map(),
      sessions: new Set(),
    };
    buckets.set(dateKey, bucket);
  }
  return bucket;
};

const scanJsonlFile = async (
  filePath: string,
  projectLabel: string,
  buckets: Map<string, DayBucket>,
): Promise<void> => {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    return;
  }

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (!isAssistantEvent(parsed)) continue;

    const dateKey = toDateKey(parsed.timestamp);
    if (!dateKey) continue;

    const usage = parsed.message?.usage;
    if (!usage) continue;

    const totalTokens =
      (usage.input_tokens ?? 0) +
      (usage.output_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0);

    if (totalTokens === 0) continue;

    const bucket = ensureBucket(buckets, dateKey);

    bucket.totalTokens += totalTokens;
    bucket.projectTokens.set(
      projectLabel,
      (bucket.projectTokens.get(projectLabel) ?? 0) + totalTokens,
    );

    const modelKey = parsed.message?.model ?? "unknown";
    bucket.modelTokens.set(modelKey, (bucket.modelTokens.get(modelKey) ?? 0) + totalTokens);

    if (parsed.sessionId) {
      bucket.sessions.add(parsed.sessionId);
    }
  }
};

const scanProjectDirectory = async (
  projectDir: string,
  projectLabel: string,
  buckets: Map<string, DayBucket>,
): Promise<void> => {
  let entries: string[];
  try {
    entries = await readdir(projectDir);
  } catch {
    return;
  }

  const jsonlFiles = entries.filter((entry) => entry.endsWith(".jsonl"));
  await Promise.all(
    jsonlFiles.map((file) => scanJsonlFile(join(projectDir, file), projectLabel, buckets)),
  );
};

const slugToLabel = (slug: string): string => {
  const parts = slug.replace(/^-/, "").split("-");
  const codebaseIndex = parts.findIndex((p) => p.toLowerCase() === "codebase");
  const relevant = codebaseIndex >= 0 ? parts.slice(codebaseIndex + 1) : parts.slice(-1);
  if (relevant.length === 0) return slug;

  const joined = relevant.join("-");
  const worktreeMatch = joined.match(/^(.+?)--.*?-worktrees-(.+)$/);
  if (worktreeMatch) {
    return `${worktreeMatch[1]}/${worktreeMatch[2]}`;
  }
  return joined;
};

const sortedKeys = (totals: Map<string, number>): string[] =>
  Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

const mapToSlices = (map: Map<string, number>): UsageSlice[] =>
  Array.from(map.entries())
    .map(([key, tokens]) => ({ key, tokens }))
    .sort((a, b) => b.tokens - a.tokens);

const projectSlugFromCwd = (cwd: string): string => cwd.replace(/\//g, "-");

const buildUsageChartResponse = (
  buckets: Map<string, DayBucket>,
  source: NonNullable<UsageChartResponse["source"]>,
  estimated = false,
): UsageChartResponse => {
  const projectTotals = new Map<string, number>();
  const modelTotals = new Map<string, number>();

  const days: UsageDayEntry[] = Array.from(buckets.entries())
    .map(([date, bucket]) => {
      for (const [p, t] of bucket.projectTokens) {
        projectTotals.set(p, (projectTotals.get(p) ?? 0) + t);
      }
      for (const [m, t] of bucket.modelTokens) {
        modelTotals.set(m, (modelTotals.get(m) ?? 0) + t);
      }
      return {
        date,
        totalTokens: bucket.totalTokens,
        projects: mapToSlices(bucket.projectTokens),
        models: mapToSlices(bucket.modelTokens),
        sessions: bucket.sessions.size,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    days,
    projects: sortedKeys(projectTotals),
    models: sortedKeys(modelTotals),
    source,
    estimated,
  };
};

const responseHasUsage = (response: UsageChartResponse): boolean =>
  response.days.some((day) => day.totalTokens > 0);

const mergeUsageSlices = (target: Map<string, number>, slices: UsageSlice[]) => {
  for (const slice of slices) {
    target.set(slice.key, (target.get(slice.key) ?? 0) + slice.tokens);
  }
};

export const mergeUsageChartResponses = (
  claudeUsage: UsageChartResponse,
  transcriptUsage: UsageChartResponse,
): UsageChartResponse => {
  if (!responseHasUsage(claudeUsage)) {
    return transcriptUsage;
  }
  if (!responseHasUsage(transcriptUsage)) {
    return claudeUsage;
  }

  const buckets = new Map<
    string,
    {
      totalTokens: number;
      projectTokens: Map<string, number>;
      modelTokens: Map<string, number>;
      sessions: number;
    }
  >();

  const addDay = (day: UsageDayEntry) => {
    let bucket = buckets.get(day.date);
    if (!bucket) {
      bucket = {
        totalTokens: 0,
        projectTokens: new Map(),
        modelTokens: new Map(),
        sessions: 0,
      };
      buckets.set(day.date, bucket);
    }

    bucket.totalTokens += day.totalTokens;
    bucket.sessions += day.sessions;
    mergeUsageSlices(bucket.projectTokens, day.projects);
    mergeUsageSlices(bucket.modelTokens, day.models);
  };

  for (const day of claudeUsage.days) {
    addDay(day);
  }
  for (const day of transcriptUsage.days) {
    addDay(day);
  }

  const projectTotals = new Map<string, number>();
  const modelTotals = new Map<string, number>();
  const days: UsageDayEntry[] = Array.from(buckets.entries())
    .map(([date, bucket]) => {
      for (const [project, tokens] of bucket.projectTokens) {
        projectTotals.set(project, (projectTotals.get(project) ?? 0) + tokens);
      }
      for (const [model, tokens] of bucket.modelTokens) {
        modelTotals.set(model, (modelTotals.get(model) ?? 0) + tokens);
      }

      return {
        date,
        totalTokens: bucket.totalTokens,
        projects: mapToSlices(bucket.projectTokens),
        models: mapToSlices(bucket.modelTokens),
        sessions: bucket.sessions,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    days,
    projects: sortedKeys(projectTotals),
    models: sortedKeys(modelTotals),
    source: "mixed",
    estimated: true,
  };
};

let cachedResult: { response: UsageChartResponse; fetchedAt: number; cacheKey: string } | null =
  null;
const CACHE_TTL_MS = 120_000;

export const scanClaudeUsageChart = async (
  scope: "all" | "project",
  workspaceCwd: string,
): Promise<UsageChartResponse> => {
  const projectSlug = scope === "project" ? projectSlugFromCwd(workspaceCwd) : null;
  const cacheKey = `${scope}:${projectSlug ?? "all"}`;

  if (
    cachedResult &&
    Date.now() - cachedResult.fetchedAt < CACHE_TTL_MS &&
    cachedResult.cacheKey === cacheKey
  ) {
    return cachedResult.response;
  }

  const buckets = new Map<string, DayBucket>();

  if (scope === "project" && projectSlug) {
    const label = slugToLabel(projectSlug);
    await scanProjectDirectory(join(CLAUDE_PROJECTS_DIR, projectSlug), label, buckets);
  } else {
    let projectDirs: string[];
    try {
      projectDirs = await readdir(CLAUDE_PROJECTS_DIR);
    } catch {
      projectDirs = [];
    }
    await Promise.all(
      projectDirs.map((dir) =>
        scanProjectDirectory(join(CLAUDE_PROJECTS_DIR, dir), slugToLabel(dir), buckets),
      ),
    );
  }

  const response = buildUsageChartResponse(buckets, "claude-session-history", false);
  cachedResult = { response, fetchedAt: Date.now(), cacheKey };
  return response;
};

const isTranscriptUsageEvent = (
  value: unknown,
): value is {
  sessionId: string;
  timestamp: string;
  type: "input_submit" | "output_chunk";
  text: string;
} => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.type === "input_submit" || record.type === "output_chunk") &&
    typeof record.sessionId === "string" &&
    typeof record.timestamp === "string" &&
    typeof record.text === "string"
  );
};

const scanTranscriptUsageFile = async (
  filePath: string,
  projectLabel: string,
  buckets: Map<string, DayBucket>,
): Promise<void> => {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    return;
  }

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (!isTranscriptUsageEvent(parsed)) continue;

    const dateKey = toDateKey(parsed.timestamp);
    if (!dateKey) continue;

    const totalTokens = estimateTokensFromText(parsed.text);
    if (totalTokens === 0) continue;

    const bucket = ensureBucket(buckets, dateKey);
    bucket.totalTokens += totalTokens;
    bucket.projectTokens.set(
      projectLabel,
      (bucket.projectTokens.get(projectLabel) ?? 0) + totalTokens,
    );
    bucket.modelTokens.set(
      "codex-estimate",
      (bucket.modelTokens.get("codex-estimate") ?? 0) + totalTokens,
    );
    bucket.sessions.add(parsed.sessionId);
  }
};

export const scanOctogentTranscriptUsageChart = async (
  transcriptDirectoryPath: string,
  workspaceCwd: string,
): Promise<UsageChartResponse> => {
  const buckets = new Map<string, DayBucket>();
  let files: string[];
  try {
    files = await readdir(transcriptDirectoryPath);
  } catch {
    return buildUsageChartResponse(buckets, "octogent-transcript-estimate", true);
  }

  const projectLabel = slugToLabel(projectSlugFromCwd(workspaceCwd));
  await Promise.all(
    files
      .filter((file) => file.endsWith(".jsonl"))
      .map((file) =>
        scanTranscriptUsageFile(join(transcriptDirectoryPath, file), projectLabel, buckets),
      ),
  );

  return buildUsageChartResponse(buckets, "octogent-transcript-estimate", true);
};

export const scanUsageChart = async (
  scope: "all" | "project",
  workspaceCwd: string,
  transcriptDirectoryPath: string,
): Promise<UsageChartResponse> => {
  const [claudeUsage, transcriptUsage] = await Promise.all([
    scanClaudeUsageChart(scope, workspaceCwd),
    scanOctogentTranscriptUsageChart(transcriptDirectoryPath, workspaceCwd),
  ]);
  return mergeUsageChartResponses(claudeUsage, transcriptUsage);
};
