import { AGENT_ORDER, AgentId, SuggestionItem, SlashContextRun } from "../../types.js";
import { relativeTime } from "../../utils/time.js";
import { SLASH_COMMANDS } from "./commands.js";
import { fuzzyScore } from "./fuzzy.js";

export interface SuggestionContext {
  input: string;
  runs: SlashContextRun[];
  activeRunId?: string;
}

interface ParsedInput {
  commandQuery: string;
  commandName?: string;
  args: string[];
  argIndex: number;
  argPartial: string;
}

const AGENT_SUBCOMMANDS = [
  "list",
  "run",
  "status",
  "collect",
  "clear",
  "count",
  "recollect",
  "clear_papers",
  "focus",
  "graph",
  "resume",
  "retry",
  "jump",
  "transition",
  "apply",
  "overnight",
  "autonomous"
] as const;

export function buildSuggestions(ctx: SuggestionContext): SuggestionItem[] {
  const raw = normalizeSlashPrefix(ctx.input);
  if (!raw.startsWith("/")) {
    return [];
  }

  const parsed = parseSlashInput(raw);

  if (!parsed.commandName) {
    return limitSuggestions(commandSuggestions(parsed.commandQuery, ctx));
  }

  const resolved = resolveCommandName(parsed.commandName);
  if (!resolved) {
    return limitSuggestions(commandSuggestions(parsed.commandQuery, ctx));
  }

  if (resolved === "run" || resolved === "resume") {
    return runSuggestions(resolved, parsed.argPartial, ctx.runs);
  }

  if (resolved === "agent") {
    return agentCommandSuggestions(parsed, ctx.runs);
  }

  if (resolved === "model") {
    return modelSuggestions(parsed);
  }

  if (resolved === "title") {
    return titleSuggestions(parsed, ctx);
  }

  if (resolved === "brief") {
    return briefSuggestions(parsed);
  }

  return commandSuggestions(resolved, ctx);
}

function knownCommand(name: string): boolean {
  return SLASH_COMMANDS.some((cmd) => cmd.name === name || cmd.aliases?.includes(name));
}

function resolveCommandName(name: string): string | undefined {
  const direct = SLASH_COMMANDS.find((cmd) => cmd.name === name);
  if (direct) return direct.name;
  const alias = SLASH_COMMANDS.find((cmd) => cmd.aliases?.includes(name));
  return alias?.name;
}

function commandSuggestions(query: string, ctx: SuggestionContext): SuggestionItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  return SLASH_COMMANDS
    .filter((cmd) => cmd.visible)
    .map((cmd, index) => {
      const nameScore = fuzzyScore(query, cmd.name) ?? -1;
      const aliasScore = cmd.aliases
        ? Math.max(...cmd.aliases.map((a) => fuzzyScore(query, a) ?? -1))
        : -1;
      const bestScore = Math.max(nameScore, aliasScore);
      const lowerName = cmd.name.toLowerCase();
      const matchesAlias = cmd.aliases?.some((a) => a.toLowerCase().startsWith(normalizedQuery));
      const rank =
        normalizedQuery.length === 0
          ? 0
          : lowerName === normalizedQuery
            ? 0
            : lowerName.startsWith(normalizedQuery) || matchesAlias
              ? 1
              : bestScore < 0
                ? null
                : 2;
      if (rank === null) {
        return null;
      }
      const description = describeCommand(cmd.name, cmd.description, ctx);
      return {
        key: `cmd:${cmd.name}`,
        label: cmd.usage,
        description,
        applyValue: defaultApplyValueForCommand(cmd.name),
        score: Math.max(0, bestScore),
        rank,
        index
      };
    })
    .filter((x): x is SuggestionItem & { score: number; rank: number; index: number } => Boolean(x))
    .sort((a, b) => a.rank - b.rank || a.index - b.index || b.score - a.score)
    .map(({ score: _score, rank: _rank, index: _index, ...item }) => item);
}

function defaultApplyValueForCommand(name: string): string {
  if (name === "brief") {
    return "/brief start --latest";
  }
  return `/${name} `;
}

function limitSuggestions(items: SuggestionItem[]): SuggestionItem[] {
  return items.slice(0, 16);
}

function briefSuggestions(parsed: ParsedInput): SuggestionItem[] {
  const arg0 = (parsed.args[0] || "").toLowerCase();
  const topLevelPartial = parsed.argIndex <= 0 ? parsed.argPartial : arg0;
  const startScore = fuzzyScore(topLevelPartial, "start");

  if (startScore === null && topLevelPartial) {
    return [];
  }

  const suggestions: Array<SuggestionItem & { score: number; rank: number; index: number }> = [
    {
      key: "brief:start-latest",
      label: "/brief start --latest",
      description: "Start research from workspace Brief.md",
      applyValue: "/brief start --latest",
      score: Math.max(0, startScore ?? 0) + 1,
      rank: 0,
      index: 0
    },
    {
      key: "brief:start-path",
      label: "/brief start <path>",
      description: "Start research from a specific brief path",
      applyValue: "/brief start ",
      score: Math.max(0, startScore ?? 0),
      rank: 1,
      index: 1
    }
  ];

  if (parsed.argIndex <= 0) {
    return suggestions
      .sort((a, b) => a.rank - b.rank || a.index - b.index || b.score - a.score)
      .map(({ score: _score, rank: _rank, index: _index, ...item }) => item);
  }

  if (arg0 !== "start") {
    return [];
  }

  if (parsed.argIndex === 1) {
    const optionPartial = parsed.argPartial.toLowerCase();
    const optionScore = fuzzyScore(optionPartial, "--latest");
    if (optionScore !== null || optionPartial.length === 0) {
      return [
        {
          key: "brief:start-latest",
          label: "/brief start --latest",
          description: "Start research from the latest Research Brief",
          applyValue: "/brief start --latest"
        }
      ];
    }
  }

  return [];
}

function titleSuggestions(parsed: ParsedInput, ctx: SuggestionContext): SuggestionItem[] {
  const currentTitle = getActiveRunTitle(ctx);
  const score = fuzzyScore(parsed.argPartial, "title") ?? 0;
  return [
    {
      key: "title:rename",
      label: "/title <new title>",
      description: currentTitle ? `Current: ${truncateForSuggestion(currentTitle)}` : "Rename the active run",
      applyValue: "/title ",
      score
    }
  ].map(({ score: _score, ...item }) => item);
}

function agentCommandSuggestions(parsed: ParsedInput, runs: SlashContextRun[]): SuggestionItem[] {
  if (parsed.argIndex <= 0) {
    return AGENT_SUBCOMMANDS.map((sub) => {
      const score = fuzzyScore(parsed.argPartial, sub);
      if (score === null) {
        return null;
      }
      return {
        key: `agent-sub:${sub}`,
        label: `/agent ${sub}`,
        description: "State graph command",
        applyValue: `/agent ${sub} `,
        score
      };
    })
      .filter((x): x is SuggestionItem & { score: number } => Boolean(x))
      .sort((a, b) => b.score - a.score)
      .map(({ score: _score, ...item }) => item);
  }

  const sub = (parsed.args[0] || "").toLowerCase();

  if (sub === "run" || sub === "focus" || sub === "jump") {
    if (parsed.argIndex === 1) {
      return nodeSuggestions(parsed.argPartial, `/agent ${sub}`);
    }

    if (sub === "run" && (parsed.args[1] || "").toLowerCase() === "analyze_papers") {
      if (parsed.argPartial === "--top-n" || parsed.argPartial.startsWith("--top")) {
        return analyzeTopNOptionSuggestions(parsed);
      }
      const prev = parsed.args[parsed.argIndex - 1];
      if (prev === "--top-n") {
        return enumSuggestions("/agent run analyze_papers", "--top-n", parsed.argPartial, ["20", "50", "100", "200"]);
      }
      if (parsed.argIndex >= 2 && (parsed.argPartial === "" || parsed.argPartial.startsWith("--"))) {
        return analyzeTopNOptionSuggestions(parsed);
      }
      if (parsed.argIndex >= 2) {
        return runSuggestions(`agent run analyze_papers`, parsed.argPartial, runs);
      }
    }

    if (sub === "run" && (parsed.args[1] || "").toLowerCase() === "generate_hypotheses") {
      if (parsed.argPartial === "--top-k" || parsed.argPartial.startsWith("--top")) {
        return generateHypothesesOptionSuggestions(parsed);
      }
      if (parsed.argPartial === "--branch-count" || parsed.argPartial.startsWith("--branch")) {
        return generateHypothesesOptionSuggestions(parsed);
      }
      const prev = parsed.args[parsed.argIndex - 1];
      if (prev === "--top-k") {
        return enumSuggestions("/agent run generate_hypotheses", "--top-k", parsed.argPartial, ["1", "2", "3", "5"]);
      }
      if (prev === "--branch-count") {
        return enumSuggestions(
          "/agent run generate_hypotheses",
          "--branch-count",
          parsed.argPartial,
          ["4", "6", "8", "10"]
        );
      }
      if (parsed.argIndex >= 2 && (parsed.argPartial === "" || parsed.argPartial.startsWith("--"))) {
        return generateHypothesesOptionSuggestions(parsed);
      }
      if (parsed.argIndex >= 2) {
        return runSuggestions(`agent run generate_hypotheses`, parsed.argPartial, runs);
      }
    }

    if (sub === "run" || sub === "jump") {
      if (parsed.argIndex === 2) {
        return runSuggestions(`agent ${sub} ${parsed.args[1]}`, parsed.argPartial, runs);
      }
    }
  }

  if (sub === "recollect") {
    if (parsed.argIndex === 1) {
      return recollectCountSuggestions(parsed.argPartial);
    }
    if (parsed.argIndex === 2) {
      const count = normalizePositiveInt(parsed.args[1]) || parsed.args[1] || "100";
      return runSuggestions(`agent recollect ${count}`, parsed.argPartial, runs);
    }
  }

  if (sub === "collect") {
    return collectSuggestions(parsed, runs);
  }

  if (sub === "clear" || sub === "count") {
    if (parsed.argIndex === 1) {
      return nodeSuggestions(parsed.argPartial, `/agent ${sub}`);
    }
    if (parsed.argIndex === 2) {
      return runSuggestions(`agent ${sub} ${parsed.args[1]}`, parsed.argPartial, runs);
    }
  }

  if (sub === "clear_papers") {
    if (parsed.argIndex === 1) {
      return runSuggestions("agent clear_papers", parsed.argPartial, runs);
    }
  }

  if (sub === "status" || sub === "graph") {
    if (parsed.argIndex === 1) {
      return runSuggestions(`agent ${sub}`, parsed.argPartial, runs);
    }
  }

  if (sub === "resume") {
    if (parsed.argIndex === 1) {
      return runSuggestions("agent resume", parsed.argPartial, runs);
    }
  }

  if (sub === "retry") {
    if (parsed.argIndex === 1) {
      return nodeSuggestions(parsed.argPartial, "/agent retry");
    }
    if (parsed.argIndex === 2) {
      return runSuggestions(`agent retry ${parsed.args[1]}`, parsed.argPartial, runs);
    }
  }

  return commandSuggestions("agent", { input: parsed.commandName || "", runs });
}

function collectSuggestions(parsed: ParsedInput, runs: SlashContextRun[]): SuggestionItem[] {
  const args = parsed.args.slice(1);
  const current = parsed.argPartial || "";
  const currentStartsWithOption = current.startsWith("--");
  const lastToken = args[parsed.argIndex - 2];
  const currentOption = currentStartsWithOption ? current : undefined;

  if (lastToken === "--run" && parsed.argIndex >= 2) {
    const prefix = `/agent collect ${args.slice(0, parsed.argIndex - 1).join(" ")}`.trim();
    return runSuggestions(prefix.replace(/^\//, ""), current, runs);
  }

  if (lastToken === "--sort") {
    return enumSuggestions("/agent collect", "--sort", current, ["relevance", "citationCount", "publicationDate", "paperId"]);
  }
  if (lastToken === "--order") {
    return enumSuggestions("/agent collect", "--order", current, ["asc", "desc"]);
  }
  if (lastToken === "--bibtex") {
    return enumSuggestions("/agent collect", "--bibtex", current, ["generated", "s2", "hybrid"]);
  }
  if (lastToken === "--type") {
    return enumSuggestions("/agent collect", "--type", current, [
      "Review",
      "JournalArticle",
      "Conference",
      "Dataset",
      "MetaAnalysis"
    ]);
  }
  if (lastToken === "--limit" || lastToken === "--additional" || lastToken === "--last-years" || lastToken === "--min-citations") {
    return enumSuggestions("/agent collect", lastToken, current, ["20", "50", "100", "200", "500"]);
  }
  if (lastToken === "--year") {
    return enumSuggestions("/agent collect", "--year", current, ["2025", "2021-2025", "2020-", "-2020"]);
  }
  if (lastToken === "--date-range") {
    return enumSuggestions("/agent collect", "--date-range", current, ["2021-01-01:", "2020:2025", ":2024-12-31"]);
  }
  if (lastToken === "--field") {
    return enumSuggestions("/agent collect", "--field", current, [
      "Computer Science",
      "Medicine",
      "Mathematics",
      "Engineering",
      "Physics"
    ]);
  }
  if (lastToken === "--venue") {
    return enumSuggestions("/agent collect", "--venue", current, [
      "Nature",
      "Science",
      "NeurIPS",
      "ICLR",
      "ACL"
    ]);
  }

  if (currentStartsWithOption || current === "" || current.startsWith("-")) {
    return collectOptionSuggestions(currentOption ?? current);
  }

  return collectOptionSuggestions("");
}

function generateHypothesesOptionSuggestions(parsed: ParsedInput): SuggestionItem[] {
  const base = "/agent run generate_hypotheses";
  const options = [
    { flag: "--top-k", description: "Choose how many hypotheses to keep" },
    { flag: "--branch-count", description: "Choose how many candidates to generate" }
  ];
  return options
    .map((option) => {
      const score = fuzzyScore(parsed.argPartial || "", option.flag);
      if (score === null) {
        return null;
      }
      return {
        key: `generate-hypothesis-option:${option.flag}`,
        label: `${base} ${option.flag} <n>`,
        description: option.description,
        applyValue: `${base} ${option.flag} `,
        score
      };
    })
    .filter((item): item is SuggestionItem & { score: number } => Boolean(item))
    .sort((a, b) => b.score - a.score)
    .map(({ score: _score, ...item }) => item);
}

function analyzeTopNOptionSuggestions(parsed: ParsedInput): SuggestionItem[] {
  const applyPrefix = parsed.args.slice(0, parsed.argIndex).join(" ").replace(/\s+$/, "");
  return [
    {
      key: "analyze:top-n",
      label: "/agent run analyze_papers --top-n <n>",
      description: "Analyze only the top-N ranked papers",
      applyValue: `/${applyPrefix ? `${parsed.commandName} ${applyPrefix} ` : "agent run analyze_papers "}--top-n `,
      score: 1
    }
  ].map(({ score: _score, ...item }) => item);
}

function recollectCountSuggestions(partial: string): SuggestionItem[] {
  const presets = ["20", "50", "100", "200", "500"];
  return presets
    .map((value) => {
      const score = fuzzyScore(partial, value);
      if (score === null) {
        return null;
      }
      return {
        key: `recollect:${value}`,
        label: `/agent recollect ${value}`,
        description: "Additional papers to collect",
        applyValue: `/agent recollect ${value} `,
        score
      };
    })
    .filter((x): x is SuggestionItem & { score: number } => Boolean(x))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ score: _score, ...item }) => item);
}

function collectOptionSuggestions(partial: string): SuggestionItem[] {
  const options: Array<{ flag: string; description: string }> = [
    { flag: "--run", description: "Target run id" },
    { flag: "--limit", description: "Total papers to collect" },
    { flag: "--additional", description: "Collect additional papers from current count" },
    { flag: "--last-years", description: "Filter by recent N years" },
    { flag: "--year", description: "Filter by year range" },
    { flag: "--date-range", description: "Filter by date range start:end" },
    { flag: "--sort", description: "Sort by relevance/citations/date/id" },
    { flag: "--order", description: "Sort order asc/desc" },
    { flag: "--field", description: "Filter by fieldsOfStudy csv" },
    { flag: "--venue", description: "Filter by venue csv" },
    { flag: "--type", description: "Filter by publicationTypes csv" },
    { flag: "--min-citations", description: "Minimum citation count" },
    { flag: "--open-access", description: "Only papers with public PDF" },
    { flag: "--bibtex", description: "BibTeX mode generated/s2/hybrid" },
    { flag: "--dry-run", description: "Preview without execution" }
  ];

  return options
    .map((opt) => {
      const score = fuzzyScore(partial, opt.flag);
      if (score === null) {
        return null;
      }
      const needsValue = !["--open-access", "--dry-run"].includes(opt.flag);
      return {
        key: `collect-opt:${opt.flag}`,
        label: `/agent collect ${opt.flag}`,
        description: opt.description,
        applyValue: `/agent collect ${opt.flag}${needsValue ? " " : ""}`,
        score
      };
    })
    .filter((x): x is SuggestionItem & { score: number } => Boolean(x))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ score: _score, ...item }) => item);
}

function modelSuggestions(parsed: ParsedInput): SuggestionItem[] {
  const score = fuzzyScore(parsed.argPartial, "model") ?? 0;
  return [
    {
      key: "model:selector",
      label: "/model",
      description: "Open model and reasoning selector",
      applyValue: "/model ",
      score
    }
  ].map(({ score: _score, ...item }) => item);
}

function describeCommand(name: string, fallback: string, ctx: SuggestionContext): string {
  if (name === "title") {
    const currentTitle = getActiveRunTitle(ctx);
    if (currentTitle) {
      return `Current: ${truncateForSuggestion(currentTitle)}`;
    }
  }
  return fallback;
}

function getActiveRunTitle(ctx: SuggestionContext): string | undefined {
  if (!ctx.activeRunId) {
    return undefined;
  }
  return ctx.runs.find((run) => run.id === ctx.activeRunId)?.title;
}

function truncateForSuggestion(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= 48) {
    return normalized;
  }
  return `${normalized.slice(0, 45)}...`;
}

function enumSuggestions(prefix: string, option: string, partial: string, values: string[]): SuggestionItem[] {
  return values
    .map((value) => {
      const score = fuzzyScore(partial, value);
      if (score === null) {
        return null;
      }
      return {
        key: `collect-enum:${option}:${value}`,
        label: `${prefix} ${option} ${value}`,
        description: "Collect option value",
        applyValue: `${prefix} ${option} ${value} `,
        score
      };
    })
    .filter((x): x is SuggestionItem & { score: number } => Boolean(x))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ score: _score, ...item }) => item);
}

function nodeSuggestions(partial: string, prefix: string): SuggestionItem[] {
  return AGENT_ORDER.map((node) => {
    const score = fuzzyScore(partial, node);
    if (score === null) {
      return null;
    }
    return {
      key: `node:${node}`,
      label: `${prefix} ${node}`,
      description: "Graph node selector",
      applyValue: `${prefix} ${node} `,
      score
    };
  })
    .filter((x): x is SuggestionItem & { score: number } => Boolean(x))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ score: _score, ...item }) => item);
}

function runSuggestions(prefix: string, partial: string, runs: SlashContextRun[]): SuggestionItem[] {
  return runs
    .map((run) => {
      const scoreById = fuzzyScore(partial, run.id) ?? -1;
      const scoreByTitle = fuzzyScore(partial, run.title) ?? -1;
      const score = Math.max(scoreById, scoreByTitle);
      if (score < 0) {
        return null;
      }

      return {
        key: `run:${run.id}`,
        label: `${run.id}  ${run.title}`,
        description: `${run.currentNode} · ${run.status} · ${relativeTime(run.updatedAt)}`,
        applyValue: `/${prefix} ${run.id}`,
        score
      };
    })
    .filter((x): x is SuggestionItem & { score: number } => Boolean(x))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ score: _score, ...item }) => item);
}

function parseSlashInput(input: string): ParsedInput {
  const normalized = normalizeSlashPrefix(input);
  const body = normalized.slice(1);
  const trimmed = body.trim();

  if (!trimmed) {
    return {
      commandQuery: "",
      commandName: undefined,
      args: [],
      argIndex: -1,
      argPartial: ""
    };
  }

  if (!body.includes(" ")) {
    return {
      commandQuery: trimmed.toLowerCase(),
      commandName: undefined,
      args: [],
      argIndex: -1,
      argPartial: ""
    };
  }

  const commandName = body.split(/\s+/)[0].toLowerCase();
  const afterCommand = body.slice(commandName.length).trimStart();
  const endsWithSpace = normalized.endsWith(" ");
  const args = afterCommand ? afterCommand.split(/\s+/).filter(Boolean) : [];
  const argIndex = endsWithSpace ? args.length : Math.max(0, args.length - 1);
  const argPartial = endsWithSpace ? "" : args[argIndex] ?? "";

  return {
    commandQuery: commandName,
    commandName,
    args,
    argIndex,
    argPartial
  };
}

export function isValidGraphNode(value: string): value is AgentId {
  return AGENT_ORDER.includes(value as AgentId);
}

function normalizeSlashPrefix(input: string): string {
  if (input.startsWith("／")) {
    return `/${input.slice(1)}`;
  }
  return input;
}

function normalizePositiveInt(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return undefined;
  }
  return String(Math.floor(n));
}
