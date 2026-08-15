import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { migrateDatabase } from "./migrate.js";

export interface OpenedStateDatabase {
  database: Database.Database;
  journalMode: "wal";
}

export function openStateDatabase(databasePath: string): OpenedStateDatabase {
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);

  try {
    const journalMode = String(
      database.pragma("journal_mode = WAL", { simple: true })
    ).toLowerCase();
    if (journalMode !== "wal") {
      throw new Error(`SQLite refused WAL mode (reported ${journalMode || "unknown"})`);
    }

    database.pragma("foreign_keys = ON");
    database.pragma("synchronous = NORMAL");
    database.pragma("busy_timeout = 5000");
    database.pragma("temp_store = MEMORY");
    migrateDatabase(database);

    return { database, journalMode: "wal" };
  } catch (error) {
    database.close();
    throw error;
  }
}

