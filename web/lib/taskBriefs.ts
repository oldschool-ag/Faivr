export type StoredTaskBrief = {
  taskId: string;
  agentId: number;
  agentName: string;
  title: string;
  objective: string;
  expectedOutput?: string;
  acceptanceCriteria?: string;
  amount?: string;
  tokenSymbol: string;
  deadlineLabel: string;
  pricingMode?: string;
  briefHash?: string;
  fundingTxHash?: string;
  settlementTxHash?: string;
  reclaimTxHash?: string;
  createdAt: number;
};

export type TaskBriefPayload = {
  agentId: number;
  agentName: string;
  title: string;
  objective: string;
  expectedOutput?: string;
  acceptanceCriteria?: string;
  amount?: string;
  tokenSymbol: string;
  deadlineLabel: string;
  pricingMode?: string;
};

const STORAGE_KEY = "faivr.task-briefs.v1";

function readMap(): Record<string, StoredTaskBrief> {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, StoredTaskBrief>;
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, StoredTaskBrief>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function buildTaskBriefPayload(payload: TaskBriefPayload) {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    ...payload,
  };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function computeTaskBriefHash(payload: TaskBriefPayload): Promise<string | null> {
  if (typeof window === "undefined" || !window.crypto?.subtle) return null;

  const normalized = JSON.stringify(buildTaskBriefPayload(payload));
  const encoded = new TextEncoder().encode(normalized);
  const digest = await window.crypto.subtle.digest("SHA-256", encoded);
  return bytesToHex(new Uint8Array(digest));
}

export function downloadTaskBriefJson(payload: TaskBriefPayload) {
  if (typeof window === "undefined") return;

  const blob = new Blob([JSON.stringify(buildTaskBriefPayload(payload), null, 2)], {
    type: "application/json",
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `faivr-task-brief-${payload.agentId}.json`;
  link.click();
  window.URL.revokeObjectURL(url);
}

export function saveTaskBrief(brief: StoredTaskBrief) {
  const map = readMap();
  map[brief.taskId] = brief;
  writeMap(map);
}

export function updateTaskBriefProof(
  taskId: string,
  patch: Partial<Pick<StoredTaskBrief, "briefHash" | "fundingTxHash" | "settlementTxHash" | "reclaimTxHash">>,
) {
  const map = readMap();
  const current = map[taskId];
  if (!current) return;
  map[taskId] = { ...current, ...patch };
  writeMap(map);
}

export function getTaskBrief(taskId: string): StoredTaskBrief | null {
  const map = readMap();
  return map[taskId] ?? null;
}

export function getAllTaskBriefs(): Record<string, StoredTaskBrief> {
  return readMap();
}
