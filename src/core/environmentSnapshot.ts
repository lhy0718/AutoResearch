import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const SNAPSHOT_TIMEOUT_MS = 3_000;
const SNAPSHOT_MAX_BUFFER_BYTES = 1_000_000;

export interface EnvironmentSnapshot {
  python_version: string | null;
  node_version: string;
  installed_packages: string[] | null;
  gpu_available: boolean | null;
  available_disk_mb: number | null;
  working_directory: string;
}

export async function collectEnvironmentSnapshot(): Promise<EnvironmentSnapshot> {
  const workingDirectory = process.cwd();
  const [pythonVersion, installedPackages, gpuAvailable, availableDiskMb] = await Promise.all([
    collectPythonVersion(),
    collectInstalledPackages(),
    collectGpuAvailability(),
    collectAvailableDiskMb(workingDirectory)
  ]);

  return {
    python_version: pythonVersion,
    node_version: process.version,
    installed_packages: installedPackages,
    gpu_available: gpuAvailable,
    available_disk_mb: availableDiskMb,
    working_directory: workingDirectory
  };
}

async function collectPythonVersion(): Promise<string | null> {
  const output = await safeExec("python3", ["--version"]);
  const line = firstNonEmptyLine([output.stdout, output.stderr].join("\n"));
  return line || null;
}

async function collectInstalledPackages(): Promise<string[] | null> {
  const output = await safeExec("python3", ["-m", "pip", "list", "--format=freeze"]);
  const lines = [output.stdout, output.stderr]
    .join("\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 20);
  return lines.length > 0 ? lines : null;
}

async function collectGpuAvailability(): Promise<boolean | null> {
  const result = await safeExecWithExitCode("nvidia-smi", []);
  if (result.kind === "spawn_error" || result.kind === "timeout") {
    return null;
  }
  return result.exitCode === 0;
}

async function collectAvailableDiskMb(workingDirectory: string): Promise<number | null> {
  const target = path.join(workingDirectory, ".autolabos");
  const output = await safeExec("df", ["-Pm", target]);
  const lines = output.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) {
    return null;
  }
  const parts = lines[1]?.split(/\s+/u) || [];
  const available = Number(parts[3]);
  return Number.isFinite(available) ? available : null;
}

async function safeExec(
  command: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFile(command, args, {
      timeout: SNAPSHOT_TIMEOUT_MS,
      maxBuffer: SNAPSHOT_MAX_BUFFER_BYTES
    });
    return {
      stdout: result.stdout?.toString() || "",
      stderr: result.stderr?.toString() || ""
    };
  } catch {
    return { stdout: "", stderr: "" };
  }
}

async function safeExecWithExitCode(
  command: string,
  args: string[]
): Promise<
  | { kind: "completed"; exitCode: number }
  | { kind: "spawn_error" }
  | { kind: "timeout" }
> {
  try {
    await execFile(command, args, {
      timeout: SNAPSHOT_TIMEOUT_MS,
      maxBuffer: SNAPSHOT_MAX_BUFFER_BYTES
    });
    return { kind: "completed", exitCode: 0 };
  } catch (error) {
    const candidate = error as { code?: string | number; killed?: boolean; signal?: string };
    if (candidate.code === "ENOENT") {
      return { kind: "spawn_error" };
    }
    if (candidate.killed || candidate.signal === "SIGTERM") {
      return { kind: "timeout" };
    }
    if (typeof candidate.code === "number") {
      return { kind: "completed", exitCode: candidate.code };
    }
    return { kind: "spawn_error" };
  }
}

function firstNonEmptyLine(text: string): string | null {
  const line = text
    .split("\n")
    .map((item) => item.trim())
    .find(Boolean);
  return line || null;
}
