const words: Record<string, string> = {
  "workspace.read": "Read its own workspace",
  "workspace.write": "Write files in its own workspace",
  "exec.sandbox": "Run commands in its own sandbox",
  "net.allowlist": "Reach the internet only through your allowlist",
  "browser.use": "Open web pages and take screenshots in its sandbox",
  "workboard.read": "Read the workboard",
  "workboard.write": "Change the workboard",
  "model.lane:standard": "Use your standard model",
  "model.lane:frontier": "Use your strongest model",
};

export const NEVER_PERMISSIONS = [
  "Acts without a task someone started",
  "Changes its own permissions",
  "Sees other agents' files",
  "Spends money",
] as const;

export function describePermission(permission: string, optional = false, slotQuestion?: string): string {
  let description = words[permission];
  const separator = permission.indexOf(":");
  const kind = permission.slice(0, separator);
  const value = permission.slice(separator + 1);
  const slot = /^\{[^}]+\}$/.test(value);
  if (!description && separator > 0) {
    if (kind === "net.domain") description = slot ? "Reach one website you choose" : `Reach ${value}`;
    if (kind === "repo.read") description = slot ? "Read one repository you choose" : `Read repository ${value}`;
    if (kind === "repo.write") description = slot ? "Push branches and open pull requests in one repository you choose (never merges)" : `Push branches and open pull requests in ${value} (never merges)`;
    if (kind === "knowledge.read") description = slot ? "Read the knowledge of one product you choose" : `Read the knowledge of ${value}`;
    if (kind === "knowledge.write") description = slot ? "Update the knowledge of one product you choose" : `Update the knowledge of ${value}`;
    if (kind === "delegate") description = `Hand work to ${value}`;
  }
  const safeDescription = slot && !description ? "Permission chosen at install" : (description ?? `${permission} (not yet described)`);
  return `${safeDescription}${slotQuestion ? ` at install: ${slotQuestion}` : ""}${optional ? " (optional)" : ""}`;
}
