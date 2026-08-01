"use client";

import { useEffect, useState } from "react";

import { api, ApiError } from "@/lib/api";
import type {
  ProviderKind,
  ProviderPublic,
  ProviderScope,
  ProviderTestResult,
} from "@/lib/types";
import {
  Banner,
  Field,
  IconCheck,
  IconPlus,
  IconTrash,
  Modal,
  Spinner,
} from "./ui";

/** Ready-made endpoints for the runtimes people actually use. */
const PRESETS: {
  id: string;
  name: string;
  kind: ProviderKind;
  scope: ProviderScope;
  base_url: string;
  model: string;
  needsKey: boolean;
}[] = [
  {
    id: "ollama",
    name: "Ollama",
    kind: "openai_compatible",
    scope: "local",
    base_url: "http://localhost:11434/v1",
    model: "llama3.1",
    needsKey: false,
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    kind: "openai_compatible",
    scope: "local",
    base_url: "http://localhost:1234/v1",
    model: "",
    needsKey: false,
  },
  {
    id: "openai",
    name: "OpenAI",
    kind: "openai_compatible",
    scope: "byok",
    base_url: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    needsKey: true,
  },
  {
    id: "groq",
    name: "Groq",
    kind: "openai_compatible",
    scope: "byok",
    base_url: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    needsKey: true,
  },
  {
    id: "anthropic",
    name: "Anthropic",
    kind: "anthropic",
    scope: "byok",
    base_url: "https://api.anthropic.com",
    model: "claude-sonnet-4-5",
    needsKey: true,
  },
];

const SCOPE_HINT: Record<ProviderScope, string> = {
  local: "Runs on this machine — no key leaves your network.",
  global: "A shared endpoint configured for everyone using this instance.",
  byok: "Bring your own key; stored encrypted on the backend.",
};

interface FormState {
  id: string | null;
  name: string;
  kind: ProviderKind;
  scope: ProviderScope;
  base_url: string;
  model: string;
  api_key: string;
  clear_api_key: boolean;
}

const EMPTY_FORM: FormState = {
  id: null,
  name: "",
  kind: "openai_compatible",
  scope: "local",
  base_url: "http://localhost:11434/v1",
  model: "",
  api_key: "",
  clear_api_key: false,
};

export function ProvidersDialog({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: (providers: ProviderPublic[]) => void;
}) {
  const [providers, setProviders] = useState<ProviderPublic[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<
    (ProviderTestResult & { id: string }) | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const list = await api.listProviders();
      setProviders(list);
      onChanged(list);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  };

  useEffect(() => {
    if (open) {
      setForm(null);
      setTestResult(null);
      void refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function save() {
    if (!form) return;
    if (!form.name.trim() || !form.base_url.trim()) {
      setError("Name and base URL are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (form.id) {
        await api.updateProvider(form.id, {
          name: form.name.trim(),
          base_url: form.base_url.trim(),
          model: form.model.trim() || null,
          api_key: form.api_key.trim() || null,
          clear_api_key: form.clear_api_key,
        });
      } else {
        await api.createProvider({
          name: form.name.trim(),
          kind: form.kind,
          scope: form.scope,
          base_url: form.base_url.trim(),
          model: form.model.trim() || null,
          api_key: form.api_key.trim() || null,
        });
      }
      await refresh();
      setForm(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(provider: ProviderPublic) {
    if (!confirm(`Delete provider "${provider.name}"?`)) return;
    try {
      await api.deleteProvider(provider.id);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function test(provider: ProviderPublic) {
    setTesting(provider.id);
    setTestResult(null);
    try {
      const result = await api.testProvider(provider.id);
      setTestResult({ ...result, id: provider.id });
    } catch (err) {
      setTestResult({
        id: provider.id,
        ok: false,
        detail: err instanceof ApiError ? err.message : String(err),
        models: [],
      });
    } finally {
      setTesting(null);
    }
  }

  return (
    <Modal open={open} title="LLM providers" onClose={onClose} width="max-w-2xl">
      {error && (
        <div className="mb-3">
          <Banner onDismiss={() => setError(null)}>{error}</Banner>
        </div>
      )}

      {!form && (
        <>
          <p className="mb-3 text-sm text-muted">
            The assistant talks to whichever provider you select. API keys are
            encrypted at rest by the backend and are never sent back to this UI.
          </p>

          {providers.length === 0 ? (
            <p className="mb-4 rounded-md border border-dashed border-line px-3 py-6 text-center text-sm text-muted">
              No providers configured yet.
            </p>
          ) : (
            <ul className="mb-4 space-y-2">
              {providers.map((provider) => (
                <li key={provider.id} className="rounded-md border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{provider.name}</span>
                    <span className="chip">{provider.scope}</span>
                    <span className="chip">
                      {provider.kind === "anthropic" ? "Anthropic" : "OpenAI-compatible"}
                    </span>
                    {provider.has_api_key && (
                      <span className="chip border-success/40 text-success">key set</span>
                    )}
                    <span className="ml-auto flex items-center gap-1">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => void test(provider)}
                        disabled={testing === provider.id}
                      >
                        {testing === provider.id ? (
                          <Spinner className="size-3.5" />
                        ) : (
                          <IconCheck className="size-3.5" />
                        )}
                        Test
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() =>
                          setForm({
                            id: provider.id,
                            name: provider.name,
                            kind: provider.kind,
                            scope: provider.scope,
                            base_url: provider.base_url,
                            model: provider.model ?? "",
                            api_key: "",
                            clear_api_key: false,
                          })
                        }
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => void remove(provider)}
                        aria-label={`Delete ${provider.name}`}
                      >
                        <IconTrash className="size-3.5" />
                      </button>
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-xs break-all text-muted">
                    {provider.base_url}
                    {provider.model ? ` · ${provider.model}` : ""}
                  </p>
                  {testResult?.id === provider.id && (
                    <div className="mt-2">
                      <Banner tone={testResult.ok ? "success" : "error"}>
                        <p>{testResult.detail}</p>
                        {testResult.models.length > 0 && (
                          <p className="mt-1 font-mono text-xs break-all opacity-80">
                            {testResult.models.slice(0, 12).join(", ")}
                            {testResult.models.length > 12 ? ", …" : ""}
                          </p>
                        )}
                      </Banner>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="mb-4">
            <span className="label">Quick add</span>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="btn btn-sm"
                  onClick={() =>
                    setForm({
                      ...EMPTY_FORM,
                      name: preset.name,
                      kind: preset.kind,
                      scope: preset.scope,
                      base_url: preset.base_url,
                      model: preset.model,
                    })
                  }
                >
                  <IconPlus className="size-3.5" /> {preset.name}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setForm({ ...EMPTY_FORM })}
          >
            <IconPlus className="size-3.5" /> Custom provider
          </button>
        </>
      )}

      {form && (
        <div>
          <Field label="Name">
            <input
              className="input"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Ollama (local)"
              autoFocus
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="API shape">
              <select
                className="input"
                value={form.kind}
                disabled={!!form.id}
                onChange={(event) =>
                  setForm({ ...form, kind: event.target.value as ProviderKind })
                }
              >
                <option value="openai_compatible">
                  OpenAI-compatible (OpenAI, Groq, Ollama, LM Studio, vLLM…)
                </option>
                <option value="anthropic">Anthropic Messages API</option>
              </select>
            </Field>
            <Field label="Scope" hint={SCOPE_HINT[form.scope]}>
              <select
                className="input"
                value={form.scope}
                disabled={!!form.id}
                onChange={(event) =>
                  setForm({ ...form, scope: event.target.value as ProviderScope })
                }
              >
                <option value="local">Local</option>
                <option value="global">Global</option>
                <option value="byok">BYOK</option>
              </select>
            </Field>
          </div>

          <Field
            label="Base URL"
            hint={
              form.kind === "anthropic"
                ? "Host only — the client appends /v1/messages."
                : "Include the /v1 suffix — the client appends /chat/completions."
            }
          >
            <input
              className="input font-mono"
              value={form.base_url}
              onChange={(event) => setForm({ ...form, base_url: event.target.value })}
            />
          </Field>

          <Field label="Model" hint="Sent as the model id on every request.">
            <input
              className="input font-mono"
              value={form.model}
              onChange={(event) => setForm({ ...form, model: event.target.value })}
              placeholder="llama3.1"
            />
          </Field>

          <Field
            label="API key"
            hint={
              form.id
                ? "Leave blank to keep the stored key unchanged."
                : "Optional for local runtimes that don't check it."
            }
          >
            <input
              className="input font-mono"
              type="password"
              value={form.api_key}
              onChange={(event) =>
                setForm({ ...form, api_key: event.target.value, clear_api_key: false })
              }
              placeholder="sk-…"
            />
          </Field>

          {form.id && (
            <label className="mb-3 flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={form.clear_api_key}
                onChange={(event) =>
                  setForm({ ...form, clear_api_key: event.target.checked })
                }
              />
              Remove the stored API key
            </label>
          )}

          <div className="flex justify-end gap-2 border-t border-line pt-3">
            <button type="button" className="btn" onClick={() => setForm(null)}>
              Back
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void save()}
              disabled={busy}
            >
              {busy && <Spinner className="size-3.5" />}
              {form.id ? "Save changes" : "Create provider"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
