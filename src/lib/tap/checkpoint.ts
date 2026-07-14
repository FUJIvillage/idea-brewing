import { promises as fs } from "node:fs";
import path from "node:path";
import { tapDir } from "@/lib/store";

export type CheckpointPhase = "generating" | "verifying" | "repairing";

export interface BuildCheckpoint {
  version: 1;
  phase: CheckpointPhase;
  /** 成功完了したタスク数。次に実行するタスク index は completedTasks */
  completedTasks: number;
  /** 一括実装時は null */
  totalTasks: number | null;
  repairRound: number;
  updatedAt: string;
}

export function checkpointPath(brewId: string, batch: number): string {
  return path.join(tapDir(brewId, batch), "build-checkpoint.json");
}

export async function readBuildCheckpoint(
  brewId: string,
  batch: number,
): Promise<BuildCheckpoint | null> {
  try {
    const raw = await fs.readFile(checkpointPath(brewId, batch), "utf8");
    const parsed = JSON.parse(raw) as Partial<BuildCheckpoint>;
    if (parsed.version !== 1) return null;
    if (
      parsed.phase !== "generating" &&
      parsed.phase !== "verifying" &&
      parsed.phase !== "repairing"
    ) {
      return null;
    }
    if (typeof parsed.completedTasks !== "number" || !Number.isFinite(parsed.completedTasks)) {
      return null;
    }
    return {
      version: 1,
      phase: parsed.phase,
      completedTasks: Math.max(0, Math.floor(parsed.completedTasks)),
      totalTasks:
        typeof parsed.totalTasks === "number" && Number.isFinite(parsed.totalTasks)
          ? Math.max(0, Math.floor(parsed.totalTasks))
          : null,
      repairRound:
        typeof parsed.repairRound === "number" && Number.isFinite(parsed.repairRound)
          ? Math.max(0, Math.floor(parsed.repairRound))
          : 0,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function writeBuildCheckpoint(
  brewId: string,
  batch: number,
  checkpoint: Omit<BuildCheckpoint, "version" | "updatedAt"> & {
    updatedAt?: string;
  },
): Promise<BuildCheckpoint> {
  const full: BuildCheckpoint = {
    version: 1,
    phase: checkpoint.phase,
    completedTasks: checkpoint.completedTasks,
    totalTasks: checkpoint.totalTasks,
    repairRound: checkpoint.repairRound,
    updatedAt: checkpoint.updatedAt ?? new Date().toISOString(),
  };
  const dest = checkpointPath(brewId, batch);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, JSON.stringify(full, null, 2), "utf8");
  return full;
}

export async function clearBuildCheckpoint(brewId: string, batch: number): Promise<void> {
  try {
    await fs.unlink(checkpointPath(brewId, batch));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
