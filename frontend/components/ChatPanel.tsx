"use client";

import { useEffect, useRef, useState } from "react";

import { api, ApiError } from "@/lib/api";
import type {
  ChatMessage,
  GGUFFileInfo,
  MetadataEdit,
  ProviderPublic,
  ToolEvent,
} from "@/lib/types";
import {
  Banner,
  EmptyState,
  IconSettings,
  IconSparkles,
  Spinner,
  Toggle,
} from "./ui";

interface Turn extends ChatMessage {
  toolEvents?: ToolEvent[];
}

const SUGGESTIONS = [
  "Rebrand this model from Qwen to Reges",
  "Set the author to my org and add an MIT license field",
  "Summarise what this file's metadata says about the model",
];

interface ChatPanelProps {
  file: GGUFFileInfo | null;
  providers: ProviderPublic[];
  providerId: string | null;
  onProviderChange: (id: string) => void;
  pendingEdits: MetadataEdit[];
  onEditsChange: (edits: MetadataEdit[]) => void;
  onApplied: (outputRelPath: string | null) => void;
  onOpenProviders: () => void;
}

export function ChatPanel({
  file,
  providers,
  providerId,
  onProviderChange,
  pendingEdits,
  onEditsChange,
  onApplied,
  onOpenProviders,
}: ChatPanelProps) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [autoApply, setAutoApply] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns, busy]);

  // A new file means a new conversation context.
  useEffect(() => {
    setTurns([]);
    setError(null);
  }, [file?.root_id, file?.rel_path]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || !providerId || busy) return;

    const history: ChatMessage[] = [
      ...turns.map(({ role, content: turnContent }) => ({ role, content: turnContent })),
      { role: "user" as const, content },
    ];

    setTurns((current) => [...current, { role: "user", content }]);
    setInput("");
    setBusy(true);
    setError(null);

    try {
      const response = await api.chat({
        provider_id: providerId,
        messages: history,
        target: file ? { root_id: file.root_id, rel_path: file.rel_path } : null,
        pending_edits: pendingEdits,
        auto_apply: autoApply,
      });

      setTurns((current) => [
        ...current,
        {
          role: "assistant",
          content: response.message.content,
          toolEvents: response.tool_events,
        },
      ]);
      onEditsChange(response.pending_edits);
      if (response.applied) onApplied(response.output_rel_path);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      // Drop the optimistic user turn so retrying doesn't duplicate it.
      setTurns((current) => current.slice(0, -1));
      setInput(content);
    } finally {
      setBusy(false);
    }
  }

  if (!providers.length) {
    return (
      <EmptyState
        icon={<IconSparkles className="size-8" />}
        title="No LLM provider configured"
        hint="Connect a local runtime (Ollama, LM Studio) or bring your own key to let the assistant edit metadata for you."
        action={
          <button type="button" className="btn btn-primary" onClick={onOpenProviders}>
            <IconSettings className="size-3.5" /> Configure providers
          </button>
        }
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5">
        <select
          className="input max-w-56"
          value={providerId ?? ""}
          onChange={(event) => onProviderChange(event.target.value)}
        >
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
              {provider.model ? ` · ${provider.model}` : ""}
            </option>
          ))}
        </select>

        <Toggle
          checked={autoApply}
          onChange={setAutoApply}
          label="Auto-apply"
          hint="Write changes to disk as soon as the assistant makes them."
        />

        <button
          type="button"
          className="btn btn-sm ml-auto"
          onClick={() => setTurns([])}
          disabled={!turns.length}
        >
          Clear chat
        </button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {!turns.length && (
          <div className="mx-auto max-w-lg py-8 text-center">
            <IconSparkles className="mx-auto size-8 text-accent" />
            <p className="mt-3 text-sm font-medium">
              {file
                ? `Ask about ${file.filename}, or describe an edit.`
                : "Open a .gguf file to let the assistant edit its metadata."}
            </p>
            <p className="mt-1 text-sm text-muted">
              Changes are staged for review — nothing is written until you save,
              unless auto-apply is on.
            </p>
            {file && (
              <div className="mt-4 flex flex-col gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="btn text-left"
                    onClick={() => void send(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {turns.map((turn, index) => (
          <div
            key={index}
            className={turn.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                turn.role === "user"
                  ? "bg-accent/15 text-content"
                  : "border border-line bg-surface"
              }`}
            >
              {turn.toolEvents && turn.toolEvents.length > 0 && (
                <ul className="mb-2 space-y-1 border-b border-line pb-2">
                  {turn.toolEvents.map((event, eventIndex) => (
                    <li key={eventIndex} className="text-xs">
                      <span className="chip border-accent/40 text-accent">
                        {event.tool}
                      </span>{" "}
                      <span className="font-mono break-all text-muted">
                        {event.result}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="whitespace-pre-wrap">{turn.content}</p>
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Spinner /> Thinking…
          </div>
        )}
      </div>

      {error && (
        <div className="px-4 pb-2">
          <Banner onDismiss={() => setError(null)}>{error}</Banner>
        </div>
      )}

      <form
        className="flex items-end gap-2 border-t border-line p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
      >
        <textarea
          className="input min-h-[2.5rem] resize-y"
          rows={2}
          value={input}
          placeholder={
            file ? "Describe the change you want…" : "Ask a question about GGUF files…"
          }
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(input);
            }
          }}
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || !input.trim() || !providerId}
        >
          {busy ? <Spinner className="size-3.5" /> : <IconSparkles className="size-3.5" />}
          Send
        </button>
      </form>
    </div>
  );
}
