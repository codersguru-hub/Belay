import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { FileLockRow } from "../db/repositories/task-repository.js";

interface ExpiredLockRow extends FileLockRow {
  title: string;
}

export class LeaseService {
  constructor(
    private readonly database: Database.Database,
    private readonly createCorrelationId: () => string = randomUUID
  ) {}

  reapProject(projectId: string, now: string): number {
    const reap = this.database.transaction(() => this.reapProjectInsideTransaction(projectId, now));
    return reap.immediate();
  }

  reapAll(now: string): number {
    const reap = this.database.transaction(() => {
      const projects = this.database.prepare("SELECT id FROM projects ORDER BY id ASC").all() as Array<{
        id: string;
      }>;
      return projects.reduce(
        (expiredCount, project) => expiredCount + this.reapProjectInsideTransaction(project.id, now),
        0
      );
    });
    return reap.immediate();
  }

  reapProjectInsideTransaction(projectId: string, now: string): number {
    const expiredLocks = this.database
      .prepare(
        `SELECT file_locks.*, tasks.title
         FROM file_locks
         JOIN tasks ON tasks.id = file_locks.task_id
         WHERE file_locks.project_id = ? AND file_locks.lease_expires_at <= ?
         ORDER BY file_locks.task_id, file_locks.display_path`
      )
      .all(projectId, now) as ExpiredLockRow[];

    if (expiredLocks.length === 0) {
      return 0;
    }

    const grouped = new Map<string, ExpiredLockRow[]>();
    for (const lock of expiredLocks) {
      const locks = grouped.get(lock.task_id) ?? [];
      locks.push(lock);
      grouped.set(lock.task_id, locks);
    }

    const insertMemory = this.database.prepare(
      `INSERT INTO agent_memory (
        project_id, agent_name, task_id, action_type, summary,
        impacted_files_json, correlation_id, created_at
      ) VALUES (?, ?, ?, 'lock_expired', ?, ?, ?, ?)`
    );
    for (const [taskId, locks] of grouped) {
      const firstLock = locks[0];
      if (!firstLock) {
        continue;
      }
      insertMemory.run(
        projectId,
        firstLock.locked_by,
        taskId,
        `Lease expired for task: ${firstLock.title}`,
        JSON.stringify(locks.map((lock) => lock.display_path)),
        this.createCorrelationId(),
        now
      );
      this.database
        .prepare(
          `UPDATE tasks SET status = 'blocked', updated_at = ?
           WHERE id = ? AND status = 'in_progress'`
        )
        .run(now, taskId);
    }

    this.database
      .prepare("DELETE FROM file_locks WHERE project_id = ? AND lease_expires_at <= ?")
      .run(projectId, now);
    return expiredLocks.length;
  }
}

