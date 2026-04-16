import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

export interface CodexOAuthCredentials {
  accessToken: string;
  accountId?: string;
}

export interface CodexOAuthStatus {
  ok: boolean;
  detail: string;
}

export async function resolveCodexOAuthCredentials(authFile = defaultCodexAuthFile()): Promise<
  CodexOAuthCredentials | undefined
> {
  try {
    const raw = await fs.readFile(authFile, "utf8");
    const parsed = JSON.parse(raw) as {
      tokens?: {
        access_token?: unknown;
        account_id?: unknown;
      };
    };
    const accessToken = typeof parsed.tokens?.access_token === "string" ? parsed.tokens.access_token.trim() : "";
    if (!accessToken) {
      return undefined;
    }
    const accountId = typeof parsed.tokens?.account_id === "string" ? parsed.tokens.account_id.trim() : undefined;
    return {
      accessToken,
      accountId: accountId || undefined
    };
  } catch {
    return undefined;
  }
}

export async function checkCodexOAuthStatus(authFile = defaultCodexAuthFile()): Promise<CodexOAuthStatus> {
  const credentials = await resolveCodexOAuthCredentials(authFile);
  if (!credentials?.accessToken) {
    return {
      ok: false,
      detail: `Codex ChatGPT OAuth tokens were not found in ${authFile}. Run \`codex login\` to populate ~/.codex/auth.json.`
    };
  }
  return {
    ok: true,
    detail: `Codex ChatGPT OAuth tokens are available in ${authFile}.`
  };
}

export function defaultCodexAuthFile(): string {
  return path.join(os.homedir(), ".codex", "auth.json");
}
