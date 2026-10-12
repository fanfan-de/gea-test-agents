#!/usr/bin/env bash
set -euo pipefail
. /home/fanfande/.local/gea-computer-v1/environment.sh
cd "$(dirname "$(realpath "$0")")"
node --input-type=module - <<'JS'
import { readFile } from "node:fs/promises";
import path from "node:path";
import { stateRoot } from "./scripts/environment.mjs";
import { setTimeout as delay } from "node:timers/promises";
let status;
try {
  status = JSON.parse(await readFile(path.join(stateRoot, "status.json"), "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (!status?.running) {
  console.log("本测试服务已停止。");
  process.exit(0);
}
try {
  const command = await readFile(`/proc/${status.pid}/cmdline`, "utf8");
  if (!command.split("\0").includes("scripts/run-local.mjs")) throw new Error("状态中的进程不属于本测试项目，未发送停止信号。");
  process.kill(status.pid, "SIGTERM");
} catch (error) {
  if (error.code !== "ENOENT" && error.code !== "ESRCH") throw error;
}
for (let attempt = 0; attempt < 100; attempt++) {
  try {
    process.kill(status.pid, 0);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
    console.log("本测试项目的服务已停止。");
    process.exit(0);
  }
  await delay(200);
}
throw new Error("测试服务仍在退出，请查看服务日志。");
JS
