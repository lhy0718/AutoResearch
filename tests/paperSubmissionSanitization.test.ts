import { describe, expect, it } from "vitest";

import {
  buildPaperBibtex,
  buildFallbackPaperDraft,
  normalizePaperDraft,
  PaperWritingBundle,
  sanitizePaperNarrativeText
} from "../src/core/analysis/paperWriting.js";
import {
  buildFallbackPaperManuscript,
  buildPaperSubmissionValidation,
  buildPaperTraceability,
  normalizePaperManuscript,
  parsePaperManuscriptJson,
  renderSubmissionPaperTex,
  stabilizePaperManuscriptForSubmission
} from "../src/core/analysis/paperManuscript.js";

describe("paper submission sanitization", () => {
  it("cleans brief-derived study prompts before they reach reader-facing manuscript text", () => {
    const text = sanitizePaperNarrativeText(
      "This study addresses Study how LoRA rank and dropout interact during parameter-efficient instruction tuning under a fixed local compute budget. The study is framed as a local preflight. This paper studies Study how LoRA rank and dropout interact during parameter-efficient instruction tuning under a fixed local compute budget. under an explicitly bounded evidence ceiling."
    );

    expect(text).toContain("This study addresses how LoRA rank and dropout interact");
    expect(text).toContain("This paper studies how LoRA rank and dropout interact");
    expect(text).not.toContain("addresses Study how");
    expect(text).not.toContain("studies Study how");
    expect(text).not.toContain("clean. under");
    expect(text).not.toContain("budget. under");
  });

  it("sanitizes LLM paper draft paragraphs during normalization", () => {
    const draft = normalizePaperDraft({
      raw: {
        title: "A Reader Facing Study",
        abstract: "This paper studies Study how LoRA rank and dropout interact.",
        sections: [
          {
            heading: "Introduction",
            paragraphs: [
              {
                text: "This study addresses Study how LoRA rank and dropout interact. This paper studies Study how LoRA rank and dropout interact. under an explicitly bounded evidence ceiling.",
                evidence_ids: [],
                citation_paper_ids: []
              }
            ]
          }
        ],
        claims: []
      } as any,
      bundle: {
        runTitle: "LoRA run",
        topic: "LoRA rank and dropout",
        objectiveMetric: "accuracy",
        constraints: [],
        paperSummaries: [],
        evidenceRows: [],
        hypotheses: [],
        corpus: []
      }
    });

    const serialized = JSON.stringify(draft);
    expect(serialized).toContain("This study addresses how LoRA rank and dropout interact");
    expect(serialized).toContain("This paper studies how LoRA rank and dropout interact under an explicitly bounded evidence ceiling");
    expect(serialized).not.toContain("Study how");
    expect(serialized).not.toContain(". under an explicitly");
  });

  it("sanitizes final submission TeX even when restored manuscripts contain raw draft phrasing", () => {
    const tex = renderSubmissionPaperTex({
      manuscript: {
        title: "Reader Surface Guard",
        abstract: "This paper studies Study how LoRA rank and dropout interact.",
        keywords: [],
        sections: [
          {
            heading: "Introduction",
            paragraphs: [
              "This study addresses Study how LoRA rank and dropout interact. under an explicitly bounded evidence ceiling."
            ]
          }
        ],
        appendix_sections: [
          {
            heading: "Supplementary Notes",
            paragraphs: ["This paper studies Study how LoRA rank and dropout interact."]
          }
        ],
        tables: [],
        figures: []
      },
      traceability: { paragraphs: [] },
      citationKeysByPaperId: new Map(),
      includeKeywords: false
    });

    expect(tex).toContain("This paper studies how LoRA rank and dropout interact");
    expect(tex).toContain("This study addresses how LoRA rank and dropout interact under an explicitly bounded evidence ceiling");
    expect(tex).not.toContain("Study how");
    expect(tex).not.toContain(". under an explicitly");
  });

  it("preserves ACL template surface while using Python-rendered figure assets and omitting non-template keywords", () => {
    const manuscript = {
      title: "Template-faithful paper",
      abstract: "A concise abstract.",
      keywords: ["should not render"],
      sections: [
        { heading: "Introduction", paragraphs: ["We introduce the question."] },
        { heading: "Results", paragraphs: ["The comparison is shown in Figure 1."] }
      ],
      tables: [
        {
          caption: "Condition-level accuracy.",
          rows: [{ label: "baseline", value: 0.3333 }]
        }
      ],
      figures: [
        {
          caption: "Python-rendered task-level accuracy split.",
          bars: [{ label: "baseline", value: 0.3333 }]
        }
      ]
    };
    const tex = renderSubmissionPaperTex({
      manuscript,
      traceability: { paragraphs: [] },
      citationKeysByPaperId: new Map(),
      parsedTemplate: {
        sourcePath: "/workspace/template.tex",
        preDocumentPreamble: "\\pdfoutput=1",
        documentClass: "\\documentclass[11pt]{article}",
        preamble: "\\usepackage[review]{ACL2023}",
        columnLayout: 1,
        packages: ["\\usepackage[review]{ACL2023}"],
        sectionOrder: ["Introduction", "Results"],
        customCommands: [],
        bibliographyStyle: null
      },
      includeKeywords: false,
      figureRenderMode: "external_pdf"
    });

    expect(tex).toContain("\\pdfoutput=1");
    expect(tex).toContain("\\usepackage[review]{ACL2023}");
    expect(tex).not.toContain("\\textbf{Keywords:}");
    expect(tex).toContain("\\includegraphics[width=\\columnwidth]{figures/main-result-figure-1.pdf}");
    expect(tex).not.toContain("\\makebox[4.2em][l]");
  });

  it("does not attach literature citations to paper-specific Introduction framing", () => {
    const manuscript = {
      title: "Citation hygiene paper",
      abstract: "A concise abstract.",
      keywords: [],
      sections: [
        {
          heading: "Introduction",
          paragraphs: [
            "Parameter-efficient fine-tuning is often used when memory and available hardware are fixed in advance.",
            "Against that background, this paper asks a narrow question and treats the experiment as a governed preflight whose primary comparator is the locked internal baseline."
          ]
        },
        {
          heading: "Related Work",
          paragraphs: [
            "Prior PEFT literature motivates memory-aware finetuning and task-sensitive evaluation."
          ]
        }
      ]
    };
    const tex = renderSubmissionPaperTex({
      manuscript,
      traceability: {
        paragraphs: [
          {
            manuscript_section: "Introduction",
            paragraph_index: 0,
            source_draft_section: "Introduction",
            evidence_ids: [],
            citation_paper_ids: ["paper_a"]
          },
          {
            manuscript_section: "Introduction",
            paragraph_index: 1,
            source_draft_section: "Introduction",
            evidence_ids: [],
            citation_paper_ids: ["paper_b"]
          },
          {
            manuscript_section: "Related Work",
            paragraph_index: 0,
            source_draft_section: "Related Work",
            evidence_ids: [],
            citation_paper_ids: ["paper_a"]
          }
        ]
      },
      citationKeysByPaperId: new Map([
        ["paper_a", "paperA"],
        ["paper_b", "paperB"]
      ])
    });

    expect(tex).toContain("Parameter-efficient fine-tuning is often used");
    expect(tex).not.toContain("fixed in advance. \\cite{paperA}");
    expect(tex).not.toContain("locked internal baseline. \\cite{paperB}");
    expect(tex).toContain("Prior PEFT literature motivates memory-aware finetuning and task-sensitive evaluation. \\cite{paperA}");
  });

  it("removes internal run paths from fallback paper drafting before submission validation", () => {
    const bundle: PaperWritingBundle = {
      runTitle: "Budget-aware run",
      topic: "Efficient test-time reasoning for small language models",
      objectiveMetric: "accuracy_delta_vs_baseline > 0",
      constraints: [
        "provider/tooling constraints: keep auditable artifacts under `.autolabos/` and `outputs/` within the active workspace."
      ],
      paperSummaries: [
        {
          paper_id: "paper_1",
          title: "Schema Bench",
          source_type: "full_text",
          summary: "Structured coordination improves reproducibility.",
          key_findings: ["Structured coordination improves reproducibility."],
          limitations: [],
          datasets: ["AgentBench-mini"],
          metrics: ["reproducibility_score"],
          novelty: "Persistent coordination state",
          reproducibility_notes: ["Repeated trials are reported."]
        }
      ],
      evidenceRows: [
        {
          evidence_id: "ev_1",
          paper_id: "paper_1",
          claim: "Structured coordination improves reproducibility.",
          method_slot: "shared state schema",
          result_slot: "higher reproducibility_score",
          limitation_slot: "small benchmark",
          dataset_slot: "AgentBench-mini",
          metric_slot: "reproducibility_score",
          evidence_span: "Repeated trials improved reproducibility_score.",
          source_type: "full_text",
          confidence: 0.9
        }
      ],
      hypotheses: [
        {
          hypothesis_id: "h_1",
          text: "Persistent coordination improves reproducibility.",
          evidence_links: ["ev_1"]
        }
      ],
      corpus: [
        {
          paper_id: "paper_1",
          title: "Schema Bench",
          abstract: "Structured coordination improves reproducibility.",
          authors: ["Alice Doe"],
          year: 2025,
          venue: "ACL"
        } as any
      ],
      experimentPlan: {
        selectedTitle: "Schema benchmark",
        selectedSummary: "Compare persistent schemas with a baseline.",
        rawText: ""
      },
      resultAnalysis: {
        objective_metric: {
          evaluation: {
            summary: "Objective metric met: reproducibility_score=0.88 >= 0.8."
          }
        }
      } as any
    };

    const draft = buildFallbackPaperDraft(bundle);
    const manuscript = buildFallbackPaperManuscript({
      draft,
      resultAnalysis: bundle.resultAnalysis
    });
    const traceability = buildPaperTraceability({ draft, manuscript });
    const citations = new Map([["paper_1", "paper1"]]);
    const tex = renderSubmissionPaperTex({
      manuscript,
      traceability,
      citationKeysByPaperId: citations
    });
    const validation = buildPaperSubmissionValidation({
      manuscript,
      tex,
      traceability,
      citationKeysByPaperId: citations
    });

    expect(JSON.stringify({ draft, manuscript, tex })).not.toContain(".autolabos/");
    expect(validation.issues.some((issue) => issue.kind === "absolute_path")).toBe(false);
  });

  it("rewrites DOI or URL shaped BibTeX keys to safe citation identifiers", () => {
    const bibtex = buildPaperBibtex(
      [
        {
          paper_id: "paper_qlora",
          title: "QLoRA: Efficient Finetuning of Quantized LLMs",
          abstract: "QLoRA enables memory-efficient finetuning.",
          authors: ["Tim Dettmers"],
          year: 2023,
          venue: "NeurIPS",
          bibtex: [
            "@article{https://doi.org/10.48550/arXiv.2305.14314,",
            "  title={QLoRA: Efficient Finetuning of Quantized LLMs},",
            "  author={Tim Dettmers},",
            "  year={2023}",
            "}"
          ].join("\n")
        } as any
      ],
      ["paper_qlora"]
    );

    const key = bibtex.citationKeysByPaperId.get("paper_qlora");
    expect(key).toBe("dettmers_2023_qlora_efficient");
    expect(bibtex.references).toContain("@article{dettmers_2023_qlora_efficient,");
    expect(bibtex.references).not.toContain("@article{https://doi.org");
  });

  it("removes raw DOI and opaque paper identifiers from normalized manuscript prose", () => {
    const draft = buildFallbackPaperDraft({
      runTitle: "LoRA benchmark",
      topic: "LoRA rank/dropout benchmark",
      objectiveMetric: "accuracy_delta_vs_baseline > 0",
      constraints: [],
      paperSummaries: [],
      evidenceRows: [],
      hypotheses: [],
      corpus: [],
      experimentPlan: { selectedTitle: "LoRA benchmark", selectedSummary: "Compare conditions.", rawText: "" }
    } as any);
    const manuscript = normalizePaperManuscript({
      raw: {
        title: "A LoRA Benchmark",
        abstract: "A cautious benchmark (doi:10.48550/arxiv.2305.14314; arXiv:2305.14314; 15a1c2d8eb2c55e3ceb9ce9f72b3446ac1eb183a).",
        keywords: ["LoRA"],
        sections: [
          {
            heading: "Introduction",
            paragraphs: [
              "Prior PEFT work motivates this setup (e.g., doi:10.48550/arxiv.2305.14314; 75bc30bf394625c784ea59f8c2fe04718a4b4042)."
            ]
          }
        ]
      },
      draft
    });

    const text = JSON.stringify(manuscript);
    expect(text).not.toContain("doi:");
    expect(text).not.toContain("arXiv:2305.14314");
    expect(text).not.toContain("15a1c2d8eb2c55e3ceb9ce9f72b3446ac1eb183a");
    expect(text).not.toContain("75bc30bf394625c784ea59f8c2fe04718a4b4042");
  });

  it("sanitizes wrapped revised manuscript repair prose", () => {
    const draft = buildFallbackPaperDraft({
      runTitle: "LoRA benchmark",
      topic: "LoRA rank/dropout benchmark",
      objectiveMetric: "accuracy_delta_vs_baseline > 0",
      constraints: [],
      paperSummaries: [],
      evidenceRows: [],
      hypotheses: [],
      corpus: [],
      experimentPlan: { selectedTitle: "LoRA benchmark", selectedSummary: "Compare conditions.", rawText: "" }
    } as any);
    const raw = parsePaperManuscriptJson(JSON.stringify({
      revised_manuscript: {
        title: "A LoRA Benchmark",
        abstract: "A cautious benchmark.",
        sections: [
          {
            heading: "Related Work",
            paragraphs: [
              "Prior work motivates this comparison (doi:10.48550/arxiv.2305.14314; 75bc30bf394625c784ea59f8c2fe04718a4b4042)."
            ]
          }
        ]
      }
    }));
    const manuscript = normalizePaperManuscript({ raw, draft });

    const text = JSON.stringify(manuscript);
    expect(text).not.toContain("doi:");
    expect(text).not.toContain("75bc30bf394625c784ea59f8c2fe04718a4b4042");
  });

  it("restores executed model and fixed training settings when manuscript prose claims they are unavailable", () => {
    const draft = buildFallbackPaperDraft({
      runTitle: "LoRA benchmark",
      topic: "LoRA rank/dropout benchmark",
      objectiveMetric: "accuracy_delta_vs_baseline > 0",
      constraints: [],
      paperSummaries: [],
      evidenceRows: [],
      hypotheses: [],
      corpus: [],
      experimentPlan: { selectedTitle: "LoRA benchmark", selectedSummary: "Compare conditions.", rawText: "" }
    } as any);
    const manuscript = normalizePaperManuscript({
      raw: {
        title: "A LoRA Benchmark",
        abstract: "A cautious benchmark.",
        sections: [
          {
            heading: "Method",
            paragraphs: [
              "The planned experiment compared LoRA rank and dropout against a locked baseline.",
              "The executed summary remains incomplete as a methods record because it does not expose the final selected model identifier, optimizer, learning rate, batch size, gradient accumulation, LoRA target modules, or confidence-interval construction."
            ]
          }
        ]
      },
      draft,
      resultAnalysis: {
        metrics: {
          selected_model_id: "Qwen/Qwen2.5-1.5B",
          fallback_model: "TinyLlama/TinyLlama-1.1B-Chat-v1.0",
          run_config: {
            seed: 17,
            train_samples: 48,
            eval_samples: 6,
            max_steps: 4,
            per_device_batch_size: 1,
            gradient_accumulation_steps: 4,
            learning_rate: 0.0002,
            max_seq_length: 256,
            timeout_sec: 1800
          },
          data: {
            train: { dataset: { path: "yahma/alpaca-cleaned", split: "train" } },
            eval: {
              arc_challenge: { dataset: { path: "allenai/ai2_arc", name: "ARC-Challenge", split: "validation" } },
              hellaswag: { dataset: { path: "hellaswag", split: "validation" } }
            }
          }
        },
        statistical_summary: {
          confidence_intervals: [{ level: 0.95, sample_size: 12 }]
        }
      } as any
    });

    const method = manuscript.sections.find((section) => section.heading === "Method");
    const text = method?.paragraphs.join(" ") || "";
    expect(text).toContain("Qwen/Qwen2.5-1.5B");
    expect(text).toContain("learning rate 0.0002");
    expect(text).toContain("per-device train batch size 1");
    expect(text).toContain("gradient accumulation 4");
    expect(text).toContain("maximum sequence length 256");
    expect(text).toContain("n=12 prediction records");
    expect(text).not.toContain("does not expose the final selected model identifier");
  });

  it("repairs reader-visible table availability and appendix protocol-label contradictions", () => {
    const draft = buildFallbackPaperDraft({
      runTitle: "LoRA benchmark",
      topic: "LoRA rank/dropout benchmark",
      objectiveMetric: "accuracy_delta_vs_baseline > 0",
      constraints: [],
      paperSummaries: [],
      evidenceRows: [],
      hypotheses: [],
      corpus: [],
      experimentPlan: { selectedTitle: "LoRA benchmark", selectedSummary: "Compare conditions.", rawText: "" }
    } as any);

    const manuscript = normalizePaperManuscript({
      raw: {
        title: "A LoRA Benchmark",
        abstract: "A cautious benchmark.",
        sections: [
          {
            heading: "Method",
            paragraphs: [
              "The fixed search space includes Fixed training settings included learning rate 0.0002, per-device train batch size 1, gradient accumulation 4, maximum sequence length 256, 4 optimizer steps, and 1800-second timeout., reported run details records 48 training examples for the reported pilot., and the LoRA rank/dropout tuning grid.",
              "Results reports the best observed cell against the locked rank-8, dropout-0 baseline; Table 1 reports condition mean accuracies and identifies only that locked row as the baseline."
            ]
          },
          {
            heading: "Related Work",
            paragraphs: [
              "The cited work therefore motivates the design and claim ceiling, but it is not treated as a condition-matched baseline for the local 4x2 rank/dropout preflight.",
              "The manuscript can position this bounded local condition-grid pilot as useful for deciding whether a larger follow-up is warranted, but it should not claim to outperform QLoRA, MAPLE, or adapter-variant methods.",
              "That distinction is important for interpreting the comparator. The numerical baseline in this manuscript is the locked rank-8, no-dropout condition inside the executed run, not a literature result. Prior PEFT papers instead define why the local rank/dropout question is worth testing: memory-aware adaptation makes small-budget tuning plausible, benchmark papers show that task choice can change conclusions, and adapter variants show that capacity allocation remains a live design issue.",
              "Accordingly, external PEFT papers serve as framing comparators rather than numerical baselines for this manuscript. The relevant baseline here is the locked rank-8, dropout-0.0 condition inside the executed run. Prior work motivates why the question matters but differences in model scale, task mix, adapter family, and evaluation objective prevent direct superiority claims."
            ]
          },
          {
            heading: "Results",
            paragraphs: [
              "The available summary does not expose a full eight-cell accuracy table, so this manuscript does not attempt to infer a detailed ordering among all configurations beyond the reported best-versus-baseline comparison.",
              "Although all eight planned configurations were completed, the reported summary does not expose a full per-condition performance table sufficient for estimating rank main effects, dropout main effects, or their interaction across the whole grid. It supports a best-versus-baseline comparison, but it does not support a strong factorial interpretation of how performance changes over the entire rank-by-dropout design space.",
              "In addition, supplemental confirmatory profiles included in the payload did not reproduce the main gain."
            ]
          },
          {
            heading: "Discussion",
            paragraphs: [
              "The present evidence does not support a stronger statement about the overall interaction pattern between rank and dropout, because the reported summary does not expose a full cell-by-cell mean table and the observed gain is concentrated in one benchmark.",
              "Practical adoption should therefore weigh the small runtime and memory footprint against the unresolved question of whether the signal survives larger budgets, broader task mixes, or repeated runs.",
              "Practical adoption should weigh any observed quality gain against the accompanying runtime or memory footprint. That follow-up would test whether the present signal survives scale and task variation instead of merely reflecting this local preflight."
            ]
          },
          {
            heading: "Limitations",
            paragraphs: [
              "Several fixed settings are visible in the reported results. Maximum sequence length was 256, the timeout budget was 1,800 s, and all 8 requested configurations were recorded as completed. However, the reported analyses does not report optimizer choice, learning rate, batch size, LoRA target modules, or the exact procedure used to compute the reported 95% intervals, so we do not infer beyond the documented settings.",
              "The primary limitation is scale.",
              "The protocol clearly specifies the preferred backbone and fallback option, but the summarized materials do not fully disambiguate the realized checkpoint used in the analyzed slice. The summary also does not provide a complete table of mean performance for every factorial cell, and it does not document the exact procedure used to compute the reported confidence intervals.",
              "Finally, the available summary is incomplete for external replication. It does not disambiguate which of the pre-specified backbones backed the completed run, and it omits optimizer settings, batch size, LoRA target modules, a full per-condition score table, and the exact interval-construction procedure. The present paper is therefore strongest when read as a transparent report on one bounded local sweep, not as a fully specified benchmark package or final recipe for larger-model adaptation.",
              "The planned and realized execution records should be read conservatively because some protocol fields remain underspecified.",
              "The most important limitation is scale. The run uses one small backbone, two benchmark tasks, and a fixed local training budget."
            ]
          }
        ],
        figures: [
          {
            caption: "Task-level delta for the leading condition.",
            bars: [
              { label: "ARC-Challenge delta", value: 0 },
              { label: "HellaSwag delta", value: 0.1667 }
            ]
          }
        ],
        appendix_tables: [
          {
            caption: "Design constants and realized preflight scale.",
            rows: [
              { label: "Seed", value: 42 },
              { label: "Baseline Rank", value: 8 },
              { label: "Minimum Tested Rank", value: 4 }
            ]
          }
        ]
      },
      draft
    });

    const text = JSON.stringify(manuscript);
    expect(text).toContain("Table 1 reports all eight condition mean accuracies");
    expect(text).toContain("Table 1 provides a mean-performance row for every factorial cell");
    expect(text).toContain("complete per-cell uncertainty and auxiliary-metric tables");
    expect(text).toContain("Table 1 reports the condition-level mean accuracies");
    expect(text).toContain("the reported analyses do not report optimizer choice, LoRA target modules");
    expect(text).toContain("Table 1 provides the condition-level mean accuracy table");
    expect(text).toContain("The numerical comparator in this manuscript is the locked rank-8");
    expect(text).toContain("executed metrics identify Qwen/Qwen2.5-1.5B");
    expect(text).toContain("The fixed search space held LoRA rank and dropout as the manipulated factors");
    expect(text).toContain("Relative to memory-efficient finetuning work");
    expect(text).not.toContain("does not expose a full eight-cell accuracy table");
    expect(text).not.toContain("does not expose a full cell-by-cell mean table");
    expect(text).not.toContain("does not expose a full per-condition performance table");
    expect(text).not.toContain("does not provide a complete table of mean performance");
    expect(text).not.toContain("does not expose a full condition-by-condition main-text score table");
    expect(text).not.toContain("does not report optimizer choice, learning rate, batch size");
    expect(text).not.toContain("omits optimizer settings, batch size");
    expect(text).not.toContain("a full per-condition score table");
    expect(text).not.toContain("Results reports the best observed cell");
    expect(text).not.toContain("did not reproduce");
    expect(text).not.toContain("claim ceiling");
    expect(text.match(/locked rank-8/g)?.length || 0).toBeLessThan(5);
    expect(text).not.toContain("most important limitation is scale");
    expect(manuscript.figures).toBeUndefined();
    expect(manuscript.sections.find((section) => section.heading === "Discussion")?.paragraphs).toHaveLength(2);
    expect(manuscript.appendix_tables?.[0]?.caption).toBe("Planned protocol constants for the rank/dropout design.");
    expect(manuscript.appendix_tables?.[0]?.rows[0]?.label).toBe("Planned protocol seed");
  });

  it("repairs stale limitations, repeated screening paragraphs, and method benchmark citations", () => {
    const draft = buildFallbackPaperDraft({
      runTitle: "LoRA benchmark",
      topic: "LoRA rank/dropout benchmark",
      objectiveMetric: "accuracy_delta_vs_baseline > 0",
      constraints: [],
      paperSummaries: [],
      evidenceRows: [],
      hypotheses: [],
      corpus: [
        {
          paper_id: "paper_arc",
          title: "Benchmark source",
          abstract: "Benchmark source.",
          authors: ["Alice Doe"],
          year: 2025,
          venue: "TestConf"
        } as any
      ],
      experimentPlan: { selectedTitle: "LoRA benchmark", selectedSummary: "Compare conditions.", rawText: "" }
    } as any);
    for (const section of draft.sections) {
      if (section.heading === "Method") {
        section.citation_paper_ids = ["paper_arc"];
      }
    }

    const manuscript = normalizePaperManuscript({
      raw: {
        title: "A LoRA Benchmark",
        abstract: "A cautious benchmark.",
        sections: [
          {
            heading: "Method",
            paragraphs: [
              "Accordingly, the analysis was defined as a within-run comparison of LoRA rank/dropout cells against the locked rank-8, dropout-0 baseline, using the cited ARC-Challenge and HellaSwag benchmark pair."
            ]
          },
          {
            heading: "Discussion",
            paragraphs: [
              "This cautious interpretation is consistent with prior low-budget LoRA and PEFT studies (e.g., QLoRA and related benchmarking work) that also treat adapter configuration as consequential, while recognizing that the present study is much smaller and less stable than the settings used in broader adaptation papers.",
              "The main report records a positive screening result: accuracy delta versus baseline was 0.083332 against the predeclared 0.01 target, with the rank-32 dropout-0.05 cell supplying the strongest observed gain.",
              "The current evidence is most actionable as a cautious benchmark note for this fixed-budget LoRA rank/dropout pilot, especially where the best observed cell clears the pre-specified screening threshold.",
              "The rank-32 dropout-0.05 cell improved accuracy delta versus the locked baseline by 0.0833 in the reported comparison."
            ]
          },
          {
            heading: "Limitations",
            paragraphs: [
              "The principal limitation is scale. Although the protocol allowed a training subset up to 10,000 examples, the reported preflight used 48 training samples.",
              "A second limitation is incomplete implementation disclosure in the reported summary. The final backbone used for the reported run is not identified, and the summary does not expose optimizer choice, learning rate, batch size, epochs or steps beyond the high-level budget frame, LoRA target modules, or adapter scaling. In addition, planned seed and recorded seed do not match, and the reported trial counts are not fully reconciled. These gaps do not nullify the observed preflight outcome, but they do prevent a strong claim of fully resolved reproducibility.",
              "Accordingly, the present run is best treated as a feasibility-scale study for selecting a next experiment. The same hyperparameter choice could behave differently with more seeds, a different dataset mixture, a larger model, or a broader evaluation suite.",
              "The most important limitation is scale. The run uses one small backbone, two benchmark tasks, and a fixed local training budget, so it can motivate a larger experiment but cannot establish a model-family-level regularization law."
            ]
          }
        ]
      },
      draft
    });

    const text = JSON.stringify(manuscript);
    expect(text).toContain("Method identifies the selected Qwen/Qwen2.5-1.5B backbone");
    expect(text).toContain("For this fixed-budget LoRA rank/dropout pilot");
    expect(text).not.toContain("final backbone used for the reported run is not identified");
    expect(text).not.toContain("The main report records a positive screening result");
    expect(text).not.toContain("The rank-32 dropout-0.05 cell improved accuracy delta");
    expect(text).not.toContain("The most important limitation is scale");
    expect(text).not.toContain("using the cited ARC-Challenge");
    expect(text).not.toContain("QLoRA and related benchmarking work");

    const tex = renderSubmissionPaperTex({
      manuscript,
      traceability: buildPaperTraceability({ draft, manuscript }),
      citationKeysByPaperId: new Map([["paper_arc", "doe_2025_benchmark"]])
    });
    expect(tex).toContain("\\cite{doe_2025_benchmark}");
  });

  it("renders reader-visible citations for method resource paragraphs and related discussion claims", () => {
    const draft = buildFallbackPaperDraft({
      runTitle: "LoRA benchmark",
      topic: "LoRA rank/dropout benchmark",
      objectiveMetric: "accuracy_delta_vs_baseline > 0",
      constraints: [],
      paperSummaries: [],
      evidenceRows: [],
      hypotheses: [],
      corpus: [
        {
          paper_id: "paper_peft",
          title: "Budget-aware PEFT study",
          abstract: "PEFT study.",
          authors: ["Alice Doe"],
          year: 2025,
          venue: "TestConf"
        } as any
      ],
      experimentPlan: { selectedTitle: "LoRA benchmark", selectedSummary: "Compare conditions.", rawText: "" }
    } as any);
    for (const section of draft.sections) {
      if (section.heading === "Method" || section.heading === "Discussion") {
        section.citation_paper_ids = ["paper_peft"];
      }
    }

    const manuscript = normalizePaperManuscript({
      raw: {
        title: "A LoRA Benchmark",
        abstract: "A cautious benchmark.",
        sections: [
          {
            heading: "Method",
            paragraphs: [
              "The design fixed rank and dropout before execution.",
              "In the preregistered plan, the training source was an Alpaca Clean subset capped at 10,000 examples, and evaluation was limited to ARC-Challenge and HellaSwag. The preferred base model for this plan was Qwen/Qwen2.5-1.5B, with TinyLlama/TinyLlama-1.1B-Chat-v1.0 reserved only as a fallback if preflight checks failed. However, the reported execution artifact is narrower than that original plan: the metric summary records 48 training samples and a run seed of 17."
            ]
          },
          {
            heading: "Discussion",
            paragraphs: [
              "That pattern is directionally compatible with prior low-budget evidence that adapter rank can strongly influence downstream performance.",
              "This positioning matters because modest hyperparameter differences are especially vulnerable to overstatement when fixed-budget studies omit incomplete conditions or uncertainty-aware wording."
            ]
          }
        ]
      },
      draft
    });

    const tex = renderSubmissionPaperTex({
      manuscript,
      traceability: {
        paragraphs: [
          {
            manuscript_section: "Method",
            paragraph_index: 1,
            source_draft_section: "Method",
            evidence_ids: [],
            citation_paper_ids: ["paper_peft"]
          },
          {
            manuscript_section: "Discussion",
            paragraph_index: 0,
            source_draft_section: "Discussion",
            evidence_ids: [],
            citation_paper_ids: ["paper_peft"]
          },
          {
            manuscript_section: "Discussion",
            paragraph_index: 1,
            source_draft_section: "Discussion",
            evidence_ids: [],
            citation_paper_ids: ["paper_peft"]
          }
        ]
      },
      citationKeysByPaperId: new Map([["paper_peft", "doe_2025_peft"]])
    });

    const citedParagraphs = tex.split("\\cite{doe_2025_peft}").length - 1;
    expect(citedParagraphs).toBeGreaterThanOrEqual(3);
    expect(tex).toContain("Qwen/Qwen2.5-1.5B");
    expect(tex).toContain("\\cite{doe_2025_peft}");
  });

  it("adds TeX line-stretch guard for long model identifiers in narrow paper columns", () => {
    const draft = buildFallbackPaperDraft({
      runTitle: "LoRA benchmark",
      topic: "LoRA rank/dropout benchmark",
      objectiveMetric: "accuracy_delta_vs_baseline > 0",
      constraints: [],
      paperSummaries: [],
      evidenceRows: [],
      hypotheses: [],
      corpus: [],
      experimentPlan: { selectedTitle: "LoRA benchmark", selectedSummary: "Compare conditions.", rawText: "" }
    } as any);

    const manuscript = normalizePaperManuscript({
      raw: {
        title: "A LoRA Benchmark",
        abstract: "A cautious benchmark.",
        sections: [
          {
            heading: "Method",
            paragraphs: [
              "The protocol used Qwen/Qwen2.5-1.5B with TinyLlama/TinyLlama-1.1B-Chat-v1.0 reserved as a fallback under the same local workstation budget."
            ]
          }
        ]
      },
      draft
    });

    const tex = renderSubmissionPaperTex({
      manuscript,
      traceability: { paragraphs: [] },
      citationKeysByPaperId: new Map()
    });

    expect(tex).toContain("\\emergencystretch=3em");
    expect(tex.indexOf("\\emergencystretch=3em")).toBeLessThan(tex.indexOf("\\begin{document}"));
    expect(tex).toContain("Qwen/Qwen2.5-1.5B");
  });

  it("keeps abstract and limitations model-disclosure story aligned after manuscript repair", () => {
    const draft = buildFallbackPaperDraft({
      runTitle: "LoRA benchmark",
      topic: "LoRA rank/dropout benchmark",
      objectiveMetric: "accuracy_delta_vs_baseline > 0",
      constraints: [],
      paperSummaries: [],
      evidenceRows: [],
      hypotheses: [],
      corpus: [],
      experimentPlan: { selectedTitle: "LoRA benchmark", selectedSummary: "Compare conditions.", rawText: "" }
    } as any);

    const manuscript = normalizePaperManuscript({
      raw: {
        title: "A LoRA Benchmark",
        abstract: "The verified summary reports seed 17 while not exposing the final model identity in the condensed record.",
        sections: [
          {
            heading: "Limitations",
            paragraphs: [
              "The largest limitation is the mismatch between the nominal brief and the executed summary available for writing. The broader plan described a capped Alpaca Clean study, seed 42, and model-selection rules involving Qwen2.5-1.5B and TinyLlama, whereas the verified summary used here reflects a seed-17, 48-sample preflight and does not disclose the final model choice or optimizer details in the condensed record. As a result, the paper can describe the registered design and the visible executed run, but it cannot present a fully conventional implementation section with complete artifact-level specificity.",
              "Accordingly, the present run is best treated as a feasibility-scale study for selecting a next experiment. The same hyperparameter choice could behave differently with more seeds, a different dataset mixture, a larger model, or a broader evaluation suite.",
              "The most important limitation is scale. The run uses one small backbone, two benchmark tasks, and a fixed local training budget, so it can motivate a larger experiment but cannot establish a model-family-level regularization law."
            ]
          }
        ]
      },
      draft
    });

    const text = JSON.stringify(manuscript);
    expect(manuscript.abstract).toContain("verified execution metadata identifying Qwen/Qwen2.5-1.5B");
    expect(text).toContain("The manuscript supplements that compact summary with verified execution metadata");
    expect(text).not.toContain("not exposing the final model identity");
    expect(text).not.toContain("does not disclose the final model choice");
    expect(text).not.toContain("The most important limitation is scale");
  });

  it("repairs live-review stale model, table, and appendix claims after manuscript repair", () => {
    const draft = buildFallbackPaperDraft({
      runTitle: "LoRA benchmark",
      topic: "LoRA rank/dropout benchmark",
      objectiveMetric: "accuracy_delta_vs_baseline > 0",
      constraints: [],
      paperSummaries: [],
      evidenceRows: [],
      hypotheses: [],
      corpus: [],
      experimentPlan: { selectedTitle: "LoRA benchmark", selectedSummary: "Compare conditions.", rawText: "" }
    } as any);

    const manuscript = normalizePaperManuscript({
      raw: {
        title: "A LoRA Benchmark",
        abstract: "A cautious benchmark.",
        sections: [
          {
            heading: "Method",
            paragraphs: [
              "The compact reader-visible run summary preserved for this manuscript does not unambiguously state which of those two registered backbones powered the realized preflight."
            ]
          },
          {
            heading: "Limitations",
            paragraphs: [
              "The second limitation is incomplete disclosure of the quantitative setup and outputs. The compact summary does not provide the full eight-cell metric table, does not report optimizer, learning-rate, batch-size, or step-level details, and does not explain how the 95% confidence intervals were constructed. It also does not include a direct with-versus-without ablation of the benchmark-gated reporting protocol. Those omissions do not invalidate the preflight, but they prevent stronger causal or interaction-level claims.",
              "Because the compact reader-visible record does not identify the realized backbone more specifically, the paper cannot make finer model-specific claims than that.",
              "In addition, some of the surrounding related-work material available to this paper came from abstract-level or timeout-limited extraction rather than full-text comparative review.",
              "Specification may be underspecified and require narrower scope."
            ]
          },
          {
            heading: "Conclusion",
            paragraphs: [
              "The paper therefore keeps execution coverage and supplementary metrics secondary to the visible baseline-relative comparison. The main text interprets only the comparison and task split that are visible in the presented table and figure."
            ]
          }
        ],
        appendix_sections: [
          {
            heading: "Supplementary Boundary Notes",
            paragraphs: [
              "This appendix records what the paper is allowed to claim.",
              "Runtime and memory diagnostics remain secondary to baseline-relative accuracy claims."
            ]
          },
          {
            heading: "Supplementary Reproducibility Trace",
            paragraphs: [
              "The manuscript should be read as a workflow record."
            ]
          },
          {
            heading: "Supplementary Experimental Details",
            paragraphs: [
              "Resource measurements were collected as secondary diagnostics."
            ]
          }
        ]
      },
      draft
    });

    const text = JSON.stringify(manuscript);
    expect(text).toContain("Verified execution metadata identifies Qwen/Qwen2.5-1.5B");
    expect(text).toContain("visible manuscript reports the eight condition-level mean accuracies");
    expect(text).toContain("task split described in the Results prose");
    expect(text).toContain("related-work comparison remains narrower than a full survey");
    expect(text).not.toContain("does not unambiguously state");
    expect(text).not.toContain("does not identify the realized backbone");
    expect(text).not.toContain("does not provide the full eight-cell metric table");
    expect(text).not.toContain("learning-rate, batch-size");
    expect(text).not.toContain("abstract-level or timeout-limited extraction");
    expect(text).not.toContain("Specification may be underspecified");
    expect(text).not.toContain("presented table and figure");
    expect(manuscript.appendix_sections?.map((section) => section.heading)).toEqual([
      "Supplementary Experimental Details"
    ]);
  });

  it("derives a main-body result figure and removes raw metric-key prose before rendering", () => {
    const draft = buildFallbackPaperDraft({
      runTitle: "LoRA benchmark",
      topic: "LoRA rank/dropout benchmark",
      objectiveMetric: "accuracy_delta_vs_baseline > 0",
      constraints: [],
      paperSummaries: [],
      evidenceRows: [],
      hypotheses: [],
      corpus: [],
      experimentPlan: { selectedTitle: "LoRA benchmark", selectedSummary: "Compare conditions.", rawText: "" }
    } as any);

    const manuscript = normalizePaperManuscript({
      raw: {
        title: "A LoRA Benchmark",
        abstract: "A cautious benchmark.",
        sections: [
          {
            heading: "Introduction",
            paragraphs: [
              "Objective metric met: accuracy_delta_vs_baseline=0.083332 >= 0.01. The paper is scoped around - Primary metric: average accuracy across ARC-Challenge and HellaSwag. - Secondary metrics: per-task accuracy, train loss, wall-clock runtime, peak VRAM, completed-condition count, failed-run visibility, and claim downgrade correctness. - Meaningful improvement: at least +1.0 percentage point average accuracy over the baseline with uncertainty reporting that does not clearly contradict the direction of improvement. - No-signal boundary: maximum condition spread below +0.5 percentage points, or confidence intervals that make the comparison inconclusive."
            ]
          },
          {
            heading: "Results",
            paragraphs: [
              "rank 32 dropout 0 05 vs rank 8 dropout 0 0: accuracy_delta_vs_baseline: 0.0833 vs 0 (delta 0.0833), average_accuracy: 0.4167 vs 0.3333 (delta 0.0833), arc_challenge_accuracy: 0.5 vs 0.5 (delta 0), hellaswag_accuracy: 0.3333 vs 0.1667 (delta 0.1667)."
            ]
          }
        ],
        tables: [
          {
            caption: "Condition-level mean accuracy across the executed rank/dropout grid.",
            rows: [
              { label: "rank 8 dropout 0 baseline", value: 0.333334 },
              { label: "rank 4 dropout 0", value: 0.333334 },
              { label: "rank 4 dropout 0.05", value: 0.333334 },
              { label: "rank 16 dropout 0", value: 0.333334 },
              { label: "rank 32 dropout 0.05", value: 0.416666 }
            ]
          }
        ]
      },
      draft,
      resultAnalysis: {
        metrics: {
          condition_summaries: [
            {
              label: "rank 8 dropout 0 baseline",
              is_baseline: true,
              average_accuracy_mean: 0.333334,
              arc_challenge_accuracy_mean: 0.5,
              hellaswag_accuracy_mean: 0.166667
            },
            {
              label: "rank 4 dropout 0",
              average_accuracy_mean: 0.333334,
              arc_challenge_accuracy_mean: 0.5,
              hellaswag_accuracy_mean: 0.166667
            },
            {
              label: "rank 16 dropout 0",
              average_accuracy_mean: 0.333334,
              arc_challenge_accuracy_mean: 0.5,
              hellaswag_accuracy_mean: 0.166667
            },
            {
              label: "rank 32 dropout 0.05",
              average_accuracy_mean: 0.416666,
              accuracy_delta_vs_baseline_mean: 0.083332,
              arc_challenge_accuracy_mean: 0.5,
              hellaswag_accuracy_mean: 0.333333
            }
          ]
        }
      } as any
    });

    const text = JSON.stringify(manuscript);
    expect(manuscript.figures).toHaveLength(1);
    expect(manuscript.figures?.[0]?.caption).toContain("Task-level and average accuracy");
    expect(manuscript.figures?.[0]?.bars).toEqual([
      { label: "Baseline ARC-Challenge", value: 0.5 },
      { label: "Leading ARC-Challenge", value: 0.5 },
      { label: "Baseline HellaSwag", value: 0.1667 },
      { label: "Leading HellaSwag", value: 0.3333 },
      { label: "Baseline Average", value: 0.3333 },
      { label: "Leading Average", value: 0.4167 }
    ]);
    expect(text).toContain("prespecified baseline-relative accuracy target was met");
    expect(text).toContain("mean accuracy was 0.4167 versus 0.3333");
    expect(text).not.toContain("accuracy_delta_vs_baseline");
    expect(text).not.toContain("average_accuracy");
    expect(text).not.toContain("arc_challenge_accuracy");
    expect(text).not.toContain("hellaswag_accuracy");
  });

  it("replaces redundant condition-delta figures with a task-level split when condition summaries are available", () => {
    const stabilized = stabilizePaperManuscriptForSubmission(
      {
        title: "A LoRA Benchmark",
        abstract: "A cautious benchmark.",
        keywords: ["LoRA"],
        sections: [
          {
            heading: "Results",
            paragraphs: [
              "Table 1 reports mean average accuracy for all eight executed rank/dropout conditions."
            ]
          }
        ],
        tables: [
          {
            caption: "Condition-level mean accuracy across the executed rank/dropout grid.",
            rows: [
              { label: "rank 8 dropout 0 baseline", value: 0.333334 },
              { label: "rank 4 dropout 0", value: 0.333334 },
              { label: "rank 16 dropout 0", value: 0.333334 },
              { label: "rank 32 dropout 0.05", value: 0.416666 }
            ]
          }
        ],
        figures: [
          {
            caption: "Baseline-relative mean accuracy gain by evaluated rank/dropout condition.",
            bars: [
              { label: "rank 8 dropout 0 baseline", value: 0 },
              { label: "rank 4 dropout 0", value: 0 },
              { label: "rank 16 dropout 0", value: 0 },
              { label: "rank 32 dropout 0.05", value: 0.083332 }
            ]
          },
          {
            caption:
              "Task-level and average accuracy for the leading condition; paired bars compare the locked baseline with the best observed rank/dropout cell.",
            bars: [
              { label: "Baseline ARC Challenge", value: 0.5 },
              { label: "Leading ARC Challenge", value: 0.5 },
              { label: "Baseline HellaSwag", value: 0.1667 },
              { label: "Leading HellaSwag", value: 0.3333 },
              { label: "Baseline Average", value: 0.3333 },
              { label: "Leading Average", value: 0.4167 }
            ]
          }
        ]
      },
      {
        conditionSummaries: [
          {
            label: "rank 8 dropout 0 baseline",
            is_baseline: true,
            average_accuracy_mean: 0.333334,
            arc_challenge_accuracy: 0.5,
            hellaswag_accuracy: 0.166667
          },
          {
            label: "rank 4 dropout 0",
            average_accuracy_mean: 0.333334,
            arc_challenge_accuracy: 0.5,
            hellaswag_accuracy: 0.166667
          },
          {
            label: "rank 16 dropout 0",
            average_accuracy_mean: 0.333334,
            arc_challenge_accuracy: 0.5,
            hellaswag_accuracy: 0.166667
          },
          {
            label: "rank 32 dropout 0.05",
            average_accuracy_mean: 0.416666,
            accuracy_delta_vs_baseline_mean: 0.083332,
            arc_challenge_accuracy: 0.5,
            hellaswag_accuracy: 0.333333
          }
        ]
      }
    );

    expect(stabilized.figures).toHaveLength(1);
    expect(stabilized.figures?.[0]?.caption).toContain("Task-level and average accuracy");
    expect(stabilized.figures?.[0]?.bars).toEqual([
      { label: "Baseline ARC-Challenge", value: 0.5 },
      { label: "Leading ARC-Challenge", value: 0.5 },
      { label: "Baseline HellaSwag", value: 0.1667 },
      { label: "Leading HellaSwag", value: 0.3333 },
      { label: "Baseline Average", value: 0.3333 },
      { label: "Leading Average", value: 0.4167 }
    ]);
  });
});
