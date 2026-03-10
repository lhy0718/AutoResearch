export interface SlashCommandDef {
  name: string;
  usage: string;
  description: string;
}

export const SLASH_COMMANDS: SlashCommandDef[] = [
  { name: "help", usage: "/help", description: "Show command list and usage" },
  { name: "new", usage: "/new", description: "Create a new run" },
  { name: "doctor", usage: "/doctor", description: "Run environment checks" },
  { name: "runs", usage: "/runs", description: "List and search runs" },
  { name: "run", usage: "/run <run>", description: "Select a run" },
  { name: "resume", usage: "/resume <run>", description: "Resume a run" },
  { name: "title", usage: "/title <new title>", description: "Rename the active run" },
  { name: "agent", usage: "/agent <subcommand>", description: "Run and inspect state graph nodes" },
  { name: "model", usage: "/model", description: "Open model and reasoning selector" },
  { name: "approve", usage: "/approve", description: "Approve current node" },
  { name: "retry", usage: "/retry", description: "Retry current node" },
  { name: "settings", usage: "/settings", description: "Edit configuration" },
  { name: "quit", usage: "/quit", description: "Exit AutoLabOS" }
];
