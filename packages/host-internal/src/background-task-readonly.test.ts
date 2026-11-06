import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { FileBackgroundTaskStore } from "./background-task-store.js";
import { NodeHostToolService } from "./tools.js";

it("keeps task logs readable while denying file-tool mutation, including symlink aliases", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "task-readonly-"));
  const spiritDataDir = path.join(workspaceRoot, "data");
  try {
    const store = new FileBackgroundTaskStore({
      spiritDataDir,
      ownerSessionId: "session",
      owner: { id: "test", pid: process.pid },
    });
    const task = await store.create({
      ownerSessionId: "session",
      runtimeId: "main",
      kind: "shell",
      toolCallId: "call",
      input: "build",
      argumentsJson: "{}",
    });
    await store.appendOutput(task.id, "output");
    const service = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      { getApprovalLevel: () => "bypass-approval" },
    );
    const read = await service.execute({ name: "read_file", path: task.outputPath });
    expect(typeof read === "object" && read.summaryText).toContain("output");
    await expect(
      service.execute({
        name: "edit_file",
        path: task.outputPath,
        old_text: "output",
        new_text: "fake",
      }),
    ).rejects.toThrow("read-only");
    await expect(service.execute({ name: "delete_file", path: task.outputPath })).rejects.toThrow(
      "read-only",
    );
    if (process.platform !== "win32") {
      const alias = path.join(workspaceRoot, "alias.log");
      await symlink(task.outputPath, alias);
      await expect(
        service.execute({ name: "create_file", path: alias, content: "fake" }),
      ).rejects.toThrow("read-only");
    }
    expect(await readFile(task.outputPath, "utf8")).toBe("output");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
