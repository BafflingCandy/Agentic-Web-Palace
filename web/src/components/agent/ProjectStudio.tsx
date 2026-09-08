"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { API_URL, api } from "@/lib/agentApi";

type Provider = { id: string; label: string; configured: boolean; environment_variable: string };
type Role = "architect" | "builder" | "reviewer";
type RoleModel = { provider: string; model: string; max_tokens: string; input: string; cached: string; output: string };
type RunState = {
  run_id?: string; stage?: string; status?: string; message?: string; model_calls?: number;
  total_tokens?: number; estimated_cost_usd?: number;
  build_result?: { implementation_summary: string; changes: { relative_path: string }[]; commands_requested: string[] };
};
type ExecutionMode = "approval" | "automatic";

const blankModel = (): RoleModel => ({ provider: "openai", model: "", max_tokens: "", input: "", cached: "", output: "" });
const roles: Role[] = ["architect", "builder", "reviewer"];
const safeVerificationCommands = ["npm.cmd test", "npm.cmd run build"];

export function ProjectStudio() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [sameModel, setSameModel] = useState(true);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("approval");
  const [models, setModels] = useState<Record<Role, RoleModel>>({ architect: blankModel(), builder: blankModel(), reviewer: blankModel() });
  const [projectId, setProjectId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<RunState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [projectDetails, setProjectDetails] = useState({ title: "", subject: "", objective: "" });
  const registeredRuns = useRef(new Set<string>());

  const registerAcceptedPalace = useCallback(async (next: RunState) => {
    if (!projectId || !next.run_id || registeredRuns.current.has(next.run_id)) return;
    registeredRuns.current.add(next.run_id);
    try {
      await fetchChecked("/api/register-generated", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: projectId, run_id: next.run_id, title: projectDetails.title, subject: projectDetails.subject, summary: next.message || projectDetails.objective }) }, "same-origin");
    } catch (reason) {
      registeredRuns.current.delete(next.run_id);
      setError(reason instanceof Error ? `Website accepted, but brain registration failed: ${reason.message}` : "Website accepted, but brain registration failed.");
    }
  }, [projectId, projectDetails]);

  useEffect(() => {
    api<Provider[]>("/api/providers").then(setProviders).catch((reason) => setError(reason.message));
  }, []);

  useEffect(() => {
    if (!runId) return;
    const events = new EventSource(`${API_URL}/api/runs/${runId}/events`);
    events.addEventListener("state", (event) => {
      const next = JSON.parse((event as MessageEvent).data) as RunState;
      setRun(next);
      if (["ACCEPTED", "ACCEPTED_WITH_NOTES", "APPROVAL_REQUIRED", "NEEDS_HUMAN_INPUT", "ITERATION_LIMIT_REACHED", "MODEL_CALL_LIMIT_REACHED", "COST_LIMIT_REACHED", "WORKFLOW_FAILED"].includes(next.status ?? "")) {
        events.close(); setBusy(false); if ((next.status ?? "").startsWith("ACCEPTED")) void registerAcceptedPalace(next);
      }
    });
    events.onerror = () => { events.close(); setBusy(false); };
    return () => events.close();
  }, [runId, registerAcceptedPalace]);

  const configured = useMemo(() => new Map(providers.map((item) => [item.id, item.configured])), [providers]);

  function updateModel(role: Role, field: keyof RoleModel, value: string) {
    setModels((current) => ({ ...current, [role]: { ...current[role], [field]: value } }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setRun(null); setRunId(null);
    const data = new FormData(event.currentTarget);
    const selected = sameModel ? { architect: models.architect, builder: models.architect, reviewer: models.architect } : models;
    const rolePayload = Object.fromEntries(roles.map((role) => [role, modelPayload(selected[role])])) as Record<Role, object>;
    const budget = String(data.get("budget") ?? "").trim();
    const imageEnabled = data.get("image_generation") === "on";
    setProjectDetails({ title: String(data.get("project_name")), subject: String(data.get("subject")), objective: String(data.get("objective")) });
    try {
      const project = await api<{ id: string }>("/api/projects", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_name: data.get("project_name"), subject: data.get("subject"), audience: data.get("audience"),
          objective: data.get("objective"), requirements: data.get("requirements"), models: rolePayload,
          image_generation: { enabled: imageEnabled, provider: imageEnabled ? data.get("image_provider") : null, model: imageEnabled ? data.get("image_model") : null, maximum_images: Number(data.get("maximum_images") || 6), require_approval: executionMode === "approval", estimated_cost_per_image: imageEnabled && data.get("image_cost") ? Number(data.get("image_cost")) : null },
          maximum_build_iterations: Number(data.get("build_iterations")), maximum_architecture_revisions: Number(data.get("architecture_revisions")),
          maximum_model_calls: Number(data.get("model_calls")), maximum_estimated_cost_usd: budget ? Number(budget) : null,
          require_build_approval: executionMode === "approval",
          allowed_commands: safeVerificationCommands
        })
      });
      setProjectId(project.id);
      for (const file of files) { const upload = new FormData(); upload.append("file", file); await fetchChecked(`/api/projects/${project.id}/sources`, { method: "POST", body: upload }); }
      const started = await api<{ run_id: string }>(`/api/projects/${project.id}/runs`, { method: "POST" });
      setRunId(started.run_id); setRun({ run_id: started.run_id, stage: "ARCHITECT", status: "STARTING", message: "The Architect is reading the brief and sources." });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to start the workflow"); setBusy(false); }
  }

  async function resume(decision: "approve" | "revise" | "reject") {
    if (!projectId || !runId) return;
    setBusy(true); setError("");
    try {
      await api(`/api/projects/${projectId}/runs/${runId}/resume`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, feedback }) });
      setRunId(null); window.setTimeout(() => setRunId(runId), 0); setRun((current) => ({ ...current, status: "RESUMING", message: "Resuming from the saved checkpoint." }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to resume"); setBusy(false); }
  }

  return (
    <main className="studio">
      <header className="studio-nav"><Link href="/?skipIntro=1" className="wordmark"><i /> Web Palace</Link><nav><a href="#create">Create</a><Link href="/?skipIntro=1">Brain</Link></nav></header>
      <section className="studio-hero"><p className="kicker">Create a teaching website</p><h1>Create a new<br/><em>Web Palace.</em></h1><p>Describe what the website should teach, add any source material, and choose the model you want to use.</p></section>
      <section className="workspace-grid" id="create">
        <form className="composer" onSubmit={submit}>
          <header><span>01</span><div><p className="kicker">Project intake</p><h2>What should this website teach?</h2></div></header>
          <label>Project name<input name="project_name" required minLength={2} placeholder="Networking foundations" /></label>
          <label>Subject<input name="subject" required placeholder="Computer networking" /></label>
          <div className="field-pair"><label>Audience<textarea name="audience" required rows={2} placeholder="What does the learner already know?" /></label><label>Final capability<textarea name="objective" required rows={2} placeholder="What should they understand or perform?" /></label></div>
          <label>Your complete brief<textarea className="brief" name="requirements" required minLength={10} rows={7} placeholder="Describe the routes, tone, examples, visual direction, constraints, and anything the agents must preserve..." /></label>
          <label className="upload-zone">Source files <span>TXT, Markdown, PDF, or DOCX · 20 MB each</span><input type="file" multiple accept=".txt,.md,.pdf,.docx" onChange={(event) => setFiles(Array.from(event.target.files ?? []))}/><small>{files.length ? files.map((file) => file.name).join(" · ") : "Choose files or continue without sources"}</small></label>
          <details><summary>Models and provider readiness</summary><div className="details-body">
            <div className="provider-strip">{providers.map((provider) => <span key={provider.id} className={provider.configured ? "connected" : "missing"}><i />{provider.label}<small>{provider.configured ? "ready" : provider.environment_variable}</small></span>)}</div>
            <label className="check"><input type="checkbox" checked={sameModel} onChange={(event) => setSameModel(event.target.checked)}/> Use one model for every role</label>
            {(sameModel ? ["architect" as Role] : roles).map((role) => <ModelRow key={role} role={role} value={models[role]} update={updateModel} configured={configured}/>) }
          </div></details>
          <details><summary>Images, safety, and budget</summary><div className="details-body">
            <fieldset className="execution-mode"><legend>Before files are created</legend>
              <label className={executionMode === "approval" ? "selected" : ""}><input type="radio" name="execution_mode" value="approval" checked={executionMode === "approval"} onChange={() => setExecutionMode("approval")}/><span><strong>Require approval</strong><small>Pause so you can review the proposed files and checks.</small></span></label>
              <label className={executionMode === "automatic" ? "selected" : ""}><input type="radio" name="execution_mode" value="automatic" checked={executionMode === "automatic"} onChange={() => setExecutionMode("automatic")}/><span><strong>Run automatically</strong><small>Continue inside the project and run the built-in test and build checks.</small></span></label>
            </fieldset>
            <label className="check"><input name="image_generation" type="checkbox"/> Allow the architecture to require generated imagery</label>
            <div className="field-pair"><label>Image provider<select name="image_provider" defaultValue="openai"><option value="openai">OpenAI</option></select></label><label>Image model<input name="image_model" placeholder="Provider image model" /></label></div>
            <div className="field-pair"><label>Maximum images<input name="maximum_images" type="number" min="1" max="20" defaultValue="6" /></label><label>Estimated cost per image<input name="image_cost" type="number" min="0" step="0.001" placeholder="Required with budget" /></label></div>
            <div className="limit-grid"><label>Builds<input name="build_iterations" type="number" min="1" max="10" defaultValue="2" /></label><label>Redesigns<input name="architecture_revisions" type="number" min="0" max="5" defaultValue="1" /></label><label>Model calls<input name="model_calls" type="number" min="3" max="100" defaultValue="8" /></label><label>Budget USD<input name="budget" type="number" min="0.01" step="0.01" placeholder="Optional" /></label></div>
          </div></details>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="primary" disabled={busy}>{busy ? "Workflow running…" : "Create Web Palace"}<span>→</span></button>
        </form>
        {run?.status === "APPROVAL_REQUIRED" && run.build_result ? <aside className="run-panel"><Approval proposal={run.build_result} feedback={feedback} setFeedback={setFeedback} resume={resume}/></aside> : null}
      </section>
      <footer><span>Web Palace</span><Link href="/?skipIntro=1">Return to the brain</Link></footer>
      {busy && run?.status !== "APPROVAL_REQUIRED" ? <CreationOverlay state={run}/> : null}
    </main>
  );
}

function ModelRow({ role, value, update, configured }: { role: Role; value: RoleModel; update: (role: Role, field: keyof RoleModel, value: string) => void; configured: Map<string, boolean> }) {
  return <fieldset className="model-row"><legend>{role}</legend><select value={value.provider} onChange={(e) => update(role,"provider",e.target.value)}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="deepseek">DeepSeek</option></select><input aria-label={`${role} model`} required placeholder="Exact model name" value={value.model} onChange={(e) => update(role,"model",e.target.value)}/><input aria-label={`${role} max tokens`} type="number" placeholder="Max output" value={value.max_tokens} onChange={(e) => update(role,"max_tokens",e.target.value)}/><span className={configured.get(value.provider) ? "ready" : "not-ready"}>{configured.get(value.provider) ? "Key ready" : "Key missing"}</span><div className="price-row"><input aria-label={`${role} input price`} type="number" step="0.0001" placeholder="Input $/1M" value={value.input} onChange={(e) => update(role,"input",e.target.value)}/><input aria-label={`${role} cached price`} type="number" step="0.0001" placeholder="Cached $/1M" value={value.cached} onChange={(e) => update(role,"cached",e.target.value)}/><input aria-label={`${role} output price`} type="number" step="0.0001" placeholder="Output $/1M" value={value.output} onChange={(e) => update(role,"output",e.target.value)}/></div></fieldset>;
}

function modelPayload(value: RoleModel) { const number = (input: string) => input ? Number(input) : null; return { provider: value.provider, model: value.model, max_tokens: number(value.max_tokens), input_cost_per_million: number(value.input), cached_input_cost_per_million: number(value.cached), output_cost_per_million: number(value.output) }; }

function Approval({ proposal, feedback, setFeedback, resume }: { proposal: NonNullable<RunState["build_result"]>; feedback: string; setFeedback: (value: string) => void; resume: (decision: "approve"|"revise"|"reject") => void }) {
  return <section className="approval"><p className="kicker">Human gate</p><h3>Builder is waiting.</h3><p>{proposal.implementation_summary}</p><div className="proposal-list"><small>Files</small>{proposal.changes.map((item) => <code key={item.relative_path}>{item.relative_path}</code>)}<small>Commands</small>{proposal.commands_requested.length ? proposal.commands_requested.map((command) => <code key={command}>{command}</code>) : <span>None</span>}</div><label>Direction<textarea rows={3} value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Required when asking for changes"/></label><div className="approval-actions"><button onClick={() => resume("approve")}>Approve</button><button onClick={() => resume("revise")}>Revise</button><button className="danger" onClick={() => resume("reject")}>Reject</button></div></section>;
}

async function fetchChecked(path: string, init: RequestInit, target: "agent"|"same-origin" = "agent") { const response = await fetch(`${target === "agent" ? API_URL : ""}${path}`, init); if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.detail ?? body.message ?? response.statusText); } return response; }

function CreationOverlay({ state }: { state: RunState | null }) {
  const stage = state?.stage?.replaceAll("_", " ") ?? "PREPARING";
  return <section className="creation-overlay" role="status" aria-live="polite" aria-label="Website creation in progress"><div className="creation-orbit" aria-hidden="true"><i/><i/><i/><i/><span/></div><p>Creating your Web Palace</p><h2>{stage}</h2><small>{state?.message ?? "Preparing your prompt and source material."}</small><div className="creation-progress" aria-hidden="true"><span/></div></section>;
}
