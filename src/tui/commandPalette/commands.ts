export type SlashCommandCategory = "workflow" | "run" | "session" | "system";

export interface SlashCommandDef {
  name: string;
  usage: string;
  description: string;
  category?: SlashCommandCategory;
  aliases?: string[];
  argHint?: string;
  preserveDraftOnRun?: boolean;
  visible?: boolean;
}

export function needsArg(cmd: SlashCommandDef): boolean {
  return Boolean(cmd.argHint) || cmd.usage.includes("<");
}

export const SLASH_COMMANDS: SlashCommandDef[] = [
  { name: "help", usage: "/help", description: "Show the minimal workflow", category: "system", visible: true },
  { name: "new", usage: "/new", description: "Create or open workspace Brief.md", category: "workflow", visible: true },
  { name: "brief", usage: "/brief start <path|--latest>", description: "Start research from Brief.md or a brief path", category: "workflow", argHint: "start <path|--latest>", visible: true },
  { name: "doctor", usage: "/doctor", description: "Run environment checks", category: "system" },
  { name: "runs", usage: "/runs", description: "List and search runs", category: "run" },
  { name: "run", usage: "/run <run>", description: "Select a run", category: "run", argHint: "<run>" },
  { name: "resume", usage: "/resume <run>", description: "Resume a run", category: "run", argHint: "<run>" },
  { name: "title", usage: "/title <new title>", description: "Rename the active run", category: "run", argHint: "<title>" },
  { name: "agent", usage: "/agent <subcommand>", description: "Run and inspect state graph nodes", category: "workflow", argHint: "<subcommand>" },
  { name: "model", usage: "/model", description: "Open model and reasoning selector", category: "session", visible: true },
  { name: "approve", usage: "/approve", description: "Approve the current step", category: "workflow", visible: true },
  { name: "retry", usage: "/retry", description: "Retry current node", category: "workflow" },
  { name: "settings", usage: "/settings", description: "Edit configuration", category: "system" },
  { name: "clear", usage: "/clear", description: "Clear the transcript", category: "session", visible: true, preserveDraftOnRun: true },
  { name: "queue", usage: "/queue", description: "Show queued inputs", category: "session", visible: true, preserveDraftOnRun: true },
  { name: "inspect", usage: "/inspect", description: "Show session diagnostics", category: "session", visible: true, preserveDraftOnRun: true },
  { name: "session", usage: "/session", description: "Show active run summary", category: "session", visible: true, preserveDraftOnRun: true },
  { name: "knowledge", usage: "/knowledge [run]", description: "Show repository knowledge for the active or selected run", category: "session", visible: true, preserveDraftOnRun: true },
  { name: "stats", usage: "/stats", description: "Show local session metrics", category: "session", visible: true, preserveDraftOnRun: true },
  { name: "terminal-setup", usage: "/terminal-setup", description: "Show terminal capabilities", category: "system", visible: true, aliases: ["ts"], preserveDraftOnRun: true },
  { name: "theme", usage: "/theme", description: "Show current theme info", category: "system", visible: true, preserveDraftOnRun: true },
  { name: "quit", usage: "/quit", description: "Exit AutoLabOS", category: "system" }
];
