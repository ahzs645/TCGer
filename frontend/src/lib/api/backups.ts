import { API_BASE_URL } from "./base-url";

export interface BackupImportResult {
  importedCopies: number;
  importedBinders: number;
  recoveryAvailable: boolean;
}

export async function importServerBackup(token: string, document: unknown): Promise<BackupImportResult> {
  const response = await fetch(`${API_BASE_URL}/backups`, {
    method: "POST",
    headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/json"},
    body: JSON.stringify(document),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message ?? payload.error ?? "Could not import backup");
  return payload;
}
