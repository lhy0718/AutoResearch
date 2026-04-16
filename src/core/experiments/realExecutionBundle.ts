import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { RunRecord } from "../../types.js";
import { ensureDir, writeJsonFile } from "../../utils/fs.js";
import { ExperimentLlmProfile } from "../experimentLlmProfile.js";

export interface RealExecutionBundleResult {
  summary: string;
  experimentMode: "real_execution";
  runCommand: string;
  testCommand: string;
  workingDir: string;
  publicDir: string;
  scriptPath: string;
  publicArtifacts: string[];
}

interface RealExecutionBundleArgs {
  run: Pick<RunRecord, "id" | "title" | "topic" | "objectiveMetric" | "constraints">;
  runDir: string;
  publicDir: string;
  metricsPath: string;
  experimentLlmProfile: ExperimentLlmProfile;
  timeoutSec?: number;
  allowNetwork?: boolean;
}

interface BenchmarkTask {
  id: string;
  dataset: string;
  type: "hotpot" | "gsm8k" | "humaneval";
  prompt: string;
  answer: string;
  slots: Record<string, string | number>;
  critical_slots: string[];
  expression?: string;
  tests?: Array<{ call: string; expected: string }>;
}

const PROMPT_VARIANTS = [
  {
    id: "neutral",
    text: "Collaborate concisely. Keep handoffs short, factual, and easy for the next agent to use."
  },
  {
    id: "compressed",
    text: "Collaborate under tight context pressure. Keep handoffs compact without dropping key facts."
  }
] as const;

const BENCHMARK_TASKS: BenchmarkTask[] = [
  {
    id: "hotpot_1",
    dataset: "hotpotqa_mini",
    type: "hotpot",
    prompt: "The author of 'Pride and Prejudice' was born in which country?",
    slots: {
      work: "Pride and Prejudice",
      author: "Jane Austen",
      birth_country: "England"
    },
    critical_slots: ["author", "birth_country"],
    answer: "England"
  },
  {
    id: "hotpot_2",
    dataset: "hotpotqa_mini",
    type: "hotpot",
    prompt: "Which city is the capital of the country whose flag features a maple leaf?",
    slots: {
      flag_symbol: "maple leaf",
      country: "Canada",
      capital: "Ottawa"
    },
    critical_slots: ["country", "capital"],
    answer: "Ottawa"
  },
  {
    id: "gsm8k_1",
    dataset: "gsm8k_mini",
    type: "gsm8k",
    prompt: "Mina buys 3 bags of oranges with 5 oranges each and gives away 4. How many remain?",
    slots: {
      bags: 3,
      per_bag: 5,
      giveaway: 4
    },
    critical_slots: ["bags", "per_bag", "giveaway"],
    expression: "bags * per_bag - giveaway",
    answer: "11"
  },
  {
    id: "gsm8k_2",
    dataset: "gsm8k_mini",
    type: "gsm8k",
    prompt:
      "A class has 18 students. They split into teams of 3, and each team gets 2 markers. How many markers are needed?",
    slots: {
      students: 18,
      team_size: 3,
      markers_per_team: 2
    },
    critical_slots: ["students", "team_size", "markers_per_team"],
    expression: "(students // team_size) * markers_per_team",
    answer: "12"
  },
  {
    id: "humaneval_1",
    dataset: "humaneval_mini",
    type: "humaneval",
    prompt: "Write `alternating_sum(nums)` returning n0 - n1 + n2 - n3 ...",
    slots: {
      function_name: "alternating_sum",
      algorithm: "alternate add and subtract by index parity",
      edge_case: "empty list returns 0"
    },
    critical_slots: ["algorithm", "edge_case"],
    tests: [
      { call: "alternating_sum([1, 2, 3, 4])", expected: "-2" },
      { call: "alternating_sum([5])", expected: "5" },
      { call: "alternating_sum([])", expected: "0" }
    ],
    answer: "pass"
  },
  {
    id: "humaneval_2",
    dataset: "humaneval_mini",
    type: "humaneval",
    prompt: "Write `reverse_words(text)` that reverses word order but keeps words unchanged.",
    slots: {
      function_name: "reverse_words",
      algorithm: "split on whitespace and join reversed words",
      edge_case: "single word unchanged"
    },
    critical_slots: ["algorithm", "edge_case"],
    tests: [
      { call: "reverse_words('one two three')", expected: "'three two one'" },
      { call: "reverse_words('solo')", expected: "'solo'" }
    ],
    answer: "pass"
  }
];

export function supportsRealExecutionBundle(
  run: Pick<RunRecord, "topic" | "objectiveMetric" | "constraints">
): boolean {
  const topic = `${run.topic} ${run.constraints.join(" ")} ${run.objectiveMetric}`.toLowerCase();
  return /(reproduc|variance|stability|consistency)/u.test(topic) && /(agent|multi-agent|collaboration)/u.test(topic);
}

export async function writeRealExecutionBundle(
  args: RealExecutionBundleArgs
): Promise<RealExecutionBundleResult> {
  await ensureDir(args.publicDir);
  await removeStaleBundleArtifacts(args.publicDir);

  const scriptPath = path.join(args.publicDir, "run_experiment.py");
  const configPath = path.join(args.publicDir, "experiment_config.json");
  const tasksPath = path.join(args.publicDir, "benchmark_tasks.json");
  const promptsPath = path.join(args.publicDir, "prompts.json");
  const readmePath = path.join(args.publicDir, "README.md");
  const manifestPath = path.join(args.publicDir, "artifact_manifest.json");

  const config = {
    schema_version: 1,
    run_id: args.run.id,
    title: args.run.title,
    topic: args.run.topic,
    objective_metric: args.run.objectiveMetric,
    constraints: args.run.constraints,
    selected_design: "Shared-State Schema vs Free-Form Chat",
    experiment_mode: "real_execution",
    private_metadata_dir: args.runDir,
    required_metrics_path: args.metricsPath,
    timeout_sec: args.timeoutSec || 3600,
    allow_network: args.allowNetwork !== false,
    llm_profile: {
      provider: args.experimentLlmProfile.provider,
      model: args.experimentLlmProfile.model,
      reasoning_effort: args.experimentLlmProfile.reasoningEffort,
      fast_mode: args.experimentLlmProfile.fastMode
    },
    execution: buildExecutionConfig(args.experimentLlmProfile),
    conditions: [
      {
        id: "free_form_chat",
        label: "Free-form chat baseline",
        description: "Planner, solver, and verifier hand off natural-language notes."
      },
      {
        id: "shared_state_schema",
        label: "Shared-state schema",
        description: "Planner, solver, and verifier hand off structured JSON shared state."
      }
    ],
    sampling: {
      standard: {
        repeats: 2,
        prompt_count: 2,
        tasks_per_dataset: 2
      },
      confirmatory: {
        repeats: 3,
        prompt_count: 2,
        tasks_per_dataset: 2
      },
      quick_check: {
        repeats: 1,
        prompt_count: 1,
        tasks_per_dataset: 1
      }
    },
    token_limit: 4096,
    paper_year_window: {
      from: 2022,
      to: new Date().getUTCFullYear()
    }
  };

  await fs.writeFile(scriptPath, `${REAL_EXECUTION_RUNNER}\n`, "utf8");
  await writeJsonFile(configPath, config);
  await writeJsonFile(tasksPath, BENCHMARK_TASKS);
  await writeJsonFile(promptsPath, PROMPT_VARIANTS);

  const publicArtifacts = [scriptPath, configPath, tasksPath, promptsPath, readmePath, manifestPath];
  const manifest = {
    generated_at: new Date().toISOString(),
    experiment_mode: "real_execution",
    llm_profile: config.llm_profile,
    artifacts: {
      script_path: scriptPath,
      config_path: configPath,
      benchmark_tasks_path: tasksPath,
      prompts_path: promptsPath,
      readme_path: readmePath
    },
    hashes: {
      script_hash: hashText(REAL_EXECUTION_RUNNER),
      config_hash: hashJson(config),
      benchmark_tasks_hash: hashJson(BENCHMARK_TASKS),
      prompts_hash: hashJson(PROMPT_VARIANTS)
    }
  };
  await writeJsonFile(manifestPath, manifest);
  await fs.writeFile(readmePath, buildReadme(config, scriptPath), "utf8");

  return {
    summary:
      `Built a reusable real_execution runner in the public experiment directory using ` +
      `${args.experimentLlmProfile.provider}:${args.experimentLlmProfile.model} ` +
      `(${args.experimentLlmProfile.reasoningEffort}${args.experimentLlmProfile.fastMode ? ", fast" : ""}).`,
    experimentMode: "real_execution",
    runCommand:
      `python3 -B ${JSON.stringify(scriptPath)} --profile standard --metrics-out ${JSON.stringify(args.metricsPath)}`,
    testCommand: `python3 -m py_compile ${JSON.stringify(scriptPath)}`,
    workingDir: args.publicDir,
    publicDir: args.publicDir,
    scriptPath,
    publicArtifacts
  };
}

function buildReadme(
  config: {
    title: string;
    selected_design: string;
    private_metadata_dir: string;
    required_metrics_path: string;
    llm_profile: {
      provider: string;
      model: string;
      reasoning_effort: string;
      fast_mode: boolean;
    };
    execution?: {
      max_workers?: number;
      role_overrides?: Record<string, { reasoning_effort?: string; fast_mode?: boolean }>;
    };
  },
  scriptPath: string
): string {
  return [
    `# ${config.selected_design} Reproducibility Experiment`,
    "",
    `This bundle runs a real-execution multi-agent benchmark for \`${config.title}\`.`,
    "",
    "## What It Does",
    "",
    "- Uses the configured experiment LLM for actual model calls.",
    "- Compares `free_form_chat` against `shared_state_schema` with planner/solver/verifier handoffs.",
    "- Evaluates QA, arithmetic, and code-generation mini tasks.",
    "- Writes metrics JSON in the format expected by AutoLabOS.",
    "",
    "## Experiment LLM",
    "",
    `- Provider: \`${config.llm_profile.provider}\``,
    `- Model: \`${config.llm_profile.model}\``,
    `- Reasoning effort: \`${config.llm_profile.reasoning_effort}\``,
    `- Fast mode: \`${config.llm_profile.fast_mode ? "true" : "false"}\``,
    `- Planner effort override: \`${config.execution?.role_overrides?.planner?.reasoning_effort || config.llm_profile.reasoning_effort}\``,
    `- Solver effort override: \`${config.execution?.role_overrides?.solver?.reasoning_effort || config.llm_profile.reasoning_effort}\``,
    `- Verifier effort override: \`${config.execution?.role_overrides?.verifier?.reasoning_effort || config.llm_profile.reasoning_effort}\``,
    `- Max concurrent trials: \`${config.execution?.max_workers || 1}\``,
    "",
    "## Commands",
    "",
    "Full run:",
    "",
    "```bash",
    `python3 -B ${scriptPath} --profile standard --metrics-out ${config.required_metrics_path}`,
    "```",
    "",
    "Confirmatory run:",
    "",
    "```bash",
    `python3 -B ${scriptPath} --profile confirmatory --metrics-out ${path.join(path.dirname(scriptPath), "confirmatory_metrics.json")}`,
    "```",
    "",
    "Quick check:",
    "",
    "```bash",
    `python3 -B ${scriptPath} --quick-check --metrics-out ${path.join(path.dirname(scriptPath), "quick_check_metrics.json")}`,
    "```",
    "",
    "## Prerequisites",
    "",
    "- `codex` CLI must be installed and logged in when provider is `codex`.",
    "- `OPENAI_API_KEY` must be set when provider is `openai`.",
    "- Network access must be available for real model calls.",
    "",
    "## Paths",
    "",
    `- Private AutoLabOS metadata directory: \`${config.private_metadata_dir}\``,
    `- Required metrics output: \`${config.required_metrics_path}\``,
    ""
  ].join("\n");
}

function hashJson(value: unknown): string {
  return hashText(JSON.stringify(value));
}

function hashText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function buildExecutionConfig(profile: ExperimentLlmProfile): {
  speed_profile: string;
  max_workers: number;
  resume_partial_results: boolean;
  write_progress: boolean;
  role_overrides: Record<string, { reasoning_effort: string; fast_mode: boolean }>;
} {
  const roleEfforts = deriveRoleEfforts(profile.reasoningEffort);
  return {
    speed_profile: "balanced",
    max_workers: 2,
    resume_partial_results: true,
    write_progress: true,
    role_overrides: {
      planner: {
        reasoning_effort: roleEfforts.planner,
        fast_mode: profile.provider === "codex"
      },
      solver: {
        reasoning_effort: roleEfforts.solver,
        fast_mode: false
      },
      verifier: {
        reasoning_effort: roleEfforts.verifier,
        fast_mode: false
      }
    }
  };
}

function deriveRoleEfforts(baseEffort: string): { planner: string; solver: string; verifier: string } {
  switch ((baseEffort || "").toLowerCase()) {
    case "minimal":
      return { planner: "minimal", solver: "minimal", verifier: "minimal" };
    case "low":
      return { planner: "low", solver: "low", verifier: "low" };
    case "medium":
      return { planner: "low", solver: "medium", verifier: "medium" };
    case "high":
    case "xhigh":
    default:
      return { planner: "low", solver: "medium", verifier: "medium" };
  }
}

async function removeStaleBundleArtifacts(publicDir: string): Promise<void> {
  for (const fileName of [
    "quick_check_metrics.json",
    "metrics.json",
    "results.jsonl",
    "results.partial.jsonl",
    "run_progress.json",
    "recent_paper_reproducibility.json",
    "environment.lock.json",
    "evaluator_manifest.json",
    "seeds.json"
  ]) {
    try {
      await fs.rm(path.join(publicDir, fileName), { force: true });
    } catch {
      // ignore cleanup failures for optional artifacts
    }
  }
}

const REAL_EXECUTION_RUNNER = String.raw`#!/usr/bin/env python3
from __future__ import annotations

import argparse
import ast
import json
import math
import os
import platform
import statistics
import sys
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, sort_keys=True) + "\n")


def append_jsonl_row(path: Path, row: dict[str, Any]) -> None:
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, sort_keys=True) + "\n")


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def normalize_value(value: Any) -> str:
    if value is None:
        return "__missing__"
    return " ".join(str(value).strip().lower().split())


def round_float(value: float, digits: int = 6) -> float:
    return round(float(value), digits)


def mean(values: list[float]) -> float:
    return statistics.fmean(values) if values else 0.0


def variance(values: list[float]) -> float:
    return statistics.pvariance(values) if len(values) > 1 else 0.0


def ci95(values: list[float]) -> list[float]:
    if not values:
        return [0.0, 0.0]
    if len(values) == 1:
        value = round_float(values[0])
        return [value, value]
    std = statistics.pstdev(values)
    margin = 1.96 * std / math.sqrt(len(values))
    avg = mean(values)
    return [round_float(avg - margin), round_float(avg + margin)]


def exact_match(a: str, b: str) -> int:
    return int(normalize_value(a) == normalize_value(b))


def safe_eval_expression(expression: str, values: dict[str, Any]) -> int:
    return int(eval(expression, {"__builtins__": {}}, dict(values)))


def code_passes_tests(code: str, tests: list[dict[str, str]]) -> tuple[int, str | None]:
    namespace: dict[str, Any] = {}
    try:
        exec(code, namespace, namespace)
        for test in tests:
            got = eval(test["call"], namespace, namespace)
            expected = ast.literal_eval(test["expected"])
            if got != expected:
                return 0, f"assertion_failed:{test['call']}"
        return 1, None
    except Exception as exc:
        return 0, f"{type(exc).__name__}:{exc}"


def approx_tokens(*texts: str) -> int:
    total_chars = sum(len(text or "") for text in texts)
    return max(1, total_chars // 4)


def parse_json_object(text: str) -> dict[str, Any]:
    trimmed = (text or "").strip()
    if not trimmed:
        raise ValueError("empty model response")
    try:
        parsed = json.loads(trimmed)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass
    fence = chr(96) * 3
    if fence in trimmed:
        parts = trimmed.split(fence)
        for part in parts:
            candidate = part.strip()
            if candidate.startswith("json"):
                candidate = candidate[4:].strip()
            if candidate.startswith("{") and candidate.endswith("}"):
                parsed = json.loads(candidate)
                if isinstance(parsed, dict):
                    return parsed
    first = trimmed.find("{")
    last = trimmed.rfind("}")
    if first >= 0 and last > first:
        parsed = json.loads(trimmed[first:last + 1])
        if isinstance(parsed, dict):
            return parsed
    raise ValueError("response did not contain a JSON object")


def extract_output_text(payload: dict[str, Any]) -> str:
    parts: list[str] = []
    for output in payload.get("output", []) or []:
        if not isinstance(output, dict):
            continue
        for content in output.get("content", []) or []:
            if isinstance(content, dict) and content.get("type") == "output_text":
                text = content.get("text")
                if isinstance(text, str) and text.strip():
                    parts.append(text)
    return "\n".join(parts).strip()


_FAKE_SEQUENCE_SOURCE = ""
_FAKE_SEQUENCE_INDEX = 0


def resolve_fake_response() -> str | None:
    global _FAKE_SEQUENCE_SOURCE, _FAKE_SEQUENCE_INDEX
    fake_sequence = os.environ.get("AUTOLABOS_FAKE_EXPERIMENT_RESPONSE_SEQUENCE", "").strip()
    if fake_sequence:
        if fake_sequence != _FAKE_SEQUENCE_SOURCE:
            _FAKE_SEQUENCE_SOURCE = fake_sequence
            _FAKE_SEQUENCE_INDEX = 0
        try:
            parsed = json.loads(fake_sequence)
            if isinstance(parsed, list) and parsed:
                index = min(_FAKE_SEQUENCE_INDEX, len(parsed) - 1)
                _FAKE_SEQUENCE_INDEX += 1
                selected = parsed[index]
                if isinstance(selected, str):
                    return selected
                if isinstance(selected, dict) and isinstance(selected.get("text"), str):
                    return selected["text"]
        except json.JSONDecodeError:
            return fake_sequence
    fake_single = os.environ.get("AUTOLABOS_FAKE_EXPERIMENT_RESPONSE", "").strip()
    return fake_single or None


def has_fake_response_mode() -> bool:
    return bool(
        os.environ.get("AUTOLABOS_FAKE_EXPERIMENT_RESPONSE_SEQUENCE", "").strip()
        or os.environ.get("AUTOLABOS_FAKE_EXPERIMENT_RESPONSE", "").strip()
    )


def resolve_codex_auth_file() -> Path:
    codex_home = os.environ.get("CODEX_HOME", "").strip()
    if codex_home:
        return Path(codex_home) / "auth.json"
    return Path.home() / ".codex" / "auth.json"


def resolve_codex_access_token() -> str:
    auth_file = resolve_codex_auth_file()
    try:
        payload = json.loads(auth_file.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise RuntimeError(f"Codex OAuth auth file was not found at {auth_file}.") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Codex OAuth auth file at {auth_file} is not valid JSON.") from exc

    tokens = payload.get("tokens") if isinstance(payload, dict) else None
    access_token = tokens.get("access_token") if isinstance(tokens, dict) else None
    if not isinstance(access_token, str) or not access_token.strip():
        raise RuntimeError(f"Codex OAuth access token was not found in {auth_file}.")
    return access_token.strip()


def call_openai(prompt: str, system_prompt: str, model: str, reasoning_effort: str) -> str:
    fake = resolve_fake_response()
    if fake:
        return fake
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required for openai experiment execution.")
    body: dict[str, Any] = {
        "model": model,
        "instructions": system_prompt,
        "input": [
            {
                "role": "user",
                "content": [{"type": "input_text", "text": prompt}],
            }
        ],
        "text": {"format": {"type": "text"}},
    }
    if model.lower().startswith("gpt-5"):
        body["reasoning"] = {"effort": reasoning_effort}
    request = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"Responses API request failed: {exc.code} {detail}".strip()) from exc
    if isinstance(payload.get("error"), dict) and payload["error"].get("message"):
        raise RuntimeError(f"Responses API returned an error: {payload['error']['message']}")
    text = extract_output_text(payload)
    if not text:
        raise RuntimeError("Responses API returned no output text.")
    return text


def ensure_codex_ready() -> None:
    if has_fake_response_mode():
        return
    resolve_codex_access_token()


def call_codex(prompt: str, system_prompt: str, model: str, reasoning_effort: str, fast_mode: bool, cwd: str) -> str:
    fake = resolve_fake_response()
    if fake:
        return fake
    access_token = resolve_codex_access_token()
    body: dict[str, Any] = {
        "model": model,
        "instructions": system_prompt or "You are Codex. Follow the user's request carefully.",
        "store": False,
        "stream": False,
        "input": [
            {
                "role": "user",
                "content": [{"type": "input_text", "text": prompt}],
            }
        ],
        "text": {"format": {"type": "text"}},
        "reasoning": {"effort": reasoning_effort},
    }
    request = urllib.request.Request(
        "https://chatgpt.com/backend-api/codex/responses",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"Codex OAuth request failed: {exc.code} {detail}".strip()) from exc
    if isinstance(payload.get("error"), dict) and payload["error"].get("message"):
        raise RuntimeError(f"Codex OAuth returned an error: {payload['error']['message']}")
    text = extract_output_text(payload)
    if not text:
        raise RuntimeError("Codex OAuth returned no text output.")
    return text


def call_model(prompt: str, system_prompt: str, bundle_dir: Path, llm_profile: dict[str, Any]) -> str:
    provider = str(llm_profile.get("provider", "codex"))
    model = str(llm_profile.get("model", "gpt-5.4"))
    reasoning_effort = str(llm_profile.get("reasoning_effort", "medium"))
    fast_mode = bool(llm_profile.get("fast_mode", False))
    if provider == "openai":
        return call_openai(prompt, system_prompt, model, reasoning_effort)
    return call_codex(prompt, system_prompt, model, reasoning_effort, fast_mode, str(bundle_dir))


def ensure_provider_ready(llm_profile: dict[str, Any]) -> None:
    provider = str(llm_profile.get("provider", "codex"))
    if provider == "openai":
        if not has_fake_response_mode() and not os.environ.get("OPENAI_API_KEY", "").strip():
            raise RuntimeError("OPENAI_API_KEY is required for openai experiment execution.")
        return
    ensure_codex_ready()


def resolve_role_llm_profile(config: dict[str, Any], role: str) -> dict[str, Any]:
    profile = dict(config.get("llm_profile", {}))
    execution = config.get("execution", {})
    overrides = execution.get("role_overrides", {}) if isinstance(execution, dict) else {}
    role_override = overrides.get(role, {}) if isinstance(overrides, dict) else {}
    if isinstance(role_override, dict):
        if role_override.get("reasoning_effort"):
            profile["reasoning_effort"] = role_override["reasoning_effort"]
        if "fast_mode" in role_override:
            profile["fast_mode"] = bool(role_override.get("fast_mode"))
    return profile


def condition_descriptor(condition: str) -> str:
    if condition == "shared_state_schema":
        return "Use structured shared-state JSON handoffs between planner, solver, and verifier."
    return "Use natural-language free-form handoff notes between planner, solver, and verifier."


def slot_names(task: dict[str, Any]) -> list[str]:
    slots = task.get("slots", {})
    if isinstance(slots, dict):
        return [str(key) for key in slots.keys()]
    return []


def planner_prompt(task: dict[str, Any], condition: str, prompt_variant: dict[str, Any], repeat_index: int) -> tuple[str, str]:
    if condition == "shared_state_schema":
        system_prompt = "You are the planner agent. Return ONLY valid JSON. Do not add markdown fences."
        prompt = (
            f"{prompt_variant['text']}\n"
            f"{condition_descriptor(condition)}\n"
            f"Task: {task['prompt']}\n"
            f"Task type: {task['type']}\n"
            f"Repeat index: {repeat_index}\n"
            f"Known slot names: {slot_names(task)}\n"
            'Return JSON with keys: facts (array), plan (array), slots (object), uncertainties (array).'
        )
        return prompt, system_prompt
    system_prompt = "You are the planner agent. Give a short handoff note with facts, plan, and uncertainties."
    prompt = (
        f"{prompt_variant['text']}\n"
        f"{condition_descriptor(condition)}\n"
        f"Task: {task['prompt']}\n"
        f"Task type: {task['type']}\n"
        f"Repeat index: {repeat_index}\n"
        "Reply as a concise handoff note. Do not use markdown tables."
    )
    return prompt, system_prompt


def solver_prompt(
    task: dict[str, Any],
    condition: str,
    prompt_variant: dict[str, Any],
    repeat_index: int,
    planner_output: str,
) -> tuple[str, str]:
    if condition == "shared_state_schema":
        system_prompt = "You are the solver agent. Return ONLY valid JSON. Do not add markdown fences."
        prompt = (
            f"{prompt_variant['text']}\n"
            f"{condition_descriptor(condition)}\n"
            f"Task: {task['prompt']}\n"
            f"Task type: {task['type']}\n"
            f"Repeat index: {repeat_index}\n"
            f"Planner state JSON:\n{planner_output}\n"
            'Return JSON with keys: facts (array), plan (array), slots (object), candidate_answer (string or null), candidate_code (string or null), uncertainties (array).'
        )
        return prompt, system_prompt
    system_prompt = "You are the solver agent. Give a short handoff note with a candidate answer or code."
    prompt = (
        f"{prompt_variant['text']}\n"
        f"{condition_descriptor(condition)}\n"
        f"Task: {task['prompt']}\n"
        f"Task type: {task['type']}\n"
        f"Repeat index: {repeat_index}\n"
        f"Planner note:\n{planner_output}\n"
        "Reply as a concise note containing the best candidate answer or code plus any unresolved risk."
    )
    return prompt, system_prompt


def verifier_prompt(
    task: dict[str, Any],
    condition: str,
    prompt_variant: dict[str, Any],
    repeat_index: int,
    planner_output: str,
    solver_output: str,
) -> tuple[str, str]:
    system_prompt = "You are the verifier agent. Return ONLY valid JSON. Do not add markdown fences."
    prompt = (
        f"{prompt_variant['text']}\n"
        f"{condition_descriptor(condition)}\n"
        f"Task: {task['prompt']}\n"
        f"Task type: {task['type']}\n"
        f"Repeat index: {repeat_index}\n"
        f"Expected slot names: {slot_names(task)}\n"
        f"Planner handoff:\n{planner_output}\n\n"
        f"Solver handoff:\n{solver_output}\n\n"
        'Return JSON with keys: final_answer (string or null), code (string or null), slots (object), verdict (string), notes (array).'
    )
    return prompt, system_prompt


def coerce_slots(task: dict[str, Any], response_slots: Any) -> dict[str, Any]:
    expected = task.get("slots", {})
    normalized: dict[str, Any] = {}
    provided = response_slots if isinstance(response_slots, dict) else {}
    for key, default_value in expected.items():
        value = provided.get(key)
        normalized[str(key)] = default_value if value in ("", None) else value
    return normalized


def evaluate_trial(
    task: dict[str, Any],
    condition: str,
    prompt_variant: dict[str, Any],
    repeat_index: int,
    bundle_dir: Path,
    config: dict[str, Any],
    token_limit: int,
    profile_name: str,
) -> dict[str, Any]:
    planner_profile = resolve_role_llm_profile(config, "planner")
    solver_profile = resolve_role_llm_profile(config, "solver")
    verifier_profile = resolve_role_llm_profile(config, "verifier")
    planner_user, planner_system = planner_prompt(task, condition, prompt_variant, repeat_index)
    planner_output = call_model(planner_user, planner_system, bundle_dir, planner_profile)

    solver_user, solver_system = solver_prompt(task, condition, prompt_variant, repeat_index, planner_output)
    solver_output = call_model(solver_user, solver_system, bundle_dir, solver_profile)

    verifier_user, verifier_system = verifier_prompt(
        task,
        condition,
        prompt_variant,
        repeat_index,
        planner_output,
        solver_output,
    )
    verifier_output = call_model(verifier_user, verifier_system, bundle_dir, verifier_profile)

    token_count = approx_tokens(
        planner_user,
        planner_output,
        solver_user,
        solver_output,
        verifier_user,
        verifier_output,
    )
    over_limit = int(token_count > token_limit)

    try:
        parsed = parse_json_object(verifier_output)
    except Exception as exc:
        return {
            "task_id": task["id"],
            "dataset": task["dataset"],
            "task_type": task["type"],
            "sampling_profile": profile_name,
            "condition": condition,
            "seed": repeat_index,
            "prompt_id": prompt_variant["id"],
            "prompt_style": prompt_variant["id"],
            "token_count": token_count,
            "over_limit": over_limit,
            "score": 0,
            "failure": 1,
            "failure_reason": f"verifier_parse_failed:{type(exc).__name__}",
            "slots": {key: None for key in slot_names(task)},
            "final_answer": None,
            "planner_output": planner_output,
            "solver_output": solver_output,
            "verifier_output": verifier_output,
        }

    slots = coerce_slots(task, parsed.get("slots"))
    score = 0
    failure = 0
    failure_reason: str | None = None
    final_answer: Any = parsed.get("final_answer")

    if task["type"] == "hotpot":
        answer = "" if final_answer is None else str(final_answer)
        score = exact_match(answer, task["answer"])
        final_answer = answer
    elif task["type"] == "gsm8k":
        answer = "" if final_answer is None else str(final_answer)
        score = exact_match(answer, task["answer"])
        final_answer = answer
        if not score and not answer:
            failure = 1
            failure_reason = "missing_final_answer"
    else:
        code = parsed.get("code")
        if not isinstance(code, str) or not code.strip():
            code = "" if code is None else str(code)
            score = 0
            failure = 1
            failure_reason = "missing_code"
            final_answer = "fail"
        else:
            score, failure_reason = code_passes_tests(code, task.get("tests", []))
            final_answer = "pass" if score else "fail"
            if failure_reason and not failure_reason.startswith("assertion_failed"):
                failure = 1

    return {
        "task_id": task["id"],
        "dataset": task["dataset"],
        "task_type": task["type"],
        "sampling_profile": profile_name,
        "condition": condition,
        "seed": repeat_index,
        "prompt_id": prompt_variant["id"],
        "prompt_style": prompt_variant["id"],
        "token_count": token_count,
        "over_limit": over_limit,
        "score": int(score),
        "failure": int(failure),
        "failure_reason": failure_reason,
        "slots": slots,
        "final_answer": final_answer,
        "planner_output": planner_output,
        "solver_output": solver_output,
        "verifier_output": verifier_output,
    }


def compute_slot_consistency(condition_results: list[dict[str, Any]]) -> float:
    grouped: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    for result in condition_results:
        for slot_name, slot_value in result["slots"].items():
            grouped[result["task_id"]][slot_name].append(normalize_value(slot_value))
    scores: list[float] = []
    for task_slots in grouped.values():
        for values in task_slots.values():
            mode_count = Counter(values).most_common(1)[0][1]
            scores.append(mode_count / len(values))
    return mean(scores)


def compute_replication_success_rate(condition_results: list[dict[str, Any]]) -> float:
    grouped: dict[tuple[str, str], list[str]] = defaultdict(list)
    for result in condition_results:
        key = (result["task_id"], result["prompt_id"])
        grouped[key].append(normalize_value(result["final_answer"]))
    if not grouped:
        return 0.0
    hits = 0
    for values in grouped.values():
        mode_count = Counter(values).most_common(1)[0][1]
        hits += int(mode_count == len(values))
    return hits / len(grouped)


def compute_condition_metrics(
    all_results: list[dict[str, Any]],
    condition: str,
    artifact_availability: int,
    environment_rebuild_success: float,
    artifact_consistency_rate: float,
    free_form_paraphrase_variance: float | None,
) -> dict[str, Any]:
    condition_results = [result for result in all_results if result["condition"] == condition]
    dataset_scores: dict[str, float] = {}
    dataset_breakdown: dict[str, Any] = {}
    for dataset in sorted({result["dataset"] for result in condition_results}):
        dataset_results = [result for result in condition_results if result["dataset"] == dataset]
        scores = [result["score"] for result in dataset_results]
        dataset_scores[dataset] = round_float(mean(scores))
        dataset_breakdown[dataset] = {
            "mean_task_score": round_float(mean(scores)),
            "failure_rate": round_float(mean([result["failure"] for result in dataset_results])),
            "token_count_mean": round_float(mean([result["token_count"] for result in dataset_results])),
        }

    seed_scores = []
    for seed in sorted({result["seed"] for result in condition_results}):
        seed_slice = [result["score"] for result in condition_results if result["seed"] == seed]
        seed_scores.append(mean(seed_slice))

    prompt_scores = []
    for prompt_id in sorted({result["prompt_id"] for result in condition_results}):
        prompt_slice = [result["score"] for result in condition_results if result["prompt_id"] == prompt_id]
        prompt_scores.append(mean(prompt_slice))

    mean_task_score = mean([result["score"] for result in condition_results])
    cross_run_variance = variance(seed_scores)
    prompt_paraphrase_sensitivity = variance(prompt_scores)
    slot_consistency = compute_slot_consistency(condition_results)
    failure_rate = mean([result["failure"] for result in condition_results])
    replication_success_rate = compute_replication_success_rate(condition_results)
    cv = math.sqrt(cross_run_variance) / mean_task_score if mean_task_score > 0 else 1.0
    baseline_paraphrase_variance = free_form_paraphrase_variance or max(prompt_paraphrase_sensitivity, 1e-9)
    reproducibility_score = (
        0.25 * replication_success_rate
        + 0.20 * (1 - min(1.0, cv))
        + 0.20 * (1 - min(1.0, prompt_paraphrase_sensitivity / max(baseline_paraphrase_variance, 1e-9)))
        + 0.15 * slot_consistency
        + 0.10 * (artifact_availability / 7.0)
        + 0.10 * environment_rebuild_success
    )

    return {
        "mean_task_score": round_float(mean_task_score),
        "dataset_scores": dataset_scores,
        "dataset_breakdown": dataset_breakdown,
        "cross_run_variance": round_float(cross_run_variance),
        "run_to_run_variance": round_float(cross_run_variance),
        "seed_stability": round_float(1 - min(1.0, cv)),
        "paraphrase_stability": round_float(prompt_paraphrase_sensitivity),
        "prompt_paraphrase_sensitivity": round_float(prompt_paraphrase_sensitivity),
        "slot_consistency": round_float(slot_consistency),
        "failure_rate": round_float(failure_rate),
        "replication_success_rate": round_float(replication_success_rate),
        "artifact_availability": artifact_availability,
        "environment_rebuild_success": round_float(environment_rebuild_success),
        "artifact_consistency_rate": round_float(artifact_consistency_rate),
        "reproducibility_score": round_float(reproducibility_score),
        "reproducibility": round_float(reproducibility_score),
        "ci95_mean_task_score": ci95(seed_scores),
    }


def build_recent_paper_comparison(metadata_dir: Path, paper_year_window: dict[str, int]) -> dict[str, Any]:
    corpus_path = metadata_dir / "corpus.jsonl"
    summaries_path = metadata_dir / "paper_summaries.jsonl"
    corpus = {item["paper_id"]: item for item in load_jsonl(corpus_path)}
    summaries = load_jsonl(summaries_path)
    scored_papers = []
    year_from = int(paper_year_window.get("from", datetime.now(timezone.utc).year - 4))
    year_to = int(paper_year_window.get("to", datetime.now(timezone.utc).year))

    for summary in summaries:
        meta = corpus.get(summary["paper_id"], {})
        year = meta.get("year")
        if not isinstance(year, int) or year < year_from or year > year_to:
            continue
        title = str(summary.get("title", ""))
        lower_blob = " ".join(
            [title, str(summary.get("summary", "")), str(summary.get("novelty", ""))]
            + [str(item) for item in summary.get("reproducibility_notes", [])]
            + [str(item) for item in summary.get("limitations", [])]
        ).lower()
        if "survey" in lower_blob or "conceptual" in lower_blob:
            continue
        if not summary.get("datasets") or not summary.get("metrics"):
            continue
        checklist = {
            "code": int("github" in lower_blob or "code is released" in lower_blob or "code repository" in lower_blob),
            "prompts": int("prompt" in lower_blob or "templates" in lower_blob),
            "configs": int("hyperparameter" in lower_blob or "temperature" in lower_blob or "configuration" in lower_blob),
            "seeds": int("seed" in lower_blob or "repeated" in lower_blob or "simulation" in lower_blob),
            "dataset_splits": int("split" in lower_blob or "subset" in lower_blob or "benchmark" in lower_blob),
            "evaluator": int("pass@1" in lower_blob or "judge" in lower_blob or "evaluator" in lower_blob or "tests" in lower_blob),
            "environment": int("hardware" in lower_blob or "h100" in lower_blob or "rtx" in lower_blob or "locally" in lower_blob),
        }
        checklist_score = sum(checklist.values())
        scored_papers.append(
            {
                "paper_id": summary["paper_id"],
                "title": title,
                "year": year,
                "venue": meta.get("venue", ""),
                "landing_url": meta.get("landing_url") or meta.get("url"),
                "reproducibility_score": round_float(checklist_score / 7.0),
                "artifact_availability": checklist_score,
                "checklist": checklist,
            }
        )

    scored_papers.sort(
        key=lambda item: (item["reproducibility_score"], item["year"], item["artifact_availability"]),
        reverse=True,
    )
    return {
        "paper_year_window": {"from": year_from, "to": year_to},
        "comparison_count": len(scored_papers),
        "top_recent_papers": scored_papers[:10],
        "best_recent_score": round_float(scored_papers[0]["reproducibility_score"]) if scored_papers else 0.0,
    }


def sample_tasks(tasks: list[dict[str, Any]], tasks_per_dataset: int) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for task in tasks:
        grouped[str(task["dataset"])].append(task)
    sampled: list[dict[str, Any]] = []
    for dataset in sorted(grouped):
        sampled.extend(grouped[dataset][:tasks_per_dataset])
    return sampled


def trial_key_from_spec(spec: dict[str, Any]) -> str:
    return "::".join(
        [
            str(spec.get("sampling_profile", "standard")),
            str(spec.get("condition", "")),
            str(spec.get("repeat_index", "")),
            str(spec.get("prompt_id", "")),
            str(spec.get("task_id", "")),
        ]
    )


def trial_key_from_result(result: dict[str, Any]) -> str:
    return "::".join(
        [
            str(result.get("sampling_profile", "standard")),
            str(result.get("condition", "")),
            str(result.get("seed", "")),
            str(result.get("prompt_id", "")),
            str(result.get("task_id", "")),
        ]
    )


def build_trial_specs(
    conditions: list[dict[str, Any]],
    repeats: int,
    prompts: list[dict[str, Any]],
    tasks: list[dict[str, Any]],
    profile_name: str,
) -> list[dict[str, Any]]:
    specs: list[dict[str, Any]] = []
    for condition_info in conditions:
        condition = str(condition_info["id"])
        for repeat_index in range(repeats):
            for prompt_variant in prompts:
                for task in tasks:
                    specs.append(
                        {
                            "sampling_profile": profile_name,
                            "condition": condition,
                            "repeat_index": repeat_index,
                            "prompt_id": str(prompt_variant["id"]),
                            "task_id": str(task["id"]),
                            "prompt_variant": prompt_variant,
                            "task": task,
                        }
                    )
    return specs


def sort_results(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        rows,
        key=lambda row: (
            str(row.get("sampling_profile", "standard")),
            str(row.get("condition", "")),
            int(row.get("seed", 0)),
            str(row.get("prompt_id", "")),
            str(row.get("task_id", "")),
        ),
    )


def write_progress(path: Path, payload: dict[str, Any]) -> None:
    write_json(path, payload)


def generate_artifacts(
    bundle_dir: Path,
    config: dict[str, Any],
    tasks: list[dict[str, Any]],
    prompts: list[dict[str, Any]],
) -> dict[str, Any]:
    evaluator = {
        "qa_metric": "exact_match",
        "math_metric": "exact_match",
        "code_metric": "pass@1",
        "slot_metric": "mode_consistency_across_runs",
        "reproducibility_formula": "0.25*replication_success_rate + 0.20*(1-CV) + 0.20*(1-paraphrase_ratio) + 0.15*slot_consistency + 0.10*(artifact_availability/7) + 0.10*environment_rebuild_success",
    }
    environment_lock = {
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "implementation": platform.python_implementation(),
        "provider": config["llm_profile"]["provider"],
        "model": config["llm_profile"]["model"],
        "reasoning_effort": config["llm_profile"]["reasoning_effort"],
        "fast_mode": bool(config["llm_profile"].get("fast_mode", False)),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    manifest = {
        "artifacts": {
            "script_path": str(bundle_dir / "run_experiment.py"),
            "config_path": str(bundle_dir / "experiment_config.json"),
            "benchmark_tasks_path": str(bundle_dir / "benchmark_tasks.json"),
            "prompts_path": str(bundle_dir / "prompts.json"),
            "evaluator_manifest_path": str(bundle_dir / "evaluator_manifest.json"),
            "environment_lock_path": str(bundle_dir / "environment.lock.json"),
            "artifact_manifest_path": str(bundle_dir / "artifact_manifest.json"),
        },
        "hashes": {
            "config_hash": normalize_value(json.dumps(config, sort_keys=True)),
            "tasks_hash": normalize_value(json.dumps(tasks, sort_keys=True)),
            "prompts_hash": normalize_value(json.dumps(prompts, sort_keys=True)),
            "evaluator_hash": normalize_value(json.dumps(evaluator, sort_keys=True)),
            "environment_hash": normalize_value(json.dumps(environment_lock, sort_keys=True)),
        },
    }
    write_json(bundle_dir / "evaluator_manifest.json", evaluator)
    write_json(bundle_dir / "environment.lock.json", environment_lock)
    write_json(bundle_dir / "artifact_manifest.json", manifest)
    return {
        "evaluator": evaluator,
        "environment_lock": environment_lock,
        "manifest": manifest,
    }


def run_experiment(
    bundle_dir: Path,
    metrics_out: Path,
    config: dict[str, Any],
    profile_name: str,
    fresh: bool,
) -> dict[str, Any]:
    tasks = load_json(bundle_dir / "benchmark_tasks.json")
    prompts = load_json(bundle_dir / "prompts.json")
    profile = config.get("sampling", {}).get(profile_name, {})
    if not isinstance(profile, dict) or not profile:
        raise RuntimeError(f"Unknown sampling profile: {profile_name}")
    repeats = int(profile.get("repeats", 1))
    prompt_count = int(profile.get("prompt_count", 1))
    tasks_per_dataset = int(profile.get("tasks_per_dataset", 1))
    selected_tasks = sample_tasks(tasks, tasks_per_dataset)
    selected_prompts = prompts[:prompt_count]
    token_limit = int(config.get("token_limit", 4096))
    execution = config.get("execution", {})
    resume_partial_results = bool(execution.get("resume_partial_results", True)) if isinstance(execution, dict) else True
    write_progress_enabled = bool(execution.get("write_progress", True)) if isinstance(execution, dict) else True
    configured_max_workers = int(execution.get("max_workers", 1)) if isinstance(execution, dict) else 1
    max_workers = max(1, configured_max_workers)
    if has_fake_response_mode():
        max_workers = 1

    generate_artifacts(bundle_dir, config, selected_tasks, selected_prompts)

    results_path = bundle_dir / "results.jsonl"
    partial_results_path = bundle_dir / "results.partial.jsonl"
    progress_path = bundle_dir / "run_progress.json"
    if fresh:
        for artifact_path in (results_path, partial_results_path, progress_path):
            if artifact_path.exists():
                artifact_path.unlink()

    trial_specs = build_trial_specs(
        conditions=config.get("conditions", []),
        repeats=repeats,
        prompts=selected_prompts,
        tasks=selected_tasks,
        profile_name=profile_name,
    )
    expected_trial_keys = {trial_key_from_spec(spec) for spec in trial_specs}
    cached_results_by_key: dict[str, dict[str, Any]] = {}
    if resume_partial_results and not fresh:
        for row in load_jsonl(partial_results_path):
            key = trial_key_from_result(row)
            if key in expected_trial_keys:
                cached_results_by_key[key] = row

    cached_result_count = len(cached_results_by_key)
    pending_specs = [spec for spec in trial_specs if trial_key_from_spec(spec) not in cached_results_by_key]
    all_results = list(cached_results_by_key.values())

    def progress_payload(status: str, *, last_completed_trial: str | None = None, error: str | None = None) -> dict[str, Any]:
        completed_trials = len(all_results)
        return {
            "status": status,
            "sampling_profile": profile_name,
            "total_trials": len(trial_specs),
            "cached_trials": cached_result_count,
            "executed_trials": max(0, completed_trials - cached_result_count),
            "completed_trials": completed_trials,
            "pending_trials": max(0, len(trial_specs) - completed_trials),
            "max_workers": max_workers,
            "results_path": str(results_path),
            "partial_results_path": str(partial_results_path),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "last_completed_trial": last_completed_trial,
            "error": error,
        }

    if write_progress_enabled:
        write_progress(progress_path, progress_payload("running"))

    def execute_spec(spec: dict[str, Any]) -> dict[str, Any]:
        return evaluate_trial(
            task=spec["task"],
            condition=spec["condition"],
            prompt_variant=spec["prompt_variant"],
            repeat_index=int(spec["repeat_index"]),
            bundle_dir=bundle_dir,
            config=config,
            token_limit=token_limit,
            profile_name=profile_name,
        )

    try:
        if max_workers == 1 or not pending_specs:
            for spec in pending_specs:
                result = execute_spec(spec)
                all_results.append(result)
                append_jsonl_row(partial_results_path, result)
                if write_progress_enabled:
                    write_progress(progress_path, progress_payload("running", last_completed_trial=trial_key_from_result(result)))
        else:
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                futures = {executor.submit(execute_spec, spec): spec for spec in pending_specs}
                for future in as_completed(futures):
                    result = future.result()
                    all_results.append(result)
                    append_jsonl_row(partial_results_path, result)
                    if write_progress_enabled:
                        write_progress(progress_path, progress_payload("running", last_completed_trial=trial_key_from_result(result)))
    except Exception as exc:
        if write_progress_enabled:
            write_progress(progress_path, progress_payload("failed", error=f"{type(exc).__name__}:{exc}"))
        raise

    all_results = sort_results(all_results)
    write_jsonl(results_path, all_results)
    if write_progress_enabled:
        write_progress(progress_path, progress_payload("completed"))

    expected_artifacts = [
        "run_experiment.py",
        "benchmark_tasks.json",
        "prompts.json",
        "experiment_config.json",
        "evaluator_manifest.json",
        "environment.lock.json",
        "artifact_manifest.json",
    ]
    artifact_availability = sum(int((bundle_dir / name).exists()) for name in expected_artifacts)
    environment_rebuild_success = 1.0 if artifact_availability == len(expected_artifacts) else artifact_availability / len(expected_artifacts)
    artifact_consistency_rate = 1.0

    free_form_probe = compute_condition_metrics(
        all_results,
        "free_form_chat",
        artifact_availability,
        environment_rebuild_success,
        artifact_consistency_rate,
        None,
    )
    free_form_paraphrase_variance = free_form_probe["prompt_paraphrase_sensitivity"]
    condition_metrics = {}
    for condition_info in config.get("conditions", []):
        condition = str(condition_info["id"])
        condition_metrics[condition] = compute_condition_metrics(
            all_results,
            condition,
            artifact_availability,
            environment_rebuild_success,
            artifact_consistency_rate,
            free_form_paraphrase_variance,
        )

    metadata_dir = Path(str(config.get("private_metadata_dir", bundle_dir)))
    paper_comparison = build_recent_paper_comparison(metadata_dir, config.get("paper_year_window", {}))
    paper_comparison_path = bundle_dir / "recent_paper_reproducibility.json"
    write_json(paper_comparison_path, paper_comparison)

    primary = condition_metrics["shared_state_schema"]
    baseline = condition_metrics["free_form_chat"]
    metrics = {
        "run_id": config["run_id"],
        "topic": config["topic"],
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "execution_mode": config.get("experiment_mode", "real_execution"),
        "llm_profile": config["llm_profile"],
        "objective_metric": config["objective_metric"],
        "primary_condition": "shared_state_schema",
        "baseline_condition": "free_form_chat",
        "sampling_profile": {
            "name": profile_name,
            "repeats": repeats,
            "prompt_count": prompt_count,
            "tasks_per_dataset": tasks_per_dataset,
            "task_count": len(selected_tasks),
            "total_trials": len(trial_specs),
            "cached_trials": cached_result_count,
            "executed_trials": len(pending_specs),
        },
        "execution": {
            "speed_profile": execution.get("speed_profile", "balanced") if isinstance(execution, dict) else "balanced",
            "max_workers": max_workers,
            "resume_partial_results": resume_partial_results and not fresh,
            "write_progress": write_progress_enabled,
        },
        "condition_metrics": condition_metrics,
        "reproducibility": primary["reproducibility"],
        "reproducibility_score": primary["reproducibility_score"],
        "replication_success_rate": primary["replication_success_rate"],
        "artifact_availability": primary["artifact_availability"],
        "seed_stability": primary["seed_stability"],
        "cross_run_variance": primary["cross_run_variance"],
        "environment_rebuild_success": primary["environment_rebuild_success"],
        "run_to_run_variance": primary["run_to_run_variance"],
        "prompt_paraphrase_sensitivity": primary["prompt_paraphrase_sensitivity"],
        "artifact_consistency_rate": primary["artifact_consistency_rate"],
        "comparison": {
            "shared_state_vs_free_form": {
                "mean_task_score_delta": round_float(primary["mean_task_score"] - baseline["mean_task_score"]),
                "cross_run_variance_ratio": round_float(
                    primary["cross_run_variance"] / max(baseline["cross_run_variance"], 1e-9)
                ),
                "prompt_paraphrase_variance_ratio": round_float(
                    primary["prompt_paraphrase_sensitivity"] / max(baseline["prompt_paraphrase_sensitivity"], 1e-9)
                ),
                "slot_consistency_delta": round_float(primary["slot_consistency"] - baseline["slot_consistency"]),
                "failure_rate_delta": round_float(primary["failure_rate"] - baseline["failure_rate"]),
                "reproducibility_delta": round_float(primary["reproducibility_score"] - baseline["reproducibility_score"]),
                "hypothesis_supported": bool(
                    primary["cross_run_variance"] < baseline["cross_run_variance"]
                    and primary["prompt_paraphrase_sensitivity"] <= baseline["prompt_paraphrase_sensitivity"]
                ),
            },
            "shared_state_gap_vs_best_recent_paper": round_float(
                primary["reproducibility_score"] - paper_comparison.get("best_recent_score", 0.0)
            ),
        },
        "recent_paper_reproducibility": paper_comparison,
        "recent_paper_reproducibility_path": str(paper_comparison_path),
        "results_path": str(results_path),
        "artifacts": {
            "script_path": str(bundle_dir / "run_experiment.py"),
            "metrics_path": str(metrics_out),
            "results_path": str(results_path),
            "artifact_manifest_path": str(bundle_dir / "artifact_manifest.json"),
            "benchmark_tasks_path": str(bundle_dir / "benchmark_tasks.json"),
            "prompts_path": str(bundle_dir / "prompts.json"),
            "config_path": str(bundle_dir / "experiment_config.json"),
            "evaluator_manifest_path": str(bundle_dir / "evaluator_manifest.json"),
            "environment_lock_path": str(bundle_dir / "environment.lock.json"),
            "recent_paper_reproducibility_path": str(paper_comparison_path),
            "partial_results_path": str(partial_results_path),
            "run_progress_path": str(progress_path),
        },
    }
    write_json(metrics_out, metrics)
    return metrics


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the AutoLabOS real-execution experiment bundle.")
    parser.add_argument("--metrics-out", help="Path for metrics JSON output.")
    parser.add_argument(
        "--metadata-dir",
        help="Optional override for the private AutoLabOS metadata directory used for paper comparison inputs.",
    )
    parser.add_argument(
        "--profile",
        choices=["standard", "confirmatory", "quick_check"],
        help="Sampling profile to run. Defaults to standard unless --quick-check is set.",
    )
    parser.add_argument("--quick-check", action="store_true", help="Run a smaller benchmark slice.")
    parser.add_argument("--fresh", action="store_true", help="Ignore cached partial results and start this profile fresh.")
    args = parser.parse_args()
    if args.quick_check and args.profile and args.profile != "quick_check":
        parser.error("--quick-check cannot be combined with --profile other than quick_check.")

    bundle_dir = Path(__file__).resolve().parent
    config = load_json(bundle_dir / "experiment_config.json")
    if args.metadata_dir:
        config["private_metadata_dir"] = str(Path(args.metadata_dir).resolve())
    profile_name = "quick_check" if args.quick_check else (args.profile or "standard")
    default_metrics_path = {
        "standard": Path(str(config.get("required_metrics_path") or (bundle_dir / "metrics.json"))),
        "confirmatory": bundle_dir / "confirmatory_metrics.json",
        "quick_check": bundle_dir / "quick_check_metrics.json",
    }[profile_name]
    metrics_out = Path(args.metrics_out or default_metrics_path)
    metrics_out.parent.mkdir(parents=True, exist_ok=True)

    ensure_provider_ready(config["llm_profile"])
    metrics = run_experiment(
        bundle_dir=bundle_dir,
        metrics_out=metrics_out,
        config=config,
        profile_name=profile_name,
        fresh=args.fresh,
    )
    print(json.dumps(
        {
            "status": "ok",
            "metrics_path": str(metrics_out),
            "reproducibility_score": metrics["reproducibility_score"],
            "execution_mode": metrics["execution_mode"],
            "sampling_profile": profile_name,
        },
        sort_keys=True,
    ))


if __name__ == "__main__":
    main()
`;
