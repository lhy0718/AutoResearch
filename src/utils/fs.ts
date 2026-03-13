import { promises as fs } from "node:fs";
import path from "node:path";

const SANDBOX_PATH_ALIAS_PREFIXES = [
  ["/private/tmp", "/tmp"],
  ["/private/var/folders", "/var/folders"]
] as const;

export function normalizeFsPath(filePath: string): string {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
  for (const [aliasPrefix, canonicalPrefix] of SANDBOX_PATH_ALIAS_PREFIXES) {
    if (absolute === aliasPrefix || absolute.startsWith(`${aliasPrefix}/`)) {
      return `${canonicalPrefix}${absolute.slice(aliasPrefix.length)}`;
    }
  }
  return absolute;
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(normalizeFsPath(dirPath), { recursive: true });
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(normalizeFsPath(filePath));
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(normalizeFsPath(filePath), "utf8");
  return JSON.parse(raw) as T;
}

export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  const normalizedPath = normalizeFsPath(filePath);
  await ensureDir(path.dirname(normalizedPath));
  const dir = path.dirname(normalizedPath);
  const tempPath = path.join(
    dir,
    `.${path.basename(normalizedPath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  );
  await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, normalizedPath);
}
