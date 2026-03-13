import path from "node:path";
import { promises as fs } from "node:fs";

import { ensureDir, normalizeFsPath, readJsonFile, writeJsonFile } from "../../utils/fs.js";

export interface RunContextItem {
  key: string;
  value: unknown;
  updatedAt: string;
}

interface RunContextStoreFile {
  version: 1;
  items: RunContextItem[];
}

export class RunContextMemory {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = normalizeFsPath(filePath);
  }

  async put(key: string, value: unknown): Promise<void> {
    const store = await this.readStore();
    const idx = store.items.findIndex((item) => item.key === key);
    const next: RunContextItem = {
      key,
      value,
      updatedAt: new Date().toISOString()
    };

    if (idx >= 0) {
      store.items[idx] = next;
    } else {
      store.items.push(next);
    }

    await this.writeStore(store);
  }

  async get<T>(key: string): Promise<T | undefined> {
    const store = await this.readStore();
    const item = store.items.find((x) => x.key === key);
    return item?.value as T | undefined;
  }

  async entries(): Promise<RunContextItem[]> {
    const store = await this.readStore();
    return store.items;
  }

  private async readStore(): Promise<RunContextStoreFile> {
    try {
      const raw = await readJsonFile<RunContextStoreFile>(this.filePath);
      return {
        version: 1,
        items: Array.isArray(raw.items) ? raw.items : []
      };
    } catch {
      return { version: 1, items: [] };
    }
  }

  private async writeStore(store: RunContextStoreFile): Promise<void> {
    await ensureDir(path.dirname(this.filePath));
    await writeJsonFile(this.filePath, store);
  }
}

export async function ensureJsonFile(filePath: string): Promise<void> {
  const normalizedPath = normalizeFsPath(filePath);
  try {
    await fs.access(normalizedPath);
  } catch {
    await writeJsonFile(normalizedPath, { version: 1, items: [] });
  }
}
