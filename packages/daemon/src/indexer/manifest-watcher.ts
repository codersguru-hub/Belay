import chokidar, { type FSWatcher } from "chokidar";
import { relative } from "node:path";
import type { ManifestService } from "./manifest-service.js";
import { EXCLUDED_DIRECTORY_NAMES, isSecretShapedPath } from "./file-discovery.js";

export class ManifestWatcher {
  private watcher: FSWatcher | undefined;
  private debounceTimer: NodeJS.Timeout | undefined;
  private ready: Promise<void> | undefined;

  constructor(
    private readonly projectRoot: string,
    private readonly manifests: ManifestService,
    private readonly debounceMilliseconds = 150
  ) {}

  start(): Promise<void> {
    if (this.ready) {
      return this.ready;
    }
    this.watcher = chokidar.watch(this.projectRoot, {
      ignoreInitial: true,
      persistent: true,
      ignored: (watchedPath) => {
        const projectPath = relative(this.projectRoot, watchedPath).replaceAll("\\", "/");
        if (!projectPath || projectPath.startsWith("..")) {
          return false;
        }
        const segments = projectPath.toLowerCase().split("/");
        return segments.some((segment) => EXCLUDED_DIRECTORY_NAMES.has(segment)) || isSecretShapedPath(projectPath);
      }
    });
    this.watcher.on("all", () => this.scheduleInvalidation());
    this.ready = new Promise<void>((resolve, reject) => {
      this.watcher?.once("ready", resolve);
      this.watcher?.once("error", reject);
    });
    return this.ready;
  }

  async close(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    if (this.watcher) {
      const watcher = this.watcher;
      this.watcher = undefined;
      this.ready = undefined;
      await watcher.close();
    }
  }

  private scheduleInvalidation(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      this.manifests.markStale(this.projectRoot);
    }, this.debounceMilliseconds);
    this.debounceTimer.unref();
  }
}
