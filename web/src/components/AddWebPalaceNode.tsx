"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { LoaderCircle, Plus, X } from "lucide-react";
import Link from "next/link";
import {
  addWebPalaceNode,
  type AddNodeActionState
} from "@/app/actions/addWebPalaceNode";
import {
  removeWebPalaceNode,
  type RemoveNodeActionState
} from "@/app/actions/removeWebPalaceNode";
import { webPalaces } from "@/data/webPalaces";

const initialAddNodeState: AddNodeActionState = {
  status: "idle",
  message: ""
};

const initialRemoveNodeState: RemoveNodeActionState = {
  status: "idle",
  message: ""
};

function SubmitButton({ pending }: { pending: boolean }) {
  return (
    <button className="add-node-submit" type="submit" disabled={pending}>
      {pending ? (
        <>
          <LoaderCircle aria-hidden="true" size={16} className="add-node-spinner" />
          Adding
        </>
      ) : (
        "Add to brain"
      )}
    </button>
  );
}

export function AddWebPalaceNode() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [removePending, setRemovePending] = useState(false);
  const [managedPalaces, setManagedPalaces] = useState(() => [...webPalaces]);
  const [selectedId, setSelectedId] = useState(webPalaces[0]?.id ?? "");
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [state, action] = useActionState(addWebPalaceNode, initialAddNodeState);
  const [removeState, removeAction] = useActionState(
    removeWebPalaceNode,
    initialRemoveNodeState
  );
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const wasOpenRef = useRef(false);
  const selectedPalace = managedPalaces.find((palace) => palace.id === selectedId);

  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      const timer = window.setTimeout(() => closeRef.current?.focus(), 80);
      return () => window.clearTimeout(timer);
    }

    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      const timer = window.setTimeout(() => triggerRef.current?.focus(), 80);
      return () => window.clearTimeout(timer);
    }
  }, [open]);

  useEffect(() => {
    if (state.status !== "success") {
      return;
    }

    formRef.current?.reset();

    if (state.entry) {
      setManagedPalaces((current) => {
        const existingIndex = current.findIndex((palace) => palace.id === state.entry?.id);

        if (existingIndex < 0) {
          return [...current, state.entry!];
        }

        return current.map((palace) => palace.id === state.entry?.id ? state.entry! : palace);
      });
      setSelectedId(state.entry.id);
    }
  }, [state]);

  useEffect(() => {
    if (removeState.status !== "success") {
      return;
    }

    if (!removeState.removedId) {
      return;
    }

    setManagedPalaces((current) => {
      const remaining = current.filter((palace) => palace.id !== removeState.removedId);
      setSelectedId((currentId) => currentId === removeState.removedId ? (remaining[0]?.id ?? "") : currentId);
      return remaining;
    });
    setConfirmingRemoval(false);
  }, [removeState]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusable = Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary'
        ) ?? []
      );
      const first = focusable[0];
      const last = focusable.at(-1);

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        className="add-node-trigger"
        type="button"
        aria-label="Add a website node"
        aria-expanded={open}
        aria-controls="add-node-drawer"
        onClick={() => setOpen(true)}
      >
        <Plus aria-hidden="true" size={23} strokeWidth={1.4} />
      </button>

      <button
        className={`add-node-scrim${open ? " is-open" : ""}`}
        type="button"
        aria-label="Close Add Node"
        tabIndex={-1}
        onClick={() => setOpen(false)}
      />

      <aside
        ref={drawerRef}
        id="add-node-drawer"
        className={`add-node-drawer${open ? " is-open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-node-title"
        aria-hidden={!open}
      >
        <header>
          <div>
            <span>Local registry</span>
            <h2 id="add-node-title">Add node</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close Add Node"
            tabIndex={open ? 0 : -1}
            onClick={() => setOpen(false)}
          >
            <X aria-hidden="true" size={19} strokeWidth={1.4} />
          </button>
        </header>

        <section className="add-node-create-choice" aria-labelledby="create-palace-title">
          <span>Agentic creation</span>
          <h3 id="create-palace-title">Create a new website</h3>
          <p>Give the Architect your prompt and sources. The Builder creates it, the Reviewer verifies it, and an accepted result returns here as a brain node.</p>
          <Link href="/create">Open creator</Link>
        </section>

        <form
          ref={formRef}
          action={async (formData) => {
            setPending(true);
            await action(formData);
            setPending(false);
          }}
          className="add-node-form"
        >
          <label>
            <span>Name</span>
            <input
              name="title"
              required
              minLength={2}
              maxLength={80}
              autoComplete="off"
              aria-invalid={Boolean(state.errors?.title)}
              aria-describedby={state.errors?.title ? "add-node-title-error" : undefined}
            />
            {state.errors?.title ? <small id="add-node-title-error">{state.errors.title}</small> : null}
          </label>

          <label>
            <span>Route or URL</span>
            <input
              name="destination"
              required
              maxLength={500}
              placeholder="/palaces/example"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(state.errors?.destination)}
              aria-describedby={state.errors?.destination ? "add-node-destination-error" : "add-node-destination-hint"}
            />
            <small id="add-node-destination-hint">Use a local /route or an HTTPS address.</small>
            {state.errors?.destination ? <small id="add-node-destination-error">{state.errors.destination}</small> : null}
          </label>

          <label>
            <span>Subject</span>
            <input
              name="subject"
              required
              minLength={2}
              maxLength={100}
              autoComplete="off"
              aria-invalid={Boolean(state.errors?.subject)}
              aria-describedby={state.errors?.subject ? "add-node-subject-error" : undefined}
            />
            {state.errors?.subject ? <small id="add-node-subject-error">{state.errors.subject}</small> : null}
          </label>

          <label>
            <span>Summary</span>
            <textarea
              name="summary"
              required
              minLength={12}
              maxLength={280}
              rows={3}
              aria-invalid={Boolean(state.errors?.summary)}
              aria-describedby={state.errors?.summary ? "add-node-summary-error" : undefined}
            />
            {state.errors?.summary ? <small id="add-node-summary-error">{state.errors.summary}</small> : null}
          </label>

          <label>
            <span>Tags</span>
            <input
              name="tags"
              required
              placeholder="design, research, reference"
              autoComplete="off"
              aria-invalid={Boolean(state.errors?.tags)}
              aria-describedby={state.errors?.tags ? "add-node-tags-error" : undefined}
            />
            {state.errors?.tags ? <small id="add-node-tags-error">{state.errors.tags}</small> : null}
          </label>

          <details className="add-node-advanced">
            <summary>Options</summary>
            <div>
              <label>
                <span>Category</span>
                <input name="cluster" maxLength={80} placeholder="Defaults to subject" />
                {state.errors?.cluster ? <small>{state.errors.cluster}</small> : null}
              </label>
              <label>
                <span>Status</span>
                <select name="status" defaultValue="live">
                  <option value="live">Live</option>
                  <option value="queued">Queued</option>
                </select>
                {state.errors?.status ? <small>{state.errors.status}</small> : null}
              </label>
            </div>
          </details>

          <div className={`add-node-feedback is-${state.status}`} role="status" aria-live="polite">
            {state.message}
          </div>

          <SubmitButton pending={pending} />
        </form>

        <section className="add-node-manage" aria-labelledby="manage-nodes-title">
          <div>
            <span>Registry</span>
            <h3 id="manage-nodes-title">Manage</h3>
          </div>

          {managedPalaces.length > 0 ? (
            <>
              <label>
                <span>Website node</span>
                <select
                  value={selectedId}
                  onChange={(event) => {
                    setSelectedId(event.target.value);
                    setConfirmingRemoval(false);
                  }}
                >
                  {managedPalaces.map((palace) => (
                    <option key={palace.id} value={palace.id}>
                      {palace.title}
                    </option>
                  ))}
                </select>
              </label>

              {selectedPalace ? (
                <div className="add-node-manage__selection">
                  <strong>{selectedPalace.title}</strong>
                  <span>{selectedPalace.destination.href}</span>
                  <small>
                    {selectedPalace.destination.type === "external"
                      ? "External website"
                      : "Internal palace — its route and project files will be kept"}
                  </small>
                </div>
              ) : null}

              {confirmingRemoval && selectedPalace ? (
                <form
                  action={async (formData) => {
                    setRemovePending(true);
                    await removeAction(formData);
                    setRemovePending(false);
                  }}
                  className="add-node-remove-confirmation"
                >
                  <input type="hidden" name="id" value={selectedPalace.id} />
                  <input type="hidden" name="confirmation" value="remove" />
                  <p>
                    Remove <strong>{selectedPalace.title}</strong> from the brain?
                    The website itself will not be deleted.
                  </p>
                  <div>
                    <button
                      type="button"
                      disabled={removePending}
                      onClick={() => setConfirmingRemoval(false)}
                    >
                      Cancel
                    </button>
                    <button type="submit" disabled={removePending}>
                      {removePending ? "Removing" : "Confirm removal"}
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  className="add-node-remove"
                  type="button"
                  disabled={!selectedPalace}
                  onClick={() => setConfirmingRemoval(true)}
                >
                  Remove from brain
                </button>
              )}

            </>
          ) : (
            <p className="add-node-manage__empty">There are no registered nodes to manage.</p>
          )}
          <div
            className={`add-node-feedback is-${removeState.status}`}
            role="status"
            aria-live="polite"
          >
            {removeState.message}
          </div>
        </section>
      </aside>
    </>
  );
}
