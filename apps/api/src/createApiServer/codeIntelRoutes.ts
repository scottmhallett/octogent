import type { ApiRouteHandler } from "./routeHelpers";
import { readJsonBodyOrWriteError, writeJson, writeMethodNotAllowed } from "./routeHelpers";

const extractApplyPatchFilePaths = (command: string): string[] => {
  const paths: string[] = [];
  const seen = new Set<string>();

  for (const line of command.split(/\r?\n/)) {
    const match = line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/);
    if (!match) continue;

    const filePath = match[1]?.trim();
    if (!filePath || seen.has(filePath)) continue;
    seen.add(filePath);
    paths.push(filePath);
  }

  return paths;
};

const extractFilePaths = (toolName: string, toolInput: Record<string, unknown>): string[] => {
  if (typeof toolInput.file_path === "string" && toolInput.file_path.length > 0) {
    return [toolInput.file_path];
  }

  if (typeof toolInput.path === "string" && toolInput.path.length > 0) {
    return [toolInput.path];
  }

  if (toolName === "apply_patch" && typeof toolInput.command === "string") {
    return extractApplyPatchFilePaths(toolInput.command);
  }

  return [];
};

export const handleCodeIntelEventsRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { codeIntelStore },
) => {
  if (requestUrl.pathname !== "/api/code-intel/events") {
    return false;
  }

  if (request.method === "POST") {
    const body = await readJsonBodyOrWriteError(request, response, corsOrigin);
    if (!body.ok) return true;

    const payload = body.payload as Record<string, unknown> | null;
    const toolName =
      payload && typeof payload.tool_name === "string"
        ? payload.tool_name
        : payload && typeof payload.tool === "string"
          ? payload.tool
          : "";
    const toolInput =
      payload && typeof payload.tool_input === "object" && payload.tool_input !== null
        ? (payload.tool_input as Record<string, unknown>)
        : payload && typeof payload.input === "object" && payload.input !== null
          ? (payload.input as Record<string, unknown>)
          : {};
    const filePaths = extractFilePaths(toolName, toolInput);

    if (filePaths.length === 0) {
      writeJson(response, 200, { ok: true, skipped: true }, corsOrigin);
      return true;
    }

    // Prefer Octogent session ID from header, fall back to Claude Code's own session_id from payload
    const octogentSession =
      typeof request.headers["x-octogent-session"] === "string" &&
      request.headers["x-octogent-session"].length > 0
        ? request.headers["x-octogent-session"]
        : undefined;
    const claudeSession =
      payload && typeof payload.session_id === "string" && payload.session_id.length > 0
        ? payload.session_id
        : undefined;
    const sessionId = octogentSession ?? claudeSession ?? "unknown";

    for (const filePath of filePaths) {
      await codeIntelStore.append({
        ts: new Date().toISOString(),
        sessionId,
        tool: toolName,
        file: filePath,
      });
    }

    writeJson(response, 200, { ok: true }, corsOrigin);
    return true;
  }

  if (request.method === "GET") {
    const events = await codeIntelStore.readAll();
    writeJson(response, 200, { events }, corsOrigin);
    return true;
  }

  writeMethodNotAllowed(response, corsOrigin);
  return true;
};
