export type StoredTaskBrief = {
  taskId: string;
  agentId: number;
  agentName: string;
  title: string;
  objective: string;
  expectedOutput?: string;
  acceptanceCriteria?: string;
  amount: string;
  tokenSymbol: string;
  deadlineLabel: string;
  txHash?: string;
  createdAt: number;
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

export function saveTaskBrief(brief: StoredTaskBrief) {
  const map = readMap();
  map[brief.taskId] = brief;
  writeMap(map);
}

export function getTaskBrief(taskId: string): StoredTaskBrief | null {
  const map = readMap();
  return map[taskId] ?? null;
}

export function getAllTaskBriefs(): Record<string, StoredTaskBrief> {
  return readMap();
}
