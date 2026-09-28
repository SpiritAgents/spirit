import { existsSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";

const TASKS_WATCH_DEBOUNCE_MS = 150;

export interface TasksWatcherTarget {
  workspaceRoot?: string;
  spiritDataDir: string;
}

// Watches exactly the three tasks.json candidates and reports one debounced change per
// burst. fs.watch cannot watch a file that does not exist yet, and on macOS/Windows a
// file-level watcher goes stale after the file is replaced by an atomic rename-save, so
// missing files are watched via their nearest existing ancestor directory (filtered to
// the first missing path segment) and every event re-arms from scratch. Only three known
// paths are tracked, so a generic recursive watcher would be overkill here.
export class TasksWatcher {
  private readonly watchers: FSWatcher[] = [];
  private target: TasksWatcherTarget | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly onChange: () => void) {}

  sync(target: TasksWatcherTarget): void {
    if (
      this.target !== undefined &&
      this.target.workspaceRoot === target.workspaceRoot &&
      this.target.spiritDataDir === target.spiritDataDir
    ) {
      return;
    }
    this.target = { ...target };
    this.rearm();
  }

  close(): void {
    this.closeWatchers();
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.target = undefined;
  }

  private rearm(): void {
    this.closeWatchers();
    if (this.target === undefined) {
      return;
    }
    const { workspaceRoot, spiritDataDir } = this.target;
    if (workspaceRoot !== undefined) {
      this.armOne(path.join(workspaceRoot, ".spirit", "tasks.json"));
    }
    this.armOne(path.join(spiritDataDir, "tasks.json"));
    if (workspaceRoot !== undefined) {
      this.armOne(path.join(workspaceRoot, ".vscode", "tasks.json"));
    }
  }

  private armOne(filePath: string): void {
    if (existsSync(filePath)) {
      this.armPath(filePath, undefined);
      return;
    }
    let missingPath = filePath;
    while (!existsSync(path.dirname(missingPath))) {
      missingPath = path.dirname(missingPath);
      if (path.dirname(missingPath) === missingPath) {
        return;
      }
    }
    this.armPath(path.dirname(missingPath), path.basename(missingPath));
  }

  private armPath(target: string, segment: string | undefined): void {
    let watcher: FSWatcher;
    try {
      watcher = watch(target, (_eventType, filename) => {
        if (segment !== undefined && filename !== segment) {
          return;
        }
        this.rearm();
        this.schedule();
      });
    } catch {
      return;
    }
    watcher.unref();
    this.watchers.push(watcher);
  }

  private schedule(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.onChange();
    }, TASKS_WATCH_DEBOUNCE_MS);
    this.timer.unref();
  }

  private closeWatchers(): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers.length = 0;
  }
}
