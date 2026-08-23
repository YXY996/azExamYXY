import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export type AgentTaskStatus = "running" | "queued" | "completed" | "blocked" | "failed" | "stale" | "unknown";

export type AgentTask = {
  id: string;
  project_id: string;
  agent: "claude-code" | "codex" | "worker" | "unknown";
  title: string;
  status: AgentTaskStatus;
  gateway?: string;
  current?: number;
  end?: number;
  range?: string;
  message?: string;
  updated_at?: string;
  source: string;
};

export type AgentProject = {
  id: string;
  name: string;
  updated_at?: string;
  tasks: AgentTask[];
};

export type AgentMonitorSnapshot = {
  generated_at: string;
  totals: Record<AgentTaskStatus, number>;
  projects: AgentProject[];
};

type JsonRecord = Record<string, unknown>;

async function readJson(filePath: string): Promise<JsonRecord | null> {
  try {
    return JSON.parse((await readFile(filePath, "utf8")).replace(/^\uFEFF/, "")) as JsonRecord;
  } catch {
    return null;
  }
}

async function directories(parent: string): Promise<string[]> {
  try {
    return (await readdir(parent, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => path.join(parent, entry.name));
  } catch {
    return [];
  }
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberOf(value: unknown): number | undefined {
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}

export function normalizeTaskStatus(value: unknown, updatedAt?: string, now = Date.now()): AgentTaskStatus {
  const raw = String(value ?? "unknown").toLowerCase();
  const base: AgentTaskStatus = raw === "validated" || raw === "succeeded" || raw === "complete" || raw === "completed"
    ? "completed"
    : raw === "running" || raw === "processing" ? "running"
      : raw === "queued" || raw === "preparing" ? "queued"
        : raw === "blocked" ? "blocked"
          : raw === "failed" || raw === "error" ? "failed" : "unknown";
  if (base === "running" && updatedAt) {
    const age = now - new Date(updatedAt).getTime();
    if (Number.isFinite(age) && age > 60 * 60 * 1000) return "stale";
  }
  return base;
}

function taskFromQueue(projectId: string, relativeSource: string, state: JsonRecord): AgentTask {
  const updatedAt = stringOf(state.updated_at);
  const first = numberOf(state.first ?? state.current_sequence ?? state.progress_current);
  const last = numberOf(state.last);
  const end = numberOf(state.end_sequence ?? state.progress_total);
  return {
    id: `${projectId}:${relativeSource}`,
    project_id: projectId,
    agent: relativeSource.includes("claude") ? "claude-code" : "worker",
    title: relativeSource.includes("microbatch") ? "Claude 微批次队列" : relativeSource.includes("answer-queue") ? "Claude 单题队列" : "后台任务队列",
    status: normalizeTaskStatus(state.status, updatedAt),
    gateway: stringOf(state.gateway),
    current: first,
    end,
    range: first && last ? `${first}–${last}` : first ? String(first) : undefined,
    message: stringOf(state.message),
    updated_at: updatedAt,
    source: relativeSource,
  };
}

async function queueTasks(projectRoot: string, projectId: string): Promise<AgentTask[]> {
  const privateRoot = path.join(projectRoot, "data", "private");
  const taskDirectories = await directories(privateRoot);
  const results: AgentTask[] = [];
  for (const directory of taskDirectories) {
    if (!path.basename(directory).includes("queue")) continue;
    const statePath = path.join(directory, "state.json");
    const state = await readJson(statePath);
    if (state) results.push(taskFromQueue(projectId, path.relative(projectRoot, statePath), state));
  }
  return results;
}

async function latestClaudeRuns(projectRoot: string, projectId: string): Promise<AgentTask[]> {
  const runsRoot = path.join(projectRoot, "data", "private", "claude-runs");
  const taskDirectories = await directories(runsRoot);
  const results: AgentTask[] = [];
  for (const directory of taskDirectories) {
    let metadataFiles: string[] = [];
    try {
      metadataFiles = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort().reverse();
    } catch { continue; }
    const metadata = metadataFiles[0] ? await readJson(path.join(directory, metadataFiles[0])) : null;
    if (!metadata) continue;
    const updatedAt = stringOf(metadata.completed_at) ?? stringOf(metadata.started_at);
    results.push({
      id: `${projectId}:run:${path.basename(directory)}`,
      project_id: projectId,
      agent: "claude-code",
      title: stringOf(metadata.task_id) ?? path.basename(directory),
      status: normalizeTaskStatus(metadata.status, updatedAt),
      gateway: stringOf(metadata.gateway),
      message: numberOf(metadata.exit_code) ? `退出码 ${metadata.exit_code}` : undefined,
      updated_at: updatedAt,
      source: path.relative(projectRoot, directory),
    });
  }
  return results.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, 8);
}

async function workRecordTasks(projectRoot: string, projectId: string): Promise<AgentTask[]> {
  const privateRoot = path.join(projectRoot, "data", "private");
  const queueDirectories = (await directories(privateRoot)).filter((directory) => path.basename(directory).includes("queue"));
  const byTask = new Map<string, AgentTask>();
  for (const directory of queueDirectories) {
    try {
      const lines = (await readFile(path.join(directory, "claude-work-records.jsonl"), "utf8")).split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        let record: JsonRecord;
        try { record = JSON.parse(line) as JsonRecord; } catch { continue; }
        const taskId = stringOf(record.task_id);
        if (!taskId) continue;
        const first = numberOf(record.first);
        const last = numberOf(record.last);
        byTask.set(taskId, {
          id: `${projectId}:record:${taskId}`,
          project_id: projectId,
          agent: "claude-code",
          title: taskId,
          status: normalizeTaskStatus(record.status, stringOf(record.completed_at)),
          gateway: stringOf(record.gateway),
          range: first && last ? `${first}–${last}` : undefined,
          message: stringOf(record.evidence_mode) === "local-visual-to-private-text" ? "本地视觉转私有文本后完成核对" : undefined,
          updated_at: stringOf(record.completed_at),
          source: path.relative(projectRoot, path.join(directory, "claude-work-records.jsonl")),
        });
      }
    } catch {}
  }
  return [...byTask.values()].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, 10);
}

async function projectName(projectRoot: string): Promise<string> {
  try {
    const memory = await readFile(path.join(projectRoot, "PROJECT_MEMORY.md"), "utf8");
    const heading = memory.match(/^#\s+(.+)$/m)?.[1]?.trim();
    if (heading) return heading.replace(/项目记忆$/, "").trim();
  } catch {}
  return path.basename(projectRoot);
}

async function inspectProject(projectRoot: string): Promise<AgentProject | null> {
  try { if (!(await stat(projectRoot)).isDirectory()) return null; } catch { return null; }
  const id = path.basename(projectRoot);
  const records = await workRecordTasks(projectRoot, id);
  const authoritativeIds = new Set(records.map((task) => task.title));
  const runs = (await latestClaudeRuns(projectRoot, id)).filter((task) => !authoritativeIds.has(task.title));
  const queues = (await queueTasks(projectRoot, id)).filter((queue) => !records.some((record) =>
    queue.range && record.range === queue.range && record.status === "completed" &&
    String(record.updated_at) >= String(queue.updated_at),
  ));
  const tasks = [...queues, ...records, ...runs];
  if (!tasks.length && !(await readJson(path.join(projectRoot, "data", "private", "agent-status.json")))) return null;
  return { id, name: await projectName(projectRoot), updated_at: tasks.map((task) => task.updated_at).filter(Boolean).sort().at(-1), tasks };
}

export async function buildAgentMonitorSnapshot(): Promise<AgentMonitorSnapshot> {
  const roots = await directories(path.join(homedir(), ".codex", ".chatgpt-projects"));
  const projects = (await Promise.all(roots.map(inspectProject))).filter((project): project is AgentProject => Boolean(project));
  const totals: Record<AgentTaskStatus, number> = { running: 0, queued: 0, completed: 0, blocked: 0, failed: 0, stale: 0, unknown: 0 };
  for (const task of projects.flatMap((project) => project.tasks)) totals[task.status]++;
  return { generated_at: new Date().toISOString(), totals, projects };
}
