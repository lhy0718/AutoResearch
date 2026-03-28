export interface OperatorSummaryReference {
  label: string;
  path: string;
}

export interface OperatorSummaryInput {
  runId: string;
  title: string;
  stage: "analysis" | "review" | "paper";
  summary: string[];
  decision?: string;
  blockers?: string[];
  openQuestions?: string[];
  nextActions?: string[];
  references?: OperatorSummaryReference[];
}

export function renderOperatorSummaryMarkdown(input: OperatorSummaryInput): string {
  const lines: string[] = [
    `# Operator Summary`,
    "",
    `- Run: ${input.runId}`,
    `- Title: ${input.title}`,
    `- Stage: ${input.stage}`,
    ""
  ];

  appendSection(lines, "Summary", input.summary);
  appendSection(lines, "Decision", input.decision ? [input.decision] : []);
  appendSection(lines, "Blockers", input.blockers || []);
  appendSection(lines, "Open Questions", input.openQuestions || []);
  appendSection(lines, "Next Actions", input.nextActions || []);

  if (input.references && input.references.length > 0) {
    lines.push("## Artifact Map", "");
    for (const reference of input.references) {
      lines.push(`- ${reference.label}: \`${reference.path}\``);
    }
    lines.push("");
  }

  lines.push(
    "Canonical JSON artifacts remain the source of truth; this note is an additive operator-facing mirror.",
    ""
  );
  return `${lines.join("\n")}\n`;
}

function appendSection(target: string[], heading: string, items: string[]): void {
  if (items.length === 0) {
    return;
  }
  target.push(`## ${heading}`, "");
  for (const item of items) {
    target.push(`- ${item}`);
  }
  target.push("");
}
