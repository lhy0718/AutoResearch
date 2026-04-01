import { Dispatch, FormEvent, SetStateAction, startTransition, useEffect, useRef, useState } from "react";

import {
  ArtifactEntry,
  BootstrapResponse,
  CheckpointEntry,
  ConfigSummary,
  DoctorCheck,
  DoctorResponse,
  HarnessValidationReport,
  KnowledgeFileResponse,
  KnowledgeResponse,
  RepositoryKnowledgeEntry,
  LiteratureResponse,
  RunRecord,
  RunLiteratureIndex,
  RunInsightCard,
  WebConfigFormData,
  WebConfigOptions,
  WebSessionState
} from "./types";
import {
  CODEX_TASK_MODEL_DESCRIPTION,
  OPENAI_TASK_MODEL_DESCRIPTION
} from "../../src/modelSlotText.js";
import {
  buildOllamaChatModelChoices,
  buildOllamaExperimentModelChoices,
  buildOllamaResearchModelChoices,
  buildOllamaVisionModelChoices,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_CHAT_MODEL,
  DEFAULT_OLLAMA_EXPERIMENT_MODEL,
  DEFAULT_OLLAMA_RESEARCH_MODEL,
  DEFAULT_OLLAMA_VISION_MODEL
} from "../../src/integrations/ollama/modelCatalog.js";

const NODE_ORDER = [
  "collect_papers",
  "analyze_papers",
  "generate_hypotheses",
  "design_experiments",
  "implement_experiments",
  "run_experiments",
  "analyze_results",
  "review",
  "write_paper"
] as const;

type TabId = "logs" | "artifacts" | "checkpoints" | "knowledge" | "meta" | "workspace" | "doctor";

const DETAIL_TABS: Array<{ id: TabId; label: string }> = [
  { id: "logs", label: "Live logs" },
  { id: "artifacts", label: "Artifacts" },
  { id: "checkpoints", label: "Checkpoints" },
  { id: "knowledge", label: "Knowledge" },
  { id: "meta", label: "Metadata" },
  { id: "workspace", label: "Workspace" },
  { id: "doctor", label: "Doctor" }
];

type SetupFormState = WebConfigFormData & {
  semanticScholarApiKey: string;
  openAiApiKey: string;
};

interface UiActivityState {
  id: number;
  label: string;
}

type ReviewPreviewStatus = "ready" | "warning" | "blocking" | "manual";

interface ReviewPacketPreview {
  generated_at: string;
  readiness: {
    status: Exclude<ReviewPreviewStatus, "manual">;
    ready_checks: number;
    warning_checks: number;
    blocking_checks: number;
    manual_checks: number;
  };
  objective_status: string;
  objective_summary: string;
  recommendation?: {
    action: string;
    target?: string;
    confidence_pct: number;
    reason: string;
    evidence: string[];
  };
  checks: Array<{
    id: string;
    label: string;
    status: ReviewPreviewStatus;
    detail: string;
  }>;
  suggested_actions: string[];
}

export function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [session, setSession] = useState<WebSessionState | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>();
  const [selectedRun, setSelectedRun] = useState<RunRecord | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactEntry[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactEntry | null>(null);
  const [artifactPreview, setArtifactPreview] = useState<string | null>(null);
  const [expandedInsightReferenceKey, setExpandedInsightReferenceKey] = useState<string | null>(null);
  const [checkpoints, setCheckpoints] = useState<CheckpointEntry[]>([]);
  const [knowledgeEntries, setKnowledgeEntries] = useState<RepositoryKnowledgeEntry[]>([]);
  const [literature, setLiterature] = useState<RunLiteratureIndex | null>(null);
  const [knowledgePreviewPath, setKnowledgePreviewPath] = useState<string | null>(null);
  const [knowledgePreviewContent, setKnowledgePreviewContent] = useState<string | null>(null);
  const [doctorChecks, setDoctorChecks] = useState<DoctorCheck[]>([]);
  const [doctorReadiness, setDoctorReadiness] = useState<DoctorResponse["readiness"] | null>(null);
  const [doctorHarness, setDoctorHarness] = useState<HarnessValidationReport | null>(null);
  const [commandInput, setCommandInput] = useState("");
  const [runSearch, setRunSearch] = useState("");
  const [activeTab, setActiveTab] = useState<TabId>("logs");
  const [showNewRunForm, setShowNewRunForm] = useState(false);
  const [newRunBrief, setNewRunBrief] = useState("");
  const [newRunTopic, setNewRunTopic] = useState("");
  const [newRunConstraints, setNewRunConstraints] = useState("");
  const [newRunObjective, setNewRunObjective] = useState("");
  const [newRunAutoStart, setNewRunAutoStart] = useState(true);
  const [configOptions, setConfigOptions] = useState<WebConfigOptions>(createDefaultConfigOptions());
  const [setupForm, setSetupForm] = useState<SetupFormState>(createEmptySetupForm());
  const [setupSeeded, setSetupSeeded] = useState(false);
  const [uiActivity, setUiActivity] = useState<UiActivityState | null>(null);
  const uiActivitySeq = useRef(0);

  useEffect(() => {
    void refreshBootstrap();
    void refreshDoctor();
    void refreshKnowledge();
  }, []);

  useEffect(() => {
    if (!selectedRunId) {
      return;
    }
    setExpandedInsightReferenceKey(null);
    setKnowledgePreviewPath(null);
    setKnowledgePreviewContent(null);
    setLiterature(null);
    void refreshRunDetails(selectedRunId);
    void refreshLiterature(selectedRunId);
  }, [selectedRunId]);

  useEffect(() => {
    if (!expandedInsightReferenceKey) {
      return;
    }
    const references = session?.activeRunInsight?.references || [];
    if (!references.some((reference) => buildInsightReferenceKey(reference) === expandedInsightReferenceKey)) {
      setExpandedInsightReferenceKey(null);
    }
  }, [session?.activeRunInsight?.references, expandedInsightReferenceKey]);

  useEffect(() => {
    if (!bootstrap) {
      return;
    }
    if (bootstrap.configOptions) {
      setConfigOptions(bootstrap.configOptions);
    }
    setSession(bootstrap.session);
    setSelectedRunId(bootstrap.activeRunId || bootstrap.runs[0]?.id);
    if (!setupSeeded) {
      setSetupForm(createSetupFormFromBootstrap(bootstrap));
      setSetupSeeded(true);
      setNewRunTopic(bootstrap.setupDefaults.defaultTopic);
      setNewRunConstraints(bootstrap.setupDefaults.defaultConstraints.join(", "));
      setNewRunObjective(bootstrap.setupDefaults.defaultObjectiveMetric);
    }
  }, [bootstrap, setupSeeded]);

  useEffect(() => {
    const source = new EventSource("/api/events/stream");
    source.addEventListener("session_state", (event) => {
      const nextSession = JSON.parse((event as MessageEvent).data) as WebSessionState;
      startTransition(() => {
        setSession(nextSession);
        if (nextSession.activeRunId) {
          setSelectedRunId(nextSession.activeRunId);
        }
      });
    });
    source.addEventListener("runtime_event", () => {
      if (selectedRunId) {
        startTransition(() => {
          void refreshRunDetails(selectedRunId);
        });
      }
      startTransition(() => {
        void refreshKnowledge();
      });
    });
    source.addEventListener("bootstrap", () => {
      startTransition(() => {
        void refreshBootstrap();
        void refreshKnowledge();
      });
    });
    return () => {
      source.close();
    };
  }, [selectedRunId]);

  const filteredRuns = !bootstrap
    ? []
    : bootstrap.runs.filter((run) => {
        const query = runSearch.trim().toLowerCase();
        if (!query) {
          return true;
        }
        return run.id.toLowerCase().includes(query) || run.title.toLowerCase().includes(query);
      });
  const activeTabLabel = DETAIL_TABS.find((tab) => tab.id === activeTab)?.label || "Inspector";
  const jobRows = bootstrap?.jobs?.runs || [];
  const completedNodeCount = selectedRun
    ? NODE_ORDER.filter((node) => selectedRun.graph.nodeStates[node].status === "completed").length
    : 0;
  const selectedJob = selectedRun
    ? jobRows.find((job) => job.run_id === selectedRun.id) || null
    : null;
  const selectedRunStatusClass = selectedJob
    ? statusToneClass(selectedJob.lifecycle_status)
    : selectedRun
      ? statusToneClass(selectedRun.status)
      : "is-neutral";
  const isBusy = Boolean(session?.busy || uiActivity);
  const activeBusyLabel = session?.busy
    ? session.busyLabel || uiActivity?.label || "Working..."
    : uiActivity?.label;
  const selectedReviewPacket =
    selectedArtifact?.path === "review/review_packet.json" && artifactPreview
      ? parseReviewPacketPreview(artifactPreview)
      : null;
  const selectedCompletenessChecklistArtifact =
    artifacts.find((artifact) => artifact.path === "run_completeness_checklist.json") || null;
  const activeInsight =
    session && selectedRun && session.activeRunId === selectedRun.id ? session.activeRunInsight : null;
  const selectedKnowledgeEntry =
    knowledgeEntries.find((entry) => entry.run_id === (selectedRunId || session?.activeRunId)) || null;
  const activityRun =
    selectedRun ||
    (bootstrap?.runs || []).find((run) => run.id === (session?.activeRunId || selectedRunId));

  async function refreshBootstrap() {
    const data = await api<BootstrapResponse>("/api/bootstrap");
    setBootstrap(data);
  }

  async function refreshRunDetails(runId: string) {
    const [{ run }, artifactsResponse, checkpointsResponse] = await Promise.all([
      api<{ run: RunRecord }>(`/api/runs/${encodeURIComponent(runId)}`),
      api<{ artifacts: ArtifactEntry[] }>(`/api/runs/${encodeURIComponent(runId)}/artifacts`),
      api<{ checkpoints: CheckpointEntry[] }>(`/api/runs/${encodeURIComponent(runId)}/checkpoints`)
    ]);
    setSelectedRun(run);
    setArtifacts(artifactsResponse.artifacts);
    setCheckpoints(checkpointsResponse.checkpoints);
    if (selectedArtifact) {
      const nextArtifact = artifactsResponse.artifacts.find((item) => item.path === selectedArtifact.path) || null;
      setSelectedArtifact(nextArtifact);
      if (nextArtifact?.previewable) {
        await loadArtifactPreview(runId, nextArtifact);
        return;
      }
      setArtifactPreview(null);
      return;
    }
    setArtifactPreview(null);
  }

  async function refreshDoctor() {
    const response = await api<DoctorResponse>("/api/doctor");
    setDoctorChecks(response.checks);
    setDoctorReadiness(response.readiness || null);
    setDoctorHarness(response.harness || null);
  }

  async function refreshKnowledge() {
    const response = await api<KnowledgeResponse>("/api/knowledge");
    setKnowledgeEntries(response.entries);
  }

  async function refreshLiterature(runId: string) {
    const response = await api<LiteratureResponse>(`/api/runs/${encodeURIComponent(runId)}/literature`);
    setLiterature(response.literature);
  }

  async function loadKnowledgePreview(relativePath: string) {
    const response = await api<KnowledgeFileResponse>(`/api/knowledge/file?path=${encodeURIComponent(relativePath)}`);
    setKnowledgePreviewPath(response.path);
    setKnowledgePreviewContent(response.content);
  }

  async function loadArtifactPreview(runId: string, artifact: ArtifactEntry) {
    setSelectedArtifact(artifact);
    if (!artifact.previewable || artifact.kind === "directory") {
      setArtifactPreview(null);
      return;
    }
    if (artifact.kind === "image" || artifact.kind === "pdf") {
      setArtifactPreview(`/api/runs/${encodeURIComponent(runId)}/artifact?path=${encodeURIComponent(artifact.path)}`);
      return;
    }
    const text = await fetch(`/api/runs/${encodeURIComponent(runId)}/artifact?path=${encodeURIComponent(artifact.path)}`).then((response) => response.text());
    setArtifactPreview(text);
  }

  async function openInsightReference(referencePath: string) {
    const runId = selectedRunId || session?.activeRunId;
    if (!runId) {
      return;
    }
    const artifact =
      artifacts.find((item) => item.path === referencePath) || buildFallbackArtifactEntry(referencePath);
    setActiveTab("artifacts");
    await loadArtifactPreview(runId, artifact);
  }

  async function openKnowledgeArtifact(referencePath: string) {
    await openInsightReference(referencePath);
  }

  async function runSlashSelection(runId: string) {
    await withUiActivity(`Switching to ${runId}`, async () => {
      const response = await api<{ session: WebSessionState }>("/api/session/input", {
        method: "POST",
        body: JSON.stringify({ text: `/run ${runId}` })
      });
      setSession(response.session);
      setSelectedRunId(runId);
      await refreshBootstrap();
    });
  }

  async function submitComposer(event: FormEvent) {
    event.preventDefault();
    if (!commandInput.trim()) {
      return;
    }
    await runSessionCommand(commandInput);
    setCommandInput("");
  }

  async function submitNewRun(event: FormEvent) {
    event.preventDefault();
    const constraints = newRunConstraints
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    await withUiActivity("Creating a new run", async () => {
      const response = await api<{ run: RunRecord; session: WebSessionState }>("/api/runs", {
        method: "POST",
        body: JSON.stringify({
          brief: newRunBrief.trim() || undefined,
          topic: newRunTopic,
          constraints,
          objectiveMetric: newRunObjective,
          autoStart: newRunAutoStart
        })
      });
      setShowNewRunForm(false);
      setNewRunBrief("");
      setSession(response.session);
      setSelectedRunId(response.run.id);
      await refreshBootstrap();
      await refreshRunDetails(response.run.id);
    });
  }

  async function submitSetup(event: FormEvent) {
    event.preventDefault();
    await withUiActivity("Saving workspace settings", async () => {
      await api("/api/setup", {
        method: "POST",
        body: JSON.stringify({
          ...setupForm,
          defaultConstraints: setupForm.defaultConstraints
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        })
      });
      await refreshBootstrap();
      await refreshDoctor();
    });
  }

  async function triggerPending(action: "next" | "all" | "cancel") {
    await withUiActivity(labelPendingPlanAction(action), async () => {
      const response = await api<{ session: WebSessionState }>("/api/session/pending", {
        method: "POST",
        body: JSON.stringify({ action })
      });
      setSession(response.session);
      await refreshBootstrap();
      if (selectedRunId) {
        await refreshRunDetails(selectedRunId);
      }
    });
  }

  async function cancelActive() {
    await withUiActivity("Canceling the active task", async () => {
      const response = await api<{ session: WebSessionState }>("/api/session/cancel", {
        method: "POST"
      });
      setSession(response.session);
    });
  }

  async function runAction(endpoint: string, body?: unknown, activityLabel = "Running action") {
    await withUiActivity(activityLabel, async () => {
      const response = await api<{ session: WebSessionState }>(endpoint, {
        method: "POST",
        body: body ? JSON.stringify(body) : undefined
      });
      setSession(response.session);
      const nextRunId = response.session.activeRunId || selectedRunId;
      if (nextRunId) {
        setSelectedRunId(nextRunId);
      }
      await refreshBootstrap();
      if (nextRunId) {
        await refreshRunDetails(nextRunId);
      }
    });
  }

  async function runSessionCommand(text: string, activityLabel = `Running ${summarizeCommand(text)}`) {
    await withUiActivity(activityLabel, async () => {
      const response = await api<{ session: WebSessionState }>("/api/session/input", {
        method: "POST",
        body: JSON.stringify({ text })
      });
      setSession(response.session);
      const nextRunId = response.session.activeRunId || selectedRunId;
      if (nextRunId) {
        setSelectedRunId(nextRunId);
      }
      await refreshBootstrap();
      if (nextRunId) {
        await refreshRunDetails(nextRunId);
      }
    });
  }

  async function withUiActivity<T>(label: string, work: () => Promise<T>): Promise<T> {
    const id = uiActivitySeq.current + 1;
    uiActivitySeq.current = id;
    setUiActivity({ id, label });
    try {
      return await work();
    } finally {
      setUiActivity((current) => (current?.id === id ? null : current));
    }
  }

  if (!bootstrap) {
    return <div className="shell"><div className="panel hero">Loading AutoLabOS Web Ops...</div></div>;
  }

  if (!bootstrap.configured) {
    return (
      <div className="shell onboarding-shell">
        <div className="panel hero">
          <p className="eyebrow">AutoLabOS Web Ops</p>
          <h1>One screen for the full research loop.</h1>
          <p className="lede">
            Keep setup, runs, workflow controls, and artifacts in a browser UI that stays out of the way.
          </p>
          <div className="chip-list">
            <span className="chip">Onboarding</span>
            <span className="chip">Workflow control</span>
            <span className="chip">Artifacts</span>
            <span className="chip">Live logs</span>
          </div>
        </div>
        <ConfigEditorForm
          className="panel onboarding-form"
          form={setupForm}
          options={configOptions}
          onChange={setSetupForm}
          onSubmit={submitSetup}
          disabled={isBusy}
          heading="Initial setup"
          submitLabel="Initialize workspace"
          apiKeyHelp="API key fields are required on first setup."
        />
      </div>
    );
  }

  return (
    <div className="shell app-shell">
      <aside className="panel sidebar">
        <div className="sidebar-header">
          <div className="brand">
            <p className="eyebrow">AutoLabOS</p>
            <h1>Web Ops</h1>
            <p>{bootstrap.configSummary?.projectName}</p>
          </div>
          <div className="config-card">
            <div className="chip-list">
              <span className="chip">{labelWorkflowMode(bootstrap.configSummary?.workflowMode)}</span>
              <span className="chip">{labelApprovalMode(bootstrap.configSummary?.approvalMode)}</span>
              <span className="chip">{labelProviderMode(bootstrap.configSummary?.llmMode)}</span>
              <span className="chip">{labelPdfMode(bootstrap.configSummary?.pdfMode)}</span>
            </div>
            <small>Autonomy preset: Overnight safe policy on demand via <code>/agent overnight</code>.</small>
            <small>Research backend: {bootstrap.configSummary?.researchBackendModel} · {bootstrap.configSummary?.researchBackendReasoning}</small>
            <small>Experiment: {bootstrap.configSummary?.experimentModel} · {bootstrap.configSummary?.experimentReasoning}</small>
          </div>
        </div>
        <div className="section-heading">
          <div>
            <p className="section-kicker">Runs</p>
            <h2>Workspace runs</h2>
          </div>
          <span className="count-badge">{filteredRuns.length}</span>
        </div>
        <div className="sidebar-toolbar">
          <input
            placeholder="Search runs"
            value={runSearch}
            onChange={(event) => setRunSearch(event.target.value)}
          />
          <button
            className="button button-primary"
            type="button"
            disabled={isBusy}
            onClick={() => setShowNewRunForm((current) => !current)}
          >
            {showNewRunForm ? "Close" : "New run"}
          </button>
        </div>
        {showNewRunForm ? (
          <form className="subtle-card new-run-form" onSubmit={submitNewRun}>
            <label>
              Research brief
              <textarea
                disabled={isBusy}
                value={newRunBrief}
                onChange={(event) => setNewRunBrief(event.target.value)}
                rows={4}
                placeholder="Describe the topic, objective, constraints, and experiment plan in natural language."
              />
            </label>
            <label>
              Topic
              <input disabled={isBusy} value={newRunTopic} onChange={(event) => setNewRunTopic(event.target.value)} />
            </label>
            <label>
              Constraints
              <input disabled={isBusy} value={newRunConstraints} onChange={(event) => setNewRunConstraints(event.target.value)} />
            </label>
            <label>
              Objective
              <input disabled={isBusy} value={newRunObjective} onChange={(event) => setNewRunObjective(event.target.value)} />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                disabled={isBusy}
                checked={newRunAutoStart}
                onChange={(event) => setNewRunAutoStart(event.target.checked)}
              />
              <span>Auto-start research after creating the run</span>
            </label>
            <div className="form-actions">
              <button className="button button-primary" type="submit" disabled={isBusy}>
                {isBusy ? "Working..." : "Create run"}
              </button>
              <button className="button button-secondary" type="button" disabled={isBusy} onClick={() => setShowNewRunForm(false)}>Cancel</button>
            </div>
          </form>
        ) : null}
        <div className="run-list">
          {filteredRuns.length === 0 ? (
            <div className="inline-empty">No runs match this search yet.</div>
          ) : (
            filteredRuns.map((run) => {
              const job = jobRows.find((item) => item.run_id === run.id) || null;
              const lifecycleStatus = job?.lifecycle_status || run.status;
              return (
                <button
                  key={run.id}
                  className={`run-list-item ${selectedRunId === run.id ? "selected" : ""}`}
                  type="button"
                  disabled={isBusy}
                  onClick={() => {
                    void runSlashSelection(run.id);
                  }}
                >
                  <div className="run-list-top">
                    <span className="run-title">{run.title}</span>
                    <span className={`status-pill ${statusToneClass(lifecycleStatus)}`}>
                      {formatStatusLabel(lifecycleStatus)}
                    </span>
                  </div>
                  <div className="run-list-bottom">
                    <span className="run-meta">{formatNodeLabel(run.currentNode)}</span>
                    <span className="run-meta">{formatTimestamp(job?.last_event_at || run.updatedAt)}</span>
                  </div>
                  {job ? (
                    <div className="run-list-bottom">
                      <span className="run-meta">Next: {formatRunRecommendedAction(job.recommended_next_action)}</span>
                      <span className="run-meta">A/R/P: {formatReadinessTriple(job)}</span>
                    </div>
                  ) : null}
                  {job?.review_gate_status || job?.paper_readiness_state ? (
                    <div className="run-list-bottom">
                      {job.review_gate_status ? (
                        <span className="run-meta">
                          Review: {job.review_gate_label || formatReviewGateStatus(job.review_gate_status, job.review_decision_outcome, job.review_recommended_transition)}
                          {typeof job.review_score_overall === "number" ? ` · ${job.review_score_overall}/5` : ""}
                        </span>
                      ) : null}
                      {job.paper_readiness_state ? (
                        <span className="run-meta">Paper: {job.paper_readiness_state}</span>
                      ) : null}
                    </div>
                  ) : null}
                  {job?.network_dependency || job?.validation_scope === "live_fixture" ? (
                    <div className="run-list-bottom">
                      {job.network_dependency ? (
                        <span className="run-meta">Network: {job.network_dependency.operator_label}</span>
                      ) : null}
                      {job.validation_scope === "live_fixture" ? (
                        <span className="run-meta">Scope: Live fixture</span>
                      ) : null}
                    </div>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
        {bootstrap.jobs?.top_failures?.length ? (
          <section className="subtle-card">
            <p className="section-kicker">Top failures</p>
            <div className="manuscript-quality-group-list">
              {bootstrap.jobs.top_failures.map((failure) => (
                <div key={failure.key} className="manuscript-quality-group-line">
                  <p>
                    <strong>{Math.round(failure.recurrence_probability * 100)}%</strong> · {failure.reason}
                  </p>
                  <p className="doctor-harness-meta">Fix: {failure.remediation}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </aside>

      <main className="main-column">
        {isBusy && activeBusyLabel ? (
          <section className="panel activity-banner" role="status" aria-live="polite">
            <div className="activity-banner-main">
              <span className="activity-spinner" aria-hidden="true" />
              <div className="activity-banner-copy">
                <p className="section-kicker">Runtime activity</p>
                <h2>{activeBusyLabel}</h2>
                <p className="activity-banner-meta">
                  {activityRun
                    ? `${activityRun.title} · ${formatNodeLabel(activityRun.currentNode)}`
                    : "Waiting for live session updates and artifact refreshes."}
                </p>
              </div>
            </div>
            <div className="activity-banner-side">
              <span className="status-pill is-active">
                <span className="mini-spinner" aria-hidden="true" />
                {session?.canCancel ? "Cancelable" : session?.busy ? "Running" : "Starting"}
              </span>
              {session?.canCancel ? (
                <button className="button button-danger" type="button" onClick={() => void cancelActive()}>
                  Cancel active task
                </button>
              ) : null}
            </div>
          </section>
        ) : null}

        {selectedRun ? (
          <>
            <section className="panel run-header">
              <div className="run-header-top">
                <div>
                  <p className="eyebrow">Selected run</p>
                  <div className="title-row">
                    <h2>{selectedRun.title}</h2>
                    <span className={`status-pill ${selectedRunStatusClass}`}>
                      {formatStatusLabel(selectedJob?.lifecycle_status || selectedRun.status)}
                    </span>
                  </div>
                  <p className="run-topic">{selectedRun.topic}</p>
                </div>
                <div className="header-actions">
                  <button
                    className="button button-primary"
                    type="button"
                    disabled={isBusy}
                    onClick={() => void runAction(`/api/runs/${selectedRun.id}/actions/approve`, undefined, "Approving current node")}
                  >
                    Approve
                  </button>
                  {selectedRun.graph.pendingTransition ? (
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={isBusy}
                      onClick={() =>
                        void runAction(
                          `/api/runs/${selectedRun.id}/actions/apply-transition`,
                          undefined,
                          "Applying transition recommendation"
                        )
                      }
                    >
                      Apply recommendation
                    </button>
                  ) : null}
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={isBusy}
                    onClick={() =>
                      void runAction(
                        `/api/runs/${selectedRun.id}/actions/overnight`,
                        undefined,
                        "Starting autonomy preset: overnight"
                      )
                    }
                  >
                    Overnight preset
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={isBusy}
                    onClick={() => void runAction(`/api/runs/${selectedRun.id}/actions/retry`, undefined, "Retrying current node")}
                  >
                    Retry
                  </button>
                  {session?.canCancel ? (
                    <button className="button button-danger" type="button" onClick={() => void cancelActive()}>Cancel</button>
                  ) : null}
                </div>
              </div>

              <div className="stat-grid">
                <article className="stat-card">
                  <span className="stat-label">Current node</span>
                  <strong>{formatNodeLabel(selectedRun.currentNode)}</strong>
                </article>
                <article className="stat-card">
                  <span className="stat-label">Progress</span>
                  <strong>{completedNodeCount} / {NODE_ORDER.length}</strong>
                </article>
                <article className="stat-card">
                  <span className="stat-label">Checkpoint</span>
                  <strong>#{selectedRun.graph.checkpointSeq}</strong>
                </article>
                {selectedJob ? (
                  <>
                    <article className="stat-card">
                      <span className="stat-label">Approval mode</span>
                      <strong>{labelApprovalMode(selectedJob.approval_mode)}</strong>
                    </article>
                    <article className="stat-card">
                      <span className="stat-label">Next action</span>
                      <strong>{formatRunRecommendedAction(selectedJob.recommended_next_action)}</strong>
                    </article>
                    <article className="stat-card">
                      <span className="stat-label">Readiness</span>
                      <strong>{formatReadinessTriple(selectedJob)}</strong>
                    </article>
                    {selectedJob.review_gate_status ? (
                      <article className="stat-card">
                        <span className="stat-label">Review gate</span>
                        <strong>{selectedJob.review_gate_label || formatReviewGateStatus(selectedJob.review_gate_status, selectedJob.review_decision_outcome, selectedJob.review_recommended_transition)}</strong>
                      </article>
                    ) : null}
                    {typeof selectedJob.review_score_overall === "number" ? (
                      <article className="stat-card">
                        <span className="stat-label">Review score</span>
                        <strong>{selectedJob.review_score_overall}/5</strong>
                      </article>
                    ) : null}
                    {selectedJob.paper_readiness_state ? (
                      <article className="stat-card">
                        <span className="stat-label">Paper state</span>
                        <strong>{selectedJob.paper_gate_label || selectedJob.paper_readiness_state}</strong>
                      </article>
                    ) : null}
                    {selectedJob.network_dependency ? (
                      <article className="stat-card">
                        <span className="stat-label">Network</span>
                        <strong>{selectedJob.network_dependency.operator_label}</strong>
                      </article>
                    ) : null}
                    {selectedJob.validation_scope === "live_fixture" ? (
                      <article className="stat-card">
                        <span className="stat-label">Validation scope</span>
                        <strong>Live fixture</strong>
                      </article>
                    ) : null}
                    {selectedCompletenessChecklistArtifact ? (
                      <article className="stat-card">
                        <span className="stat-label">Completeness</span>
                        <button
                          className="button button-secondary button-small"
                          type="button"
                          disabled={isBusy}
                          onClick={() => void openInsightReference("run_completeness_checklist.json")}
                        >
                          Open checklist
                        </button>
                      </article>
                    ) : null}
                  </>
                ) : null}
              </div>

              {selectedJob?.blocker_summary ? (
                <p className="summary-copy">{selectedJob.blocker_summary}</p>
              ) : null}

              {selectedRun.constraints.length > 0 ? (
                <div className="chip-list">
                  {selectedRun.constraints.map((constraint) => (
                    <span key={constraint} className="chip">{constraint}</span>
                  ))}
                </div>
              ) : null}

              {selectedRun.latestSummary ? (
                <p className="summary-copy">{selectedRun.latestSummary}</p>
              ) : null}

              {activeInsight ? (
                <section className={`inline-panel insight-panel ${activeInsight.manuscriptQuality ? "manuscript-quality-panel" : ""}`}>
                  {activeInsight.manuscriptQuality ? (
                    <div className="manuscript-quality-header">
                      <p className="section-kicker">{activeInsight.title}</p>
                      <div className="chip-list manuscript-quality-status-row">
                        <span className={`status-pill ${manuscriptQualityStatusToneClass(activeInsight.manuscriptQuality.status)}`}>
                          {formatManuscriptQualityStatus(activeInsight.manuscriptQuality.status)}
                        </span>
                        <span className="chip">{formatManuscriptQualityStage(activeInsight.manuscriptQuality.stage)}</span>
                        <span className="chip">
                          Repairs {activeInsight.manuscriptQuality.repairAttempts.attempted}/{activeInsight.manuscriptQuality.repairAttempts.allowedMax}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="section-kicker">{activeInsight.title}</p>
                  )}
                  {activeInsight.manuscriptQuality ? (
                    <div className="manuscript-quality-summary">
                      <div className="manuscript-quality-stat-grid">
                        <article className="stat-card manuscript-quality-stat-card">
                          <span className="stat-label">Reason</span>
                          <strong>{activeInsight.manuscriptQuality.displayReasonLabel || formatManuscriptQualityReason(activeInsight.manuscriptQuality.reasonCategory)}</strong>
                        </article>
                        <article className="stat-card manuscript-quality-stat-card">
                          <span className="stat-label">Triggered By</span>
                          <strong>{activeInsight.manuscriptQuality.triggeredBy.join(", ") || "No triggers recorded"}</strong>
                        </article>
                        <article className="stat-card manuscript-quality-stat-card">
                          <span className="stat-label">Review Reliability</span>
                          <strong>{formatManuscriptQualityReliability(activeInsight.manuscriptQuality.reviewReliability)}</strong>
                        </article>
                      </div>

                      <div className="manuscript-quality-group-grid">
                        {buildManuscriptQualityGroupCards(activeInsight.manuscriptQuality).map((group) => (
                          <article key={group.key} className="manuscript-quality-group-card">
                            <div className="manuscript-quality-group-header">
                              <span className="stat-label">{group.label}</span>
                              <span className={`status-pill ${group.toneClass}`}>{group.items.length}</span>
                            </div>
                            <div className="manuscript-quality-group-list">
                              {group.items.slice(0, 3).map((item) => (
                                <p key={`${group.key}-${item.code}-${item.section}-${item.message}`} className="manuscript-quality-group-line">
                                  <strong>{item.code}</strong> · {item.section} · {item.message}
                                </p>
                              ))}
                              {group.items.length > 3 ? (
                                <p className="manuscript-quality-group-line">
                                  +{group.items.length - 3} more finding(s)
                                </p>
                              ) : null}
                            </div>
                          </article>
                        ))}
                      </div>

                      {activeInsight.manuscriptQuality.artifactRefs.length ? (
                        <div className="manuscript-quality-artifacts">
                          {activeInsight.manuscriptQuality.artifactRefs.map((artifactRef) => (
                            <button
                              key={`${artifactRef.label}-${artifactRef.path}`}
                              className="button button-secondary button-small"
                              type="button"
                              disabled={isBusy}
                              onClick={() => void openInsightReference(artifactRef.path)}
                            >
                              {artifactRef.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : activeInsight.readinessRisks ? (
                    <div className="manuscript-quality-summary">
                      <div className="manuscript-quality-stat-grid">
                        <article className="stat-card manuscript-quality-stat-card">
                          <span className="stat-label">Readiness State</span>
                          <strong>{activeInsight.readinessRisks.readinessState}</strong>
                        </article>
                        <article className="stat-card manuscript-quality-stat-card">
                          <span className="stat-label">Blocked Risks</span>
                          <strong>{activeInsight.readinessRisks.riskCounts.blocked}</strong>
                        </article>
                        <article className="stat-card manuscript-quality-stat-card">
                          <span className="stat-label">Warning Risks</span>
                          <strong>{activeInsight.readinessRisks.riskCounts.warning}</strong>
                        </article>
                      </div>

                      <div className="manuscript-quality-group-grid">
                        {buildReadinessRiskGroupCards(activeInsight.readinessRisks).map((group) => (
                          <article key={group.key} className="manuscript-quality-group-card">
                            <div className="manuscript-quality-group-header">
                              <span className="stat-label">{group.label}</span>
                              <span className={`status-pill ${group.toneClass}`}>{group.items.length}</span>
                            </div>
                            <div className="manuscript-quality-group-list">
                              {group.items.slice(0, 3).map((item) => (
                                <p key={`${group.key}-${item.code}-${item.section}-${item.message}`} className="manuscript-quality-group-line">
                                  <strong>{item.code}</strong> · {item.section} · {item.message}
                                </p>
                              ))}
                              {group.items.length > 3 ? (
                                <p className="manuscript-quality-group-line">
                                  +{group.items.length - 3} more finding(s)
                                </p>
                              ) : null}
                            </div>
                          </article>
                        ))}
                      </div>

                      {activeInsight.readinessRisks.artifactRefs.length ? (
                        <div className="manuscript-quality-artifacts">
                          {activeInsight.readinessRisks.artifactRefs.map((artifactRef) => (
                            <button
                              key={`${artifactRef.label}-${artifactRef.path}`}
                              className="button button-secondary button-small"
                              type="button"
                              disabled={isBusy}
                              onClick={() => void openInsightReference(artifactRef.path)}
                            >
                              {artifactRef.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="insight-list">
                    {activeInsight.lines.map((line) => (
                      <p key={line} className="insight-line">{line}</p>
                    ))}
                  </div>
                  {activeInsight.actions?.length ? (
                    <div className="insight-actions">
                      {activeInsight.actions.map((action) => (
                        <button
                          key={`${action.label}-${action.command}`}
                          className="button button-secondary button-small insight-action"
                          type="button"
                          disabled={isBusy}
                          onClick={() => void runSessionCommand(action.command, `${action.label} · ${action.command}`)}
                        >
                          <span>{action.label}</span>
                          <code>{action.command}</code>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {!activeInsight.manuscriptQuality && activeInsight.references?.length ? (
                    <div className="insight-references">
                      {activeInsight.references.map((reference) => {
                        const referenceKey = buildInsightReferenceKey(reference);
                        const isExpanded = expandedInsightReferenceKey === referenceKey;
                        return (
                          <article
                            key={referenceKey}
                            className={`insight-reference-card ${isExpanded ? "expanded" : ""}`}
                          >
                            <button
                              className="button button-ghost button-small insight-reference"
                              type="button"
                              aria-expanded={isExpanded}
                              onClick={() =>
                                setExpandedInsightReferenceKey((current) =>
                                  current === referenceKey ? null : referenceKey
                                )
                              }
                            >
                              <span className="insight-reference-kind">{labelInsightReferenceKind(reference.kind)}</span>
                              <span>{reference.label}</span>
                              <code>{reference.path}</code>
                              {reference.facts?.length ? (
                                <div className="insight-reference-facts">
                                  {reference.facts.map((fact) => (
                                    <span key={`${reference.label}-${fact.label}-${fact.value}`} className="insight-reference-fact">
                                      {fact.label} {fact.value}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                              <small>{reference.summary}</small>
                            </button>
                            {isExpanded ? (
                              <div className="insight-reference-detail">
                                {reference.details?.length ? (
                                  <div className="insight-reference-detail-list">
                                    {reference.details.map((detail) => (
                                      <p key={`${referenceKey}-${detail}`} className="insight-reference-detail-line">
                                        {detail}
                                      </p>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="insight-reference-detail-line">
                                    No additional grounded detail is attached to this evidence card yet.
                                  </p>
                                )}
                                <div className="insight-reference-detail-actions">
                                  <button
                                    className="button button-secondary button-small"
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() => void openInsightReference(reference.path)}
                                    aria-label={`Open artifact for ${reference.label}`}
                                  >
                                    Open artifact
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              ) : null}

              {selectedRun.graph.pendingTransition ? (
                <section className="inline-panel">
                  <p className="section-kicker">Transition recommendation</p>
                  <h3>
                    {selectedRun.graph.pendingTransition.action}
                    {selectedRun.graph.pendingTransition.targetNode
                      ? ` -> ${formatNodeLabel(selectedRun.graph.pendingTransition.targetNode)}`
                      : ""}
                  </h3>
                  <p className="summary-copy">{selectedRun.graph.pendingTransition.reason}</p>
                  <p className="run-meta">
                    Confidence {selectedRun.graph.pendingTransition.confidence.toFixed(2)}
                    {" · "}
                    {selectedRun.graph.pendingTransition.autoExecutable ? "auto-executable" : "review first"}
                  </p>
                  <div className="chip-list">
                    {selectedRun.graph.pendingTransition.evidence.map((item) => (
                      <span key={item} className="chip">{item}</span>
                    ))}
                  </div>
                  <div className="insight-actions">
                    <button
                      className="button button-secondary button-small insight-action"
                      type="button"
                      disabled={isBusy}
                      onClick={() => void runSessionCommand("/agent apply", "Applying transition recommendation")}
                    >
                      <span>Apply recommendation</span>
                      <code>/agent apply</code>
                    </button>
                    {selectedRun.graph.pendingTransition.autoExecutable ? (
                      <button
                        className="button button-secondary button-small insight-action"
                        type="button"
                        disabled={isBusy}
                        onClick={() => void runSessionCommand("/agent overnight", "Starting autonomy preset: overnight")}
                      >
                        <span>Start overnight preset</span>
                        <code>/agent overnight</code>
                      </button>
                    ) : null}
                  </div>
                </section>
              ) : null}
            </section>

            <section className="panel workflow-panel">
              <div className="section-heading">
                <div>
                  <p className="section-kicker">Workflow</p>
                  <h3>Workflow state graph</h3>
                </div>
                <span className="count-badge">{completedNodeCount}/{NODE_ORDER.length} complete</span>
              </div>

              <div className="workflow-grid">
                {NODE_ORDER.map((node) => {
                  const state = selectedRun.graph.nodeStates[node];
                  const isCurrent = selectedRun.currentNode === node;
                  return (
                    <article key={node} className={`node-card status-${state.status} ${isCurrent ? "current" : ""}`}>
                      <header className="node-card-header">
                        <span className="node-index">{NODE_ORDER.indexOf(node) + 1}</span>
                        <div className="node-copy">
                          <h3>{formatNodeLabel(node)}</h3>
                          <p className="node-note">{state.note || state.lastError || "No node note yet."}</p>
                        </div>
                        <span className={`status-pill ${statusToneClass(state.status)}`}>{formatStatusLabel(state.status)}</span>
                      </header>
                      <div className="node-footer">
                        <span className="node-meta">{isCurrent ? "Current node" : formatTimestamp(state.updatedAt)}</span>
                        <div className="node-actions">
                          <button
                            className="button button-secondary button-small"
                            type="button"
                            disabled={isBusy}
                            onClick={() => void runAction(`/api/runs/${selectedRun.id}/actions/run-node`, { node }, `Running ${formatNodeLabel(node)}`)}
                          >
                            Run
                          </button>
                          <button
                            className="button button-secondary button-small"
                            type="button"
                            disabled={isBusy}
                            onClick={() => void runAction(`/api/runs/${selectedRun.id}/actions/retry`, { node }, `Retrying ${formatNodeLabel(node)}`)}
                          >
                            Retry
                          </button>
                          <button
                            className="button button-ghost button-small"
                            type="button"
                            disabled={isBusy}
                            onClick={() => void runAction(`/api/runs/${selectedRun.id}/actions/jump`, { node, force: true }, `Jumping to ${formatNodeLabel(node)}`)}
                          >
                            Jump
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </>
        ) : (
          <section className="panel empty-state">
            <h2>No run selected</h2>
            <p>Choose a run from the left rail or create a new one to inspect the workflow.</p>
          </section>
        )}

        {session?.pendingPlan ? (
          <section className="panel pending-panel">
            <div className="section-heading">
              <div>
                <p className="section-kicker">Pending plan</p>
                <h3>Step {session.pendingPlan.stepIndex + 1} of {session.pendingPlan.totalSteps}</h3>
              </div>
              <span className="count-badge">{session.pendingPlan.totalSteps} queued</span>
            </div>
            <div className="pending-body">
              <ol className="command-list">
                {session.pendingPlan.displayCommands.map((command) => (
                  <li key={command}>{command}</li>
                ))}
              </ol>
              <div className="pending-actions">
                <button className="button button-primary" type="button" disabled={isBusy} onClick={() => void triggerPending("next")}>Run next</button>
                {session.pendingPlan.totalSteps > 1 ? (
                  <button className="button button-secondary" type="button" disabled={isBusy} onClick={() => void triggerPending("all")}>Run all</button>
                ) : null}
                <button className="button button-danger" type="button" disabled={isBusy} onClick={() => void triggerPending("cancel")}>Cancel</button>
              </div>
            </div>
          </section>
        ) : null}

      </main>

      <aside className="panel detail-column">
        <div className="detail-header">
          <div>
            <p className="section-kicker">Inspector</p>
            <h2>{activeTabLabel}</h2>
          </div>
        </div>
        <div className="tab-row">
          {DETAIL_TABS.map((tab) => (
            <button
              key={tab.id}
              className={`tab-button ${activeTab === tab.id ? "active" : ""}`}
              type="button"
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="detail-content">
          {activeTab === "logs" ? (
            <div className="log-list">
              {(session?.logs || []).length === 0 ? (
                <div className="inline-empty">Live runtime output will appear here.</div>
              ) : (
                (session?.logs || []).slice(-80).map((line, index) => (
                  <pre key={`${line}-${index}`} className="log-line">{line}</pre>
                ))
              )}
            </div>
          ) : null}

          {activeTab === "artifacts" ? (
            <div className="artifact-layout">
              <div className="artifact-list">
                {artifacts.length === 0 ? (
                  <div className="inline-empty">No artifacts for this run yet.</div>
                ) : (
                  artifacts.map((artifact) => (
                    <button
                      key={artifact.path}
                      className={`artifact-item ${selectedArtifact?.path === artifact.path ? "selected" : ""}`}
                      type="button"
                      onClick={() => {
                        if (selectedRunId) {
                          void loadArtifactPreview(selectedRunId, artifact);
                        }
                      }}
                    >
                      <span>{artifact.path}</span>
                      <small>{labelArtifactKind(artifact.kind)} · {formatBytes(artifact.size)}</small>
                    </button>
                  ))
                )}
              </div>
              <div className="artifact-preview">
                {selectedArtifact?.kind === "image" && artifactPreview ? <img src={artifactPreview} alt={selectedArtifact.path} /> : null}
                {selectedArtifact?.kind === "pdf" && artifactPreview ? <iframe src={artifactPreview} title={selectedArtifact.path} /> : null}
                {selectedArtifact?.path === "review/review_packet.json" && selectedReviewPacket ? (
                  <div className="review-preview">
                    <div className="review-preview-header">
                      <div className="review-preview-copy">
                        <p className="section-kicker">Manual review</p>
                        <h3>Review readiness</h3>
                        <p className="summary-copy">{selectedReviewPacket.objective_summary}</p>
                      </div>
                      <span className={`status-pill ${reviewStatusToneClass(selectedReviewPacket.readiness.status)}`}>
                        {toHeadline(selectedReviewPacket.readiness.status)}
                      </span>
                    </div>

                    <div className="review-summary-grid">
                      <article className="stat-card">
                        <span className="stat-label">Ready</span>
                        <strong>{selectedReviewPacket.readiness.ready_checks}</strong>
                      </article>
                      <article className="stat-card">
                        <span className="stat-label">Warning</span>
                        <strong>{selectedReviewPacket.readiness.warning_checks}</strong>
                      </article>
                      <article className="stat-card">
                        <span className="stat-label">Blocking</span>
                        <strong>{selectedReviewPacket.readiness.blocking_checks}</strong>
                      </article>
                      <article className="stat-card">
                        <span className="stat-label">Manual</span>
                        <strong>{selectedReviewPacket.readiness.manual_checks}</strong>
                      </article>
                    </div>

                    <article className="subtle-card review-objective-card">
                      <span className="stat-label">Objective</span>
                      <strong>{toHeadline(selectedReviewPacket.objective_status)}</strong>
                      <p className="summary-copy">{selectedReviewPacket.objective_summary}</p>
                      <small>{selectedReviewPacket.generated_at ? formatTimestamp(selectedReviewPacket.generated_at) : "No timestamp"}</small>
                    </article>

                    {selectedReviewPacket.recommendation ? (
                      <article className="subtle-card review-objective-card">
                        <span className="stat-label">Recommendation</span>
                        <strong>
                          {selectedReviewPacket.recommendation.action}
                          {selectedReviewPacket.recommendation.target
                            ? ` -> ${formatNodeLabel(selectedReviewPacket.recommendation.target)}`
                            : ""}
                        </strong>
                        <p className="summary-copy">{selectedReviewPacket.recommendation.reason}</p>
                        <div className="chip-list">
                          <span className="chip">{selectedReviewPacket.recommendation.confidence_pct}% confidence</span>
                          {selectedReviewPacket.recommendation.evidence.map((item) => (
                            <span key={item} className="chip">{item}</span>
                          ))}
                        </div>
                      </article>
                    ) : null}

                    <div className="insight-actions">
                      <button
                        className="button button-secondary button-small insight-action"
                        type="button"
                        disabled={isBusy}
                        onClick={() => void runSessionCommand("/agent review", "Refreshing review packet")}
                      >
                        <span>Refresh review</span>
                        <code>/agent review</code>
                      </button>
                      {selectedReviewPacket.suggested_actions.map((command) => (
                        <button
                          key={command}
                          className="button button-secondary button-small insight-action"
                          type="button"
                          disabled={isBusy}
                          onClick={() => void runSessionCommand(command, `Running ${summarizeCommand(command)}`)}
                        >
                          <span>{labelReviewAction(command)}</span>
                          <code>{command}</code>
                        </button>
                      ))}
                    </div>

                    <div className="review-check-grid">
                      {selectedReviewPacket.checks.map((check) => (
                        <article key={check.id} className={`review-check-card status-${check.status}`}>
                          <div className="review-check-top">
                            <strong>{check.label}</strong>
                            <span className={`status-pill ${reviewStatusToneClass(check.status)}`}>
                              {toHeadline(check.status)}
                            </span>
                          </div>
                          <p>{check.detail}</p>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : null}
                {selectedArtifact && (selectedArtifact.kind === "text" || selectedArtifact.kind === "json") ? (
                  selectedArtifact.path === "review/review_packet.json" && selectedReviewPacket ? null : <pre>{artifactPreview}</pre>
                ) : null}
                {selectedArtifact && selectedArtifact.kind === "download" ? (
                  <a
                    className="button button-secondary"
                    href={`/api/runs/${encodeURIComponent(selectedRunId || "")}/artifact?path=${encodeURIComponent(selectedArtifact.path)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Download artifact
                  </a>
                ) : null}
                {!selectedArtifact ? <div className="inline-empty">Choose an artifact to preview it here.</div> : null}
              </div>
            </div>
          ) : null}

          {activeTab === "checkpoints" ? (
            <div className="checkpoint-list">
              {checkpoints.length === 0 ? (
                <div className="inline-empty">No checkpoints recorded yet.</div>
              ) : (
                checkpoints.map((checkpoint) => (
                  <article key={checkpoint.seq} className="checkpoint-item">
                    <div className="checkpoint-row">
                      <strong>#{checkpoint.seq}</strong>
                      <span className="status-pill is-neutral">{formatNodeLabel(checkpoint.node)}</span>
                    </div>
                    <span>{formatStatusLabel(checkpoint.phase)}</span>
                    <small>{formatTimestamp(checkpoint.createdAt)}</small>
                    {checkpoint.reason ? <small>{checkpoint.reason}</small> : null}
                  </article>
                ))
              )}
            </div>
          ) : null}

          {activeTab === "knowledge" ? (
            <div className="checkpoint-list">
              {selectedKnowledgeEntry ? (
                <article className="meta-card">
                  <article className="meta-row"><span>Run</span><strong>{selectedKnowledgeEntry.run_id}</strong></article>
                  <article className="meta-row"><span>Title</span><strong>{selectedKnowledgeEntry.title}</strong></article>
                  <article className="meta-row"><span>Latest section</span><strong>{selectedKnowledgeEntry.latest_published_section}</strong></article>
                  <article className="meta-row"><span>Updated</span><strong>{formatTimestamp(selectedKnowledgeEntry.updated_at)}</strong></article>
                  <article className="meta-row"><span>Objective</span><strong>{selectedKnowledgeEntry.objective_metric}</strong></article>
                  {selectedKnowledgeEntry.research_question ? (
                    <article className="meta-row"><span>Question</span><strong>{selectedKnowledgeEntry.research_question}</strong></article>
                  ) : null}
                  {selectedKnowledgeEntry.analysis_summary ? (
                    <article className="meta-row"><span>Analysis</span><strong>{selectedKnowledgeEntry.analysis_summary}</strong></article>
                  ) : null}
                  {selectedKnowledgeEntry.latest_summary ? (
                    <article className="meta-row"><span>Summary</span><strong>{selectedKnowledgeEntry.latest_summary}</strong></article>
                  ) : null}
                  {selectedKnowledgeEntry.manuscript_type ? (
                    <article className="meta-row"><span>Manuscript</span><strong>{selectedKnowledgeEntry.manuscript_type}</strong></article>
                  ) : null}
                  <article className="meta-row"><span>Knowledge note</span><strong>{selectedKnowledgeEntry.knowledge_note}</strong></article>
                  <article className="meta-row"><span>Manifest</span><strong>{selectedKnowledgeEntry.public_manifest}</strong></article>
                  <div className="pending-actions">
                    <button
                      className="button button-secondary button-small"
                      type="button"
                      onClick={() => void loadKnowledgePreview(selectedKnowledgeEntry.knowledge_note)}
                    >
                      Preview note
                    </button>
                    <button
                      className="button button-secondary button-small"
                      type="button"
                      onClick={() => void loadKnowledgePreview(selectedKnowledgeEntry.public_manifest)}
                    >
                      Preview manifest
                    </button>
                    {literature ? (
                      <button
                        className="button button-secondary button-small"
                        type="button"
                        onClick={() => void loadKnowledgePreview(literature.artifacts.literature_index_path)}
                      >
                        Preview literature index
                      </button>
                    ) : null}
                  </div>
                  <div className="chip-list">
                    {selectedKnowledgeEntry.sections.map((section) => (
                      <span key={`${selectedKnowledgeEntry.run_id}-${section.name}`} className="chip">
                        {section.name}
                      </span>
                    ))}
                  </div>
                </article>
              ) : (
                <div className="inline-empty">No repository knowledge is available for the selected run yet.</div>
              )}

              {literature ? (
                <article className="meta-card">
                  <article className="meta-row"><span>Corpus</span><strong>{literature.corpus.paper_count} papers</strong></article>
                  <article className="meta-row"><span>PDF coverage</span><strong>{literature.corpus.papers_with_pdf} with PDF / {literature.corpus.missing_pdf_count} missing</strong></article>
                  <article className="meta-row"><span>BibTeX coverage</span><strong>{literature.corpus.papers_with_bibtex} with BibTeX / {literature.corpus.enriched_bibtex_count} enriched</strong></article>
                  <article className="meta-row"><span>Citations</span><strong>{literature.citations.total} total / avg {literature.citations.average}</strong></article>
                  <article className="meta-row"><span>Analysis coverage</span><strong>{literature.analysis.summary_count} summaries / {literature.analysis.evidence_count} evidence</strong></article>
                  <article className="meta-row"><span>Source detail</span><strong>{literature.analysis.full_text_summary_count} full text / {literature.analysis.abstract_summary_count} abstract</strong></article>
                  {literature.citations.top_paper ? (
                    <article className="meta-row"><span>Top cited</span><strong>{literature.citations.top_paper.title} ({literature.citations.top_paper.citation_count})</strong></article>
                  ) : null}
                  {literature.corpus.year_range ? (
                    <article className="meta-row"><span>Year range</span><strong>{literature.corpus.year_range.min} - {literature.corpus.year_range.max}</strong></article>
                  ) : null}
                  {literature.corpus.top_venues.length > 0 ? (
                    <div className="chip-list">
                      {literature.corpus.top_venues.map((venue) => (
                        <span key={venue} className="chip">{venue}</span>
                      ))}
                    </div>
                  ) : null}
                  <div className="pending-actions">
                    <button
                      className="button button-secondary button-small"
                      type="button"
                      onClick={() => void openKnowledgeArtifact(literature.artifacts.collect_result_path)}
                    >
                      Open collect result
                    </button>
                    <button
                      className="button button-secondary button-small"
                      type="button"
                      onClick={() => void openKnowledgeArtifact(literature.artifacts.corpus_path)}
                    >
                      Open corpus
                    </button>
                    <button
                      className="button button-secondary button-small"
                      type="button"
                      onClick={() => void openKnowledgeArtifact(literature.artifacts.bibtex_path)}
                    >
                      Open bibtex
                    </button>
                    <button
                      className="button button-secondary button-small"
                      type="button"
                      onClick={() => void openKnowledgeArtifact(literature.artifacts.summaries_path)}
                    >
                      Open summaries
                    </button>
                    <button
                      className="button button-secondary button-small"
                      type="button"
                      onClick={() => void openKnowledgeArtifact(literature.artifacts.evidence_path)}
                    >
                      Open evidence
                    </button>
                  </div>
                  {literature.warnings.length > 0 ? (
                    <div className="doctor-harness-findings">
                      {literature.warnings.map((warning) => (
                        <article key={warning} className="doctor-harness-finding">
                          <strong>Warning</strong>
                          <p>{warning}</p>
                        </article>
                      ))}
                    </div>
                  ) : null}
                </article>
              ) : selectedRunId ? (
                <div className="inline-empty">Literature summary is loading for the selected run.</div>
              ) : null}

              {knowledgePreviewPath ? (
                <article className="meta-card">
                  <article className="meta-row"><span>Preview</span><strong>{knowledgePreviewPath}</strong></article>
                  <pre>{knowledgePreviewContent}</pre>
                </article>
              ) : (
                <div className="inline-empty">Choose note, manifest, or literature index to preview the underlying file.</div>
              )}

              {knowledgeEntries.length === 0 ? (
                <div className="inline-empty">Repository knowledge will appear after public outputs are published.</div>
              ) : (
                knowledgeEntries.map((entry) => (
                  <article key={entry.run_id} className="checkpoint-item">
                    <div className="checkpoint-row">
                      <strong>{entry.title}</strong>
                      <span className={`status-pill ${entry.run_id === (selectedRunId || session?.activeRunId) ? "is-success" : "is-neutral"}`}>
                        {entry.latest_published_section}
                      </span>
                    </div>
                    <span>{entry.run_id}</span>
                    <small>{entry.analysis_summary || entry.latest_summary || entry.topic}</small>
                    <small>{formatTimestamp(entry.updated_at)}</small>
                    <div className="pending-actions">
                      <button
                        className="button button-secondary button-small"
                        type="button"
                        onClick={() => setSelectedRunId(entry.run_id)}
                      >
                        Select run
                      </button>
                      <button
                        className="button button-secondary button-small"
                        type="button"
                        disabled={isBusy}
                        onClick={() => void runSessionCommand(`/knowledge ${entry.run_id}`, "Refreshing repository knowledge")}
                      >
                        Refresh in composer
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          ) : null}

          {activeTab === "meta" && selectedRun ? (
            <div className="meta-card">
              <article className="meta-row"><span>ID</span><strong>{selectedRun.id}</strong></article>
              <article className="meta-row"><span>Status</span><strong>{formatStatusLabel(selectedRun.status)}</strong></article>
              <article className="meta-row"><span>Objective</span><strong>{selectedRun.objectiveMetric}</strong></article>
              <article className="meta-row"><span>Constraints</span><strong>{selectedRun.constraints.join(", ") || "None"}</strong></article>
            </div>
          ) : null}

          {activeTab === "workspace" ? (
            <ConfigEditorForm
              className="meta-card"
              form={setupForm}
              options={configOptions}
              onChange={setSetupForm}
              onSubmit={submitSetup}
              disabled={isBusy}
              heading="Workspace settings"
              submitLabel="Save settings"
              apiKeyHelp="Leave API key fields blank to keep the current stored value."
            />
          ) : null}

          {activeTab === "doctor" ? (
            <div className="doctor-list">
              {doctorReadiness ? (
                <section className="subtle-card">
                  <p className="section-kicker">Readiness profile</p>
                  <div className="stat-grid">
                    <article className="stat-card">
                      <span className="stat-label">Backend</span>
                      <strong>{formatDoctorBackendSummary(doctorReadiness)}</strong>
                    </article>
                    <article className="stat-card">
                      <span className="stat-label">Runtime</span>
                      <strong>{formatDoctorRuntimeSummary(doctorReadiness)}</strong>
                    </article>
                    <article className="stat-card">
                      <span className="stat-label">Isolation</span>
                      <strong>{doctorReadiness.candidateIsolation || "not-configured"}</strong>
                    </article>
                    <article className="stat-card">
                      <span className="stat-label">Network</span>
                      <strong>{formatDoctorNetworkSummary(doctorReadiness)}</strong>
                    </article>
                  </div>
                </section>
              ) : null}
              {doctorChecks.length === 0 ? (
                <div className="inline-empty">Doctor checks will appear after bootstrap completes.</div>
              ) : (
                doctorChecks.map((check) => (
                  <article
                    key={check.name}
                    className={`doctor-item ${doctorCheckToneClass(check)}${isStrongRequiredNetworkWarning(check, doctorReadiness) ? " warning-strong" : ""}`}
                  >
                    <span className={`status-pill ${doctorCheckPillClass(check, doctorReadiness)}`}>{doctorCheckLabel(check, doctorReadiness)}</span>
                    <div>
                      <h4>{check.name}</h4>
                      <p>{check.detail}</p>
                      {isStrongRequiredNetworkWarning(check, doctorReadiness) ? (
                        <p className="doctor-emphasis">
                          Network is required for this run. Treat outputs as network-assisted and keep operator review in the loop.
                        </p>
                      ) : null}
                    </div>
                  </article>
                ))
              )}
              {doctorHarness ? (
                <article className={`doctor-item ${doctorHarness.status === "ok" ? "ok" : "fail"}`}>
                  <span
                    className={`status-pill ${doctorHarness.status === "ok" ? "is-success" : "is-danger"}`}
                  >
                    {doctorHarness.status === "ok" ? "OK" : "FAIL"}
                  </span>
                  <div>
                    <h4>harness-validation</h4>
                    <p>
                      {doctorHarness.findings.length} issue(s), {doctorHarness.runsChecked} run(s),
                      {" "}
                      {doctorHarness.runStoresChecked} run store(s) checked
                    </p>
                    {doctorHarness.findings.length > 0 ? (
                      <div className="doctor-harness-findings">
                        {doctorHarness.findings.slice(0, 5).map((finding, index) => (
                          <article key={`${finding.code}-${finding.runId || "na"}-${index}`} className="doctor-harness-finding">
                            <strong>{finding.kind}</strong>
                            <p>{finding.message}</p>
                            <p className="doctor-harness-meta">
                              {finding.runId ? `run: ${finding.runId}` : "run: n/a"}
                              {finding.filePath ? ` | file: ${finding.filePath}` : ""}
                            </p>
                            <p className="doctor-harness-remediation">Fix: {finding.remediation}</p>
                          </article>
                        ))}
                        {doctorHarness.findings.length > 5 ? (
                          <p className="doctor-harness-meta">
                            ... {doctorHarness.findings.length - 5} more harness finding(s)
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </article>
              ) : null}
            </div>
          ) : null}
        </div>

        <form className="composer composer-inline" onSubmit={submitComposer}>
          <div className="section-heading">
            <div>
              <p className="section-kicker">Command input</p>
              <h3>{activeTab === "logs" ? "Logs and input together" : "Run a command"}</h3>
            </div>
            <span className={`status-pill ${isBusy ? "is-active" : "is-neutral"}`}>
              {isBusy ? (
                <>
                  <span className="mini-spinner" aria-hidden="true" />
                  {activeBusyLabel || "Working..."}
                </>
              ) : (
                "Idle"
              )}
            </span>
          </div>
          <label className="field-label">
            Prompt
            <textarea
              value={commandInput}
              onChange={(event) => setCommandInput(event.target.value)}
              placeholder="collect 100 papers from the last 5 years by relevance"
              rows={3}
              disabled={isBusy}
            />
          </label>
          <div className="composer-actions">
            <button className="button button-primary" type="submit" disabled={isBusy}>
              {isBusy ? "Running..." : "Send"}
            </button>
            {session?.canCancel ? (
              <button className="button button-danger" type="button" onClick={() => void cancelActive()}>Cancel active task</button>
            ) : null}
          </div>
        </form>
      </aside>
    </div>
  );
}

interface ConfigEditorFormProps {
  className: string;
  form: SetupFormState;
  options: WebConfigOptions;
  onChange: Dispatch<SetStateAction<SetupFormState>>;
  onSubmit: (event: FormEvent) => Promise<void>;
  disabled?: boolean;
  heading: string;
  submitLabel: string;
  apiKeyHelp: string;
}

function ConfigEditorForm(props: ConfigEditorFormProps) {
  const isCodexMode = props.form.llmMode === "codex_chatgpt_only";
  const isOpenAiMode = props.form.llmMode === "openai_api";
  const isOllamaMode = props.form.llmMode === "ollama";

  return (
    <form className={props.className} onSubmit={props.onSubmit}>
      <div className="section-heading">
        <div>
          <p className="section-kicker">Workspace</p>
          <h2>{props.heading}</h2>
        </div>
      </div>

      <label>
        Project name
        <input disabled={props.disabled} value={props.form.projectName} onChange={(event) => patchSetupForm(props.onChange, { projectName: event.target.value })} />
      </label>
      <label>
        Default topic
        <input disabled={props.disabled} value={props.form.defaultTopic} onChange={(event) => patchSetupForm(props.onChange, { defaultTopic: event.target.value })} />
      </label>
      <label>
        Default constraints
        <input disabled={props.disabled} value={props.form.defaultConstraints} onChange={(event) => patchSetupForm(props.onChange, { defaultConstraints: event.target.value })} />
      </label>
      <label>
        Objective metric
        <input disabled={props.disabled} value={props.form.defaultObjectiveMetric} onChange={(event) => patchSetupForm(props.onChange, { defaultObjectiveMetric: event.target.value })} />
      </label>
      <p className="form-help">
        Workflow mode is fixed to Agent approval. Approval mode defaults to Minimal. Overnight is a separate
        autonomy preset, not a third workflow mode.
      </p>

      <div className="section-heading">
        <div>
          <p className="section-kicker">Execution policy</p>
          <h3>Experiment network policy</h3>
        </div>
      </div>
      <div className="inline-fields">
        <label>
          Network policy
          <select
            disabled={props.disabled}
            value={props.form.networkPolicy}
            onChange={(event) =>
              patchSetupForm(props.onChange, {
                networkPolicy: event.target.value as SetupFormState["networkPolicy"],
                networkPurpose: event.target.value === "blocked" ? "" : props.form.networkPurpose
              })
            }
          >
            <option value="blocked">Blocked (offline default)</option>
            <option value="declared">Declared dependency</option>
            <option value="required">Required dependency</option>
          </select>
        </label>
        <label>
          Network purpose
          <select
            disabled={props.disabled || props.form.networkPolicy === "blocked"}
            required={props.form.networkPolicy !== "blocked"}
            value={props.form.networkPurpose}
            onChange={(event) =>
              patchSetupForm(props.onChange, {
                networkPurpose: event.target.value as SetupFormState["networkPurpose"]
              })
            }
          >
            <option value="">Select a purpose</option>
            <option value="logging">Logging</option>
            <option value="artifact_upload">Artifact upload</option>
            <option value="model_download">Model download</option>
            <option value="dataset_fetch">Dataset fetch</option>
            <option value="remote_inference">Remote inference</option>
            <option value="other">Other</option>
          </select>
        </label>
      </div>
      <p className="form-help">
        Use Blocked for the offline default. Declared and Required runs keep network access auditable in `/doctor`
        and require manual or risk-ack execution modes rather than silent full-auto execution.
      </p>

      <div className="inline-fields">
        <label>
          Primary provider
          <select
            disabled={props.disabled}
            value={props.form.llmMode}
            onChange={(event) => patchSetupForm(props.onChange, { llmMode: event.target.value as SetupFormState["llmMode"] })}
          >
            <option value="codex_chatgpt_only">Codex ChatGPT (Default)</option>
            <option value="openai_api">OpenAI API</option>
            <option value="ollama">Ollama</option>
          </select>
        </label>
      </div>
      <p className="form-help">Only the selected provider's model slots are shown. PDF analysis backend follows that provider automatically.</p>

      <div className="section-heading">
        <div>
          <p className="section-kicker">Models</p>
          <h3>Model and reasoning by slot</h3>
        </div>
      </div>
      <p className="form-help">
        Pick the model and reasoning effort independently for chat, research, and experiment. PDF flows reuse the
        research backend model and reasoning automatically.
      </p>

      {isCodexMode ? (
        <>
          <ConfigModelSection
            title="Codex chat"
            description="General chat, titles, and lightweight interactive turns."
            disabled={props.disabled}
            modelValue={props.form.codexChatModelChoice}
            effortValue={props.form.codexChatReasoningEffort}
            modelOptions={props.options.codexModels}
            effortOptions={getEffortOptions(props.options.codexReasoningByModel, props.form.codexChatModelChoice)}
            onModelChange={(value) => updateModelAndEffort(props.onChange, "codexChatModelChoice", "codexChatReasoningEffort", value, props.options.codexReasoningByModel)}
            onEffortChange={(value) => patchSetupForm(props.onChange, { codexChatReasoningEffort: value })}
          />
          <ConfigModelSection
            title="Codex research backend"
            description={CODEX_TASK_MODEL_DESCRIPTION}
            disabled={props.disabled}
            modelValue={props.form.codexResearchBackendModelChoice}
            effortValue={props.form.codexResearchBackendReasoningEffort}
            modelOptions={props.options.codexModels}
            effortOptions={getEffortOptions(props.options.codexReasoningByModel, props.form.codexResearchBackendModelChoice)}
            onModelChange={(value) =>
              updateCodexResearchBackendModel(props.onChange, value, props.options.codexReasoningByModel)
            }
            onEffortChange={(value) => updateCodexResearchBackendEffort(props.onChange, value)}
          />
          <ConfigModelSection
            title="Codex experiment"
            description="Used when a real_execution runner needs model calls during experiment execution."
            disabled={props.disabled}
            modelValue={props.form.codexExperimentModelChoice}
            effortValue={props.form.codexExperimentReasoningEffort}
            modelOptions={props.options.codexModels}
            effortOptions={getEffortOptions(props.options.codexReasoningByModel, props.form.codexExperimentModelChoice)}
            onModelChange={(value) => updateModelAndEffort(props.onChange, "codexExperimentModelChoice", "codexExperimentReasoningEffort", value, props.options.codexReasoningByModel)}
            onEffortChange={(value) => patchSetupForm(props.onChange, { codexExperimentReasoningEffort: value })}
          />
        </>
      ) : null}

      {isOpenAiMode ? (
        <>
          <ConfigModelSection
            title="OpenAI chat"
            description="General chat model and reasoning for API mode."
            disabled={props.disabled}
            modelValue={props.form.openAiChatModel}
            effortValue={props.form.openAiChatReasoningEffort}
            modelOptions={props.options.openAiModels}
            effortOptions={getEffortOptions(props.options.openAiReasoningByModel, props.form.openAiChatModel)}
            onModelChange={(value) => updateModelAndEffort(props.onChange, "openAiChatModel", "openAiChatReasoningEffort", value, props.options.openAiReasoningByModel)}
            onEffortChange={(value) => patchSetupForm(props.onChange, { openAiChatReasoningEffort: value })}
          />
          <ConfigModelSection
            title="OpenAI research backend"
            description={OPENAI_TASK_MODEL_DESCRIPTION}
            disabled={props.disabled}
            modelValue={props.form.openAiResearchBackendModel}
            effortValue={props.form.openAiResearchBackendReasoningEffort}
            modelOptions={props.options.openAiModels}
            effortOptions={getEffortOptions(props.options.openAiReasoningByModel, props.form.openAiResearchBackendModel)}
            onModelChange={(value) =>
              updateOpenAiResearchBackendModel(props.onChange, value, props.options.openAiReasoningByModel)
            }
            onEffortChange={(value) => updateOpenAiResearchBackendEffort(props.onChange, value)}
          />
          <ConfigModelSection
            title="OpenAI experiment"
            description="Used when a real_execution runner should call the OpenAI API."
            disabled={props.disabled}
            modelValue={props.form.openAiExperimentModel}
            effortValue={props.form.openAiExperimentReasoningEffort}
            modelOptions={props.options.openAiModels}
            effortOptions={getEffortOptions(props.options.openAiReasoningByModel, props.form.openAiExperimentModel)}
            onModelChange={(value) => updateModelAndEffort(props.onChange, "openAiExperimentModel", "openAiExperimentReasoningEffort", value, props.options.openAiReasoningByModel)}
            onEffortChange={(value) => patchSetupForm(props.onChange, { openAiExperimentReasoningEffort: value })}
          />
        </>
      ) : null}

      {isOllamaMode ? (
        <>
          <label>
            Ollama base URL
            <input
              disabled={props.disabled}
              value={props.form.ollamaBaseUrl}
              onChange={(event) => patchSetupForm(props.onChange, { ollamaBaseUrl: event.target.value })}
            />
          </label>
          <p className="form-help">The web setup will use this local Ollama endpoint for chat, research backend, experiment, and vision flows.</p>
          <ConfigModelSection
            title="Ollama chat"
            description="Fast local chat model for interactive turns and lightweight assistance."
            disabled={props.disabled}
            modelValue={props.form.ollamaChatModel}
            modelOptions={props.options.ollamaChatModels}
            onModelChange={(value) => patchSetupForm(props.onChange, { ollamaChatModel: value })}
          />
          <ConfigModelSection
            title="Ollama research backend"
            description="Primary local model for research backend, analysis, and planning tasks."
            disabled={props.disabled}
            modelValue={props.form.ollamaResearchModel}
            modelOptions={props.options.ollamaResearchModels}
            onModelChange={(value) => patchSetupForm(props.onChange, { ollamaResearchModel: value })}
          />
          <ConfigModelSection
            title="Ollama experiment"
            description="Local model used for experiment implementation and code-oriented execution work."
            disabled={props.disabled}
            modelValue={props.form.ollamaExperimentModel}
            modelOptions={props.options.ollamaExperimentModels}
            onModelChange={(value) => patchSetupForm(props.onChange, { ollamaExperimentModel: value })}
          />
          <ConfigModelSection
            title="Ollama vision"
            description="Vision/PDF model used when the pipeline analyzes page images locally."
            disabled={props.disabled}
            modelValue={props.form.ollamaVisionModel}
            modelOptions={props.options.ollamaVisionModels}
            onModelChange={(value) => patchSetupForm(props.onChange, { ollamaVisionModel: value })}
          />
        </>
      ) : null}

      <label>
        Semantic Scholar API key
        <input disabled={props.disabled} type="password" value={props.form.semanticScholarApiKey} onChange={(event) => patchSetupForm(props.onChange, { semanticScholarApiKey: event.target.value })} />
      </label>
      {isOpenAiMode ? (
        <label>
          OpenAI API key
          <input disabled={props.disabled} type="password" value={props.form.openAiApiKey} onChange={(event) => patchSetupForm(props.onChange, { openAiApiKey: event.target.value })} />
        </label>
      ) : null}
      <p className="form-help">{props.apiKeyHelp}</p>

      <div className="form-actions">
        <button className="button button-primary" type="submit" disabled={props.disabled}>{props.disabled ? "Working..." : props.submitLabel}</button>
      </div>
    </form>
  );
}

interface ConfigModelSectionProps {
  title: string;
  description: string;
  disabled?: boolean;
  modelValue: string;
  modelOptions: string[];
  effortValue?: string;
  effortOptions?: string[];
  onModelChange: (value: string) => void;
  onEffortChange?: (value: string) => void;
}

function ConfigModelSection(props: ConfigModelSectionProps) {
  return (
    <section className="subtle-card config-section">
      <div className="config-section-copy">
        <h3>{props.title}</h3>
        <p>{props.description}</p>
      </div>
      <div className="inline-fields">
        <label>
          Model
          <select disabled={props.disabled} value={props.modelValue} onChange={(event) => props.onModelChange(event.target.value)}>
            {props.modelOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        {props.effortOptions && props.onEffortChange ? (
          <label>
            Reasoning effort
            <select disabled={props.disabled} value={props.effortValue} onChange={(event) => props.onEffortChange?.(event.target.value)}>
              {props.effortOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
    </section>
  );
}

function createEmptySetupForm(): SetupFormState {
  return {
    ...createDefaultConfigForm(),
    semanticScholarApiKey: "",
    openAiApiKey: ""
  };
}

function createSetupFormFromBootstrap(bootstrap: BootstrapResponse): SetupFormState {
  return {
    ...createDefaultConfigForm(),
    ...(bootstrap.configForm || {}),
    projectName: bootstrap.configForm?.projectName || bootstrap.setupDefaults.projectName,
    defaultTopic: bootstrap.configForm?.defaultTopic || bootstrap.setupDefaults.defaultTopic,
    defaultConstraints:
      bootstrap.configForm?.defaultConstraints || bootstrap.setupDefaults.defaultConstraints.join(", "),
    defaultObjectiveMetric:
      bootstrap.configForm?.defaultObjectiveMetric || bootstrap.setupDefaults.defaultObjectiveMetric,
    semanticScholarApiKey: "",
    openAiApiKey: ""
  };
}

function createDefaultConfigForm(): WebConfigFormData {
  return {
    projectName: "",
    defaultTopic: "",
    defaultConstraints: "",
    defaultObjectiveMetric: "",
    llmMode: "codex_chatgpt_only",
    codexChatModelChoice: "gpt-5.3-codex-spark",
    codexChatReasoningEffort: "medium",
    codexResearchBackendModelChoice: "gpt-5.3-codex",
    codexResearchBackendReasoningEffort: "xhigh",
    codexExperimentModelChoice: "gpt-5.3-codex",
    codexExperimentReasoningEffort: "xhigh",
    openAiChatModel: "gpt-5.4",
    openAiChatReasoningEffort: "low",
    openAiResearchBackendModel: "gpt-5.4",
    openAiResearchBackendReasoningEffort: "medium",
    openAiExperimentModel: "gpt-5.4",
    openAiExperimentReasoningEffort: "medium",
    ollamaBaseUrl: DEFAULT_OLLAMA_BASE_URL,
    ollamaChatModel: DEFAULT_OLLAMA_CHAT_MODEL,
    ollamaResearchModel: DEFAULT_OLLAMA_RESEARCH_MODEL,
    ollamaExperimentModel: DEFAULT_OLLAMA_EXPERIMENT_MODEL,
    ollamaVisionModel: DEFAULT_OLLAMA_VISION_MODEL,
    networkPolicy: "blocked",
    networkPurpose: ""
  };
}

function createDefaultConfigOptions(): WebConfigOptions {
  return {
    codexModels: [
      "gpt-5.4",
      "gpt-5.4 (fast)",
      "gpt-5.3-codex",
      "gpt-5.3-codex-spark",
      "gpt-5.2-codex",
      "gpt-5.2",
      "gpt-5.1-codex-max",
      "gpt-5.1",
      "gpt-5.1-codex",
      "gpt-5-codex",
      "gpt-5-codex-mini",
      "gpt-5"
    ],
    codexReasoningByModel: {
      "gpt-5.4": ["low", "medium", "high", "xhigh"],
      "gpt-5.4 (fast)": ["low", "medium", "high", "xhigh"],
      "gpt-5.3-codex": ["low", "medium", "high", "xhigh"],
      "gpt-5.3-codex-spark": ["low", "medium", "high"],
      "gpt-5.2-codex": ["low", "medium", "high", "xhigh"],
      "gpt-5.2": ["low", "medium", "high"],
      "gpt-5.1-codex-max": ["low", "medium", "high"],
      "gpt-5.1": ["low", "medium", "high"],
      "gpt-5.1-codex": ["low", "medium", "high", "xhigh"],
      "gpt-5-codex": ["low", "medium", "high"],
      "gpt-5-codex-mini": ["low", "medium", "high"],
      "gpt-5": ["minimal", "low", "medium", "high"]
    },
    openAiModels: ["gpt-5.4", "gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4o", "gpt-4o-mini"],
    openAiReasoningByModel: {
      "gpt-5.4": ["minimal", "low", "medium", "high", "xhigh"],
      "gpt-5": ["minimal", "low", "medium", "high", "xhigh"],
      "gpt-5-mini": ["minimal", "low", "medium", "high", "xhigh"],
      "gpt-4.1": ["medium"],
      "gpt-4o": ["medium"],
      "gpt-4o-mini": ["medium"]
    },
    ollamaChatModels: buildOllamaChatModelChoices(),
    ollamaResearchModels: buildOllamaResearchModelChoices(),
    ollamaExperimentModels: buildOllamaExperimentModelChoices(),
    ollamaVisionModels: buildOllamaVisionModelChoices()
  };
}

function patchSetupForm(
  setter: Dispatch<SetStateAction<SetupFormState>>,
  patch: Partial<SetupFormState>
) {
  setter((current) => ({ ...current, ...patch }));
}

function updateModelAndEffort(
  setter: Dispatch<SetStateAction<SetupFormState>>,
  modelKey: keyof SetupFormState,
  effortKey: keyof SetupFormState,
  nextModel: string,
  optionsByModel: Record<string, string[]>
) {
  setter((current) => {
    const effortOptions = getEffortOptions(optionsByModel, nextModel);
    const currentEffort = String(current[effortKey] || "");
    return {
      ...current,
      [modelKey]: nextModel,
      [effortKey]: effortOptions.includes(currentEffort) ? currentEffort : effortOptions[0]
    };
  });
}

function updateCodexResearchBackendModel(
  setter: Dispatch<SetStateAction<SetupFormState>>,
  nextModel: string,
  optionsByModel: Record<string, string[]>
) {
  setter((current) => {
    const effortOptions = getEffortOptions(optionsByModel, nextModel);
    const currentResearchBackendEffort = String(current.codexResearchBackendReasoningEffort || "");
    const nextResearchBackendEffort = effortOptions.includes(currentResearchBackendEffort)
      ? currentResearchBackendEffort
      : effortOptions[0];
    return {
      ...current,
      codexResearchBackendModelChoice: nextModel,
      codexResearchBackendReasoningEffort: nextResearchBackendEffort
    };
  });
}

function updateCodexResearchBackendEffort(
  setter: Dispatch<SetStateAction<SetupFormState>>,
  nextEffort: string
) {
  setter((current) => ({
    ...current,
    codexResearchBackendReasoningEffort: nextEffort
  }));
}

function updateOpenAiResearchBackendModel(
  setter: Dispatch<SetStateAction<SetupFormState>>,
  nextModel: string,
  optionsByModel: Record<string, string[]>
) {
  setter((current) => {
    const effortOptions = getEffortOptions(optionsByModel, nextModel);
    const currentResearchBackendEffort = String(current.openAiResearchBackendReasoningEffort || "");
    const nextResearchBackendEffort = effortOptions.includes(currentResearchBackendEffort)
      ? currentResearchBackendEffort
      : effortOptions[0];
    return {
      ...current,
      openAiResearchBackendModel: nextModel,
      openAiResearchBackendReasoningEffort: nextResearchBackendEffort
    };
  });
}

function updateOpenAiResearchBackendEffort(
  setter: Dispatch<SetStateAction<SetupFormState>>,
  nextEffort: string
) {
  setter((current) => ({
    ...current,
    openAiResearchBackendReasoningEffort: nextEffort
  }));
}

function getEffortOptions(optionsByModel: Record<string, string[]>, model: string): string[] {
  return optionsByModel[model] || ["medium"];
}

function normalizeDoctorCheckStatus(check: DoctorCheck): "ok" | "warning" | "fail" {
  if (check.status === "warn") {
    return "warning";
  }
  return check.status || (check.ok ? "ok" : "fail");
}

function doctorCheckLabel(
  check: DoctorCheck,
  readiness?: DoctorResponse["readiness"] | null
): "OK" | "WARN" | "FAIL" | "REQUIRED" {
  if (isStrongRequiredNetworkWarning(check, readiness)) {
    return "REQUIRED";
  }
  const status = normalizeDoctorCheckStatus(check);
  if (status === "warning") {
    return "WARN";
  }
  return status === "fail" ? "FAIL" : "OK";
}

function doctorCheckPillClass(
  check: DoctorCheck,
  readiness?: DoctorResponse["readiness"] | null
): "is-success" | "is-warning" | "is-warning-strong" | "is-danger" {
  if (isStrongRequiredNetworkWarning(check, readiness)) {
    return "is-warning-strong";
  }
  const status = normalizeDoctorCheckStatus(check);
  if (status === "warning") {
    return "is-warning";
  }
  return status === "fail" ? "is-danger" : "is-success";
}

function doctorCheckToneClass(check: DoctorCheck): "ok" | "warning" | "fail" {
  const status = normalizeDoctorCheckStatus(check);
  if (status === "warning") {
    return "warning";
  }
  return status === "fail" ? "fail" : "ok";
}

function isStrongRequiredNetworkWarning(
  check: DoctorCheck,
  readiness?: DoctorResponse["readiness"] | null
): boolean {
  return (
    check.name === "experiment-web-restriction"
    && normalizeDoctorCheckStatus(check) === "warning"
    && readiness?.networkPolicy === "required"
  );
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json"
    },
    ...init
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

function summarizeCommand(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "command";
  }
  return normalized.length <= 52 ? normalized : `${normalized.slice(0, 49)}...`;
}

function labelPendingPlanAction(action: "next" | "all" | "cancel"): string {
  switch (action) {
    case "next":
      return "Running the next pending step";
    case "all":
      return "Running the full pending plan";
    case "cancel":
      return "Canceling the pending plan";
  }
}

function parseReviewPacketPreview(raw: string): ReviewPacketPreview | null {
  if (!raw.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const checks = Array.isArray(parsed.checks)
      ? parsed.checks
          .map((item, index) => normalizeReviewCheckPreview(item, index))
          .filter((item): item is ReviewPacketPreview["checks"][number] => Boolean(item))
      : [];
    const readiness = summarizeReviewPreviewReadiness(checks);
    const recommendation = normalizeReviewRecommendationPreview(parsed.recommendation);

    return {
      generated_at: typeof parsed.generated_at === "string" ? parsed.generated_at : "",
      readiness: normalizeReviewReadinessPreview(parsed.readiness, readiness),
      objective_status: typeof parsed.objective_status === "string" ? parsed.objective_status : "unknown",
      objective_summary:
        typeof parsed.objective_summary === "string"
          ? parsed.objective_summary
          : "No structured objective summary was available.",
      recommendation,
      checks,
      suggested_actions: Array.isArray(parsed.suggested_actions)
        ? parsed.suggested_actions.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : []
    };
  } catch {
    return null;
  }
}

function summarizeReviewPreviewReadiness(
  checks: Array<{ status: ReviewPreviewStatus }>
): ReviewPacketPreview["readiness"] {
  let readyChecks = 0;
  let warningChecks = 0;
  let blockingChecks = 0;
  let manualChecks = 0;

  for (const check of checks) {
    switch (check.status) {
      case "ready":
        readyChecks += 1;
        break;
      case "warning":
        warningChecks += 1;
        break;
      case "blocking":
        blockingChecks += 1;
        break;
      case "manual":
        manualChecks += 1;
        break;
    }
  }

  return {
    status: blockingChecks > 0 ? "blocking" : warningChecks > 0 ? "warning" : "ready",
    ready_checks: readyChecks,
    warning_checks: warningChecks,
    blocking_checks: blockingChecks,
    manual_checks: manualChecks
  };
}

function normalizeReviewCheckPreview(
  value: unknown,
  index: number
): ReviewPacketPreview["checks"][number] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return {
    id: typeof record.id === "string" ? record.id : `check_${index + 1}`,
    label: typeof record.label === "string" ? record.label : `Check ${index + 1}`,
    status: normalizeReviewStatusPreview(record.status),
    detail: typeof record.detail === "string" ? record.detail : ""
  };
}

function normalizeReviewRecommendationPreview(
  value: unknown
): ReviewPacketPreview["recommendation"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.action !== "string" || typeof record.reason !== "string") {
    return undefined;
  }
  return {
    action: record.action,
    target: typeof record.target === "string" ? record.target : undefined,
    confidence_pct: typeof record.confidence_pct === "number" ? record.confidence_pct : 0,
    reason: record.reason,
    evidence: Array.isArray(record.evidence)
      ? record.evidence.filter((item): item is string => typeof item === "string").slice(0, 3)
      : []
  };
}

function normalizeReviewReadinessPreview(
  value: unknown,
  fallback: ReviewPacketPreview["readiness"]
): ReviewPacketPreview["readiness"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }
  const record = value as Record<string, unknown>;
  const status = record.status;
  return {
    status: status === "ready" || status === "warning" || status === "blocking" ? status : fallback.status,
    ready_checks: typeof record.ready_checks === "number" ? record.ready_checks : fallback.ready_checks,
    warning_checks: typeof record.warning_checks === "number" ? record.warning_checks : fallback.warning_checks,
    blocking_checks: typeof record.blocking_checks === "number" ? record.blocking_checks : fallback.blocking_checks,
    manual_checks: typeof record.manual_checks === "number" ? record.manual_checks : fallback.manual_checks
  };
}

function normalizeReviewStatusPreview(value: unknown): ReviewPreviewStatus {
  switch (value) {
    case "ready":
    case "warning":
    case "blocking":
    case "manual":
      return value;
    default:
      return "manual";
  }
}

function reviewStatusToneClass(status: ReviewPreviewStatus | Exclude<ReviewPreviewStatus, "manual">): string {
  switch (status) {
    case "ready":
      return "is-success";
    case "blocking":
      return "is-danger";
    case "warning":
      return "is-warning";
    default:
      return "is-neutral";
  }
}

function labelReviewAction(command: string): string {
  switch (command) {
    case "/approve":
      return "Approve review";
    case "/agent run write_paper":
      return "Run write_paper";
    case "/agent review":
      return "Refresh review";
    case "/agent apply":
      return "Apply transition";
    case "/agent transition":
      return "Show transition";
    case "/agent jump analyze_results":
    case "/agent jump analyze_results --force":
      return "Jump analyze_results";
    case "/agent jump generate_hypotheses --force":
      return "Jump generate_hypotheses";
    case "/agent jump design_experiments --force":
      return "Jump design_experiments";
    case "/agent jump implement_experiments --force":
      return "Jump implement_experiments";
    default:
      return command.replace(/^\//, "");
  }
}

function formatNodeLabel(value: string): string {
  return toHeadline(value.replace(/_/g, " "));
}

function formatStatusLabel(value: string): string {
  return toHeadline(value.replace(/_/g, " "));
}

function labelProviderMode(value: ConfigSummary["llmMode"] | undefined): string {
  return value === "openai_api" ? "Provider: OpenAI API" : "Provider: Codex ChatGPT";
}

function labelPdfMode(value: ConfigSummary["pdfMode"] | undefined): string {
  return value === "responses_api_pdf" ? "PDF: Responses API PDF" : "PDF: Codex text + image hybrid";
}

function labelWorkflowMode(value: ConfigSummary["workflowMode"] | undefined): string {
  return value === "agent_approval" ? "Workflow: Agent approval" : "Workflow: Agent approval";
}

function labelApprovalMode(value: ConfigSummary["approvalMode"] | undefined): string {
  return value === "manual" ? "Approval: Manual" : "Approval: Minimal";
}

function formatRunRecommendedAction(
  value: "inspect_blocker" | "resume_review" | "rerun_after_fix" | "waiting_for_input" | "completed"
): string {
  switch (value) {
    case "inspect_blocker":
      return "Inspect blocker";
    case "resume_review":
      return "Resume review";
    case "rerun_after_fix":
      return "Rerun after fix";
    case "waiting_for_input":
      return "Waiting for input";
    case "completed":
      return "Completed";
  }
}

function formatReadinessTriple(input: {
  analysis_ready: boolean;
  review_ready: boolean;
  paper_ready: boolean;
}): string {
  return `${input.analysis_ready ? "yes" : "no"}/${input.review_ready ? "yes" : "no"}/${input.paper_ready ? "yes" : "no"}`;
}

function formatReviewGateStatus(
  status: NonNullable<RunJobProjection["review_gate_status"]>,
  decision?: string,
  transition?: string
): string {
  if (decision) {
    return transition ? `${decision} -> ${transition}` : decision;
  }
  switch (status) {
    case "ready":
      return "Ready";
    case "warning":
      return "Warning";
    case "blocking":
      return "Blocking";
    case "missing":
      return "Missing";
  }
}

function formatDoctorBackendSummary(readiness: NonNullable<DoctorResponse["readiness"]>): string {
  const llm = readiness.llmMode || "unknown";
  const pdf = readiness.pdfAnalysisMode || "unknown";
  return `${llm} / ${pdf}`;
}

function formatDoctorRuntimeSummary(readiness: NonNullable<DoctorResponse["readiness"]>): string {
  return `${readiness.dependencyMode} · ${readiness.sessionMode} · ${readiness.executionApprovalMode}`;
}

function formatDoctorNetworkSummary(readiness: NonNullable<DoctorResponse["readiness"]>): string {
  if (readiness.networkPolicy === "blocked") {
    return "offline";
  }
  if (!readiness.networkDeclarationPresent) {
    return "undeclared-enabled";
  }
  return readiness.networkPurpose
    ? `${readiness.networkPolicy}:${readiness.networkPurpose}`
    : (readiness.networkPolicy || "undeclared-enabled");
}

function labelArtifactKind(value: ArtifactEntry["kind"]): string {
  switch (value) {
    case "json":
      return "JSON";
    case "pdf":
      return "PDF";
    default:
      return toHeadline(value);
  }
}

function buildFallbackArtifactEntry(path: string): ArtifactEntry {
  const lower = path.toLowerCase();
  const kind: ArtifactEntry["kind"] =
    lower.endsWith(".json") || lower.endsWith(".jsonl")
      ? "json"
      : lower.endsWith(".yaml") ||
          lower.endsWith(".yml") ||
          lower.endsWith(".txt") ||
          lower.endsWith(".tex") ||
          lower.endsWith(".bib") ||
          lower.endsWith(".md") ||
          lower.endsWith(".log") ||
          lower.endsWith(".py")
        ? "text"
        : lower.endsWith(".png") ||
            lower.endsWith(".jpg") ||
            lower.endsWith(".jpeg") ||
            lower.endsWith(".gif") ||
            lower.endsWith(".webp") ||
            lower.endsWith(".svg")
          ? "image"
          : lower.endsWith(".pdf")
            ? "pdf"
            : "download";

  return {
    path,
    kind,
    size: 0,
    modifiedAt: "",
    previewable: kind !== "download"
  };
}

function labelInsightReferenceKind(
  kind: "figure" | "comparison" | "statistics" | "transition" | "report" | "metrics"
): string {
  return toHeadline(kind);
}

function buildInsightReferenceKey(reference: NonNullable<RunInsightCard["references"]>[number]): string {
  return `${reference.kind}:${reference.label}:${reference.path}`;
}

function statusToneClass(status?: string): string {
  switch (status) {
    case "needs_approval":
      return "is-warning";
    case "completed":
      return "is-success";
    case "running":
    case "active":
      return "is-active";
    case "failed":
      return "is-danger";
    case "paused":
    case "pending":
      return "is-neutral";
    default:
      return "is-neutral";
  }
}

function manuscriptQualityStatusToneClass(
  status: NonNullable<RunInsightCard["manuscriptQuality"]>["status"]
): string {
  switch (status) {
    case "pass":
      return "is-success";
    case "repairing":
      return "is-warning";
    case "stopped":
      return "is-danger";
  }
}

function formatManuscriptQualityStatus(
  status: NonNullable<RunInsightCard["manuscriptQuality"]>["status"]
): string {
  switch (status) {
    case "pass":
      return "Pass";
    case "repairing":
      return "Repairing";
    case "stopped":
      return "Stopped";
  }
}

function formatManuscriptQualityStage(
  stage: NonNullable<RunInsightCard["manuscriptQuality"]>["stage"]
): string {
  switch (stage) {
    case "initial_gate":
      return "Initial gate";
    case "post_repair_1":
      return "After repair 1";
    case "post_repair_2":
      return "After repair 2";
  }
}

function formatManuscriptQualityReason(
  reason: NonNullable<RunInsightCard["manuscriptQuality"]>["reasonCategory"]
): string {
  return toHeadline(reason.replace(/_/g, " "));
}

function formatManuscriptQualityReliability(
  reliability: NonNullable<RunInsightCard["manuscriptQuality"]>["reviewReliability"]
): string {
  return toHeadline(reliability.replace(/_/g, " "));
}

function buildManuscriptQualityGroupCards(
  insight: NonNullable<RunInsightCard["manuscriptQuality"]>
): Array<{
  key: string;
  label: string;
  toneClass: string;
  items: Array<{
    code: string;
    section: string;
    severity: "warning" | "fail";
    message: string;
  }>;
}> {
  const groups = [
    {
      key: "manuscript",
      label: "Repairable manuscript issues",
      toneClass: "is-warning",
      items: insight.issueGroups.manuscript
    },
    {
      key: "hard-stop",
      label: "Hard-stop policy findings",
      toneClass: "is-danger",
      items: insight.issueGroups.hardStopPolicy
    },
    {
      key: "backstop",
      label: "Backstop-only findings",
      toneClass: "is-neutral",
      items: insight.issueGroups.backstopOnly
    },
    {
      key: "readiness",
      label: "Paper readiness risks",
      toneClass: (insight.issueGroups.readiness || []).some((item) => item.severity === "fail")
        ? "is-danger"
        : "is-warning",
      items: insight.issueGroups.readiness || []
    },
    {
      key: "scientific",
      label: "Scientific blockers",
      toneClass: "is-danger",
      items: insight.issueGroups.scientific
    },
    {
      key: "submission",
      label: "Submission blockers",
      toneClass: "is-danger",
      items: insight.issueGroups.submission
    }
  ];

  return groups.filter((group) => group.items.length > 0);
}

function buildReadinessRiskGroupCards(
  insight: NonNullable<RunInsightCard["readinessRisks"]>
): Array<{
  key: string;
  label: string;
  toneClass: string;
  items: typeof insight.risks;
}> {
  return [
    {
      key: "readiness",
      label: "Paper readiness risks",
      toneClass: insight.risks.some((item) => item.severity === "fail") ? "is-danger" : "is-warning",
      items: insight.risks
    }
  ].filter((group) => group.items.length > 0);
}

function formatTimestamp(value?: string): string {
  if (!value) {
    return "No timestamp";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** exponent;
  return `${amount >= 10 || exponent === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[exponent]}`;
}

function toHeadline(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
