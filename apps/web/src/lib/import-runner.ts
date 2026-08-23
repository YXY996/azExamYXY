import "server-only";

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

export function ensureImportRunner(jobId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return;
  const projectRoot = path.resolve(process.cwd(), "..", "..");
  const runnerPath = path.join(projectRoot, "scripts", "import-runner.mjs");
  const child = spawn(process.execPath, [runnerPath, jobId], {
    cwd: projectRoot,
    detached: true,
    shell: false,
    stdio: "ignore",
    windowsHide: true,
    env: {
      SystemRoot: process.env.SystemRoot,
      USERPROFILE: process.env.USERPROFILE,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      NODE_ENV: process.env.NODE_ENV,
    },
  }) as ChildProcess;
  child.unref();
}
