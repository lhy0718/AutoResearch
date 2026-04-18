export type CommandPolicyScope = "command" | "tests";

export interface CommandPolicyDecision {
  allowed: boolean;
  scope: CommandPolicyScope;
  normalized_command: string;
  rule_id?: string;
  reason?: string;
}

export interface CommandPolicyOptions {
  scope: CommandPolicyScope;
  /** @deprecated Compatibility-only. Network fetches are no longer blocked by policy. */
  allowNetwork?: boolean;
}

interface CommandPolicyRule {
  id: string;
  reason: string;
  pattern: RegExp;
}

const HARD_BLOCK_RULES: CommandPolicyRule[] = [
  {
    id: "destructive_rm_rf",
    reason: "recursive forced deletion is not allowed for autonomous experiment commands",
    pattern: /\brm\s+-[^\n;|&]*[rf][^\n;|&]*[rf]\b/i
  },
  {
    id: "destructive_git_history",
    reason: "rewriting git history or force-cleaning the worktree is blocked",
    pattern: /\bgit\s+(?:reset\s+--hard|clean\s+-[^\n;|&]*f|checkout\s+--|restore\s+--source)\b/i
  },
  {
    id: "privileged_execution",
    reason: "privileged shell escalation is blocked",
    pattern: /\b(?:sudo|doas|su)\b/i
  },
  {
    id: "remote_script_pipe",
    reason: "piping a remote script directly into a shell is blocked",
    pattern: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sh|bash|zsh)\b/i
  },
  {
    id: "system_shutdown",
    reason: "system shutdown and reboot commands are blocked",
    pattern: /(?:^|[;&|()]\s*|\s)(?:shutdown|reboot|poweroff|halt)(?=$|[\s;&|()])/i
  },
  {
    id: "disk_destructive_tooling",
    reason: "disk formatting or raw disk write commands are blocked",
    pattern: /\b(?:mkfs(?:\.\w+)?|fdisk|diskutil\s+eraseDisk|dd\s+if=)\b/i
  }
];

export function evaluateCommandPolicy(
  command: string,
  options: CommandPolicyOptions
): CommandPolicyDecision {
  const normalized = normalizeCommand(command);
  for (const rule of HARD_BLOCK_RULES) {
    if (rule.pattern.test(normalized)) {
      return {
        allowed: false,
        scope: options.scope,
        normalized_command: normalized,
        rule_id: rule.id,
        reason: rule.reason
      };
    }
  }

  return {
    allowed: true,
    scope: options.scope,
    normalized_command: normalized
  };
}

export function formatPolicyBlockMessage(decision: CommandPolicyDecision): string {
  const scopeLabel = decision.scope === "tests" ? "test command" : "command";
  return [
    `Policy blocked ${scopeLabel}.`,
    decision.rule_id ? `rule=${decision.rule_id}.` : "",
    decision.reason || ""
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function normalizeCommand(command: string): string {
  return command.replace(/\s+/g, " ").trim();
}
