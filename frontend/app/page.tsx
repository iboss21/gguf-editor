"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ChatPanel } from "@/components/ChatPanel";
import { Explorer } from "@/components/Explorer";
import { MetadataTable } from "@/components/MetadataTable";
import { ProvidersDialog } from "@/components/ProvidersDialog";
import { TensorTable } from "@/components/TensorTable";
import { AddFieldDialog, RebrandDialog, SaveDialog } from "@/components/dialogs";
import {
  Banner,
  EmptyState,
  IconCube,
  IconDownload,
  IconPlus,
  IconRefresh,
  IconSave,
  IconSearch,
  IconSettings,
  IconSparkles,
  IconTrash,
  IconWand,
  Spinner,
} from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { mergeEdits, applyEditsInMemory } from "@/lib/edits";
import { formatBytes, formatCount } from "@/lib/format";
import type {
  ApplyEditsResponse,
  GGUFFileInfo,
  MetadataEdit,
  ProviderPublic,
} from "@/lib/types";

type Tab = "metadata" | "tensors" | "chat";

const PROVIDER_STORAGE_KEY = "gguf-editor:provider-id";

export default function Workspace() {
  const [activeRootId, setActiveRootId] = useState<string | null>(null);
  const [file, setFile] = useState<GGUFFileInfo | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [edits, setEdits] = useState<MetadataEdit[]>([]);
  const [tab, setTab] = useState<Tab>("metadata");
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [backendUp, setBackendUp] = useState<boolean | null>(null);
  const [explorerRefresh, setExplorerRefresh] = useState(0);

  const [providers, setProviders] = useState<ProviderPublic[]>([]);
  const [providerId, setProviderId] = useState<string | null>(null);

  const [saveOpen, setSaveOpen] = useState(false);
  const [rebrandOpen, setRebrandOpen] = useState(false);
  const [addFieldOpen, setAddFieldOpen] = useState(false);
  const [providersOpen, setProvidersOpen] = useState(false);

  // --- bootstrapping ------------------------------------------------------

  useEffect(() => {
    void api
      .health()
      .then(() => setBackendUp(true))
      .catch(() => setBackendUp(false));

    void api
      .listProviders()
      .then((list) => {
        setProviders(list);
        const stored =
          typeof window !== "undefined"
            ? window.localStorage.getItem(PROVIDER_STORAGE_KEY)
            : null;
        setProviderId(
          list.find((provider) => provider.id === stored)?.id ?? list[0]?.id ?? null,
        );
      })
      .catch(() => setProviders([]));
  }, []);

  const selectProvider = useCallback((id: string) => {
    setProviderId(id);
    window.localStorage.setItem(PROVIDER_STORAGE_KEY, id);
  }, []);

  // --- file loading -------------------------------------------------------

  const openFile = useCallback(async (rootId: string, relPath: string) => {
    setLoadingFile(true);
    setError(null);
    setNotice(null);
    try {
      const info = await api.inspect(rootId, relPath);
      setFile(info);
      setEdits([]);
      setFilter("");
      setTab("metadata");
    } catch (err) {
      setFile(null);
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoadingFile(false);
    }
  }, []);

  const reloadFile = useCallback(() => {
    if (file) void openFile(file.root_id, file.rel_path);
  }, [file, openFile]);

  // --- edit staging -------------------------------------------------------

  const stageEdit = useCallback((edit: MetadataEdit) => {
    setEdits((current) => mergeEdits(current, [edit]));
  }, []);

  const stageMany = useCallback((incoming: MetadataEdit[]) => {
    setEdits((current) => mergeEdits(current, incoming));
  }, []);

  const revertKey = useCallback((key: string) => {
    setEdits((current) => current.filter((edit) => edit.key !== key));
  }, []);

  const effectiveMetadata = useMemo(
    () => (file ? applyEditsInMemory(file.metadata, edits) : []),
    [file, edits],
  );

  const stagedKeys = useMemo(
    () =>
      new Set(
        edits.flatMap((edit) =>
          edit.op === "rename" && edit.new_key ? [edit.key, edit.new_key] : [edit.key],
        ),
      ),
    [edits],
  );

  /**
   * Shared post-write handling. `clearEdits` is false for a direct rebrand
   * write: that endpoint only writes the rebrand itself, so any other staged
   * change must survive rather than be silently dropped.
   */
  function handleWritten(
    result: ApplyEditsResponse,
    action: string,
    { clearEdits = true }: { clearEdits?: boolean } = {},
  ) {
    setFile(result.file);
    if (clearEdits) setEdits([]);
    setSaveOpen(false);
    setRebrandOpen(false);
    setExplorerRefresh((current) => current + 1);
    setNotice(
      `${action} → ${result.output_rel_path}` +
        (result.backup_rel_path ? " (backup created)" : ""),
    );
  }

  // --- render -------------------------------------------------------------

  const tabs: { id: Tab; label: string; badge?: string }[] = [
    { id: "metadata", label: "Metadata", badge: file ? String(effectiveMetadata.length) : undefined },
    { id: "tensors", label: "Tensors", badge: file ? String(file.tensor_count) : undefined },
    { id: "chat", label: "Assistant" },
  ];

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
        <div className="flex items-center gap-2">
          <IconCube className="size-5 text-accent" />
          <span className="text-sm font-semibold tracking-tight">GGUF Editor</span>
        </div>

        <span
          className="chip"
          title={
            backendUp === false
              ? "The backend is unreachable — start it with `uvicorn app.main:app`."
              : "Backend reachable"
          }
        >
          <span
            className={`size-1.5 rounded-full ${
              backendUp === null
                ? "bg-faint"
                : backendUp
                  ? "bg-success"
                  : "bg-danger"
            }`}
          />
          {backendUp === null ? "connecting" : backendUp ? "backend online" : "backend offline"}
        </span>

        {file && (
          <span className="hidden min-w-0 items-center gap-2 text-xs text-muted sm:flex">
            <span className="truncate font-mono">{file.rel_path}</span>
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {edits.length > 0 && (
            <>
              <span className="chip border-accent/50 text-accent">
                {edits.length} pending
              </span>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setEdits([])}
                title="Discard all staged changes"
              >
                <IconTrash className="size-3.5" /> Discard
              </button>
            </>
          )}
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setProvidersOpen(true)}
          >
            <IconSettings className="size-3.5" /> Providers
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="hidden w-80 shrink-0 md:block">
          <Explorer
            activeRootId={activeRootId}
            onActiveRootChange={setActiveRootId}
            openedRelPath={file?.rel_path ?? null}
            onOpenFile={(rootId, relPath) => void openFile(rootId, relPath)}
            refreshToken={explorerRefresh}
          />
        </div>

        <main className="flex min-w-0 flex-1 flex-col bg-canvas">
          {(error || notice) && (
            <div className="space-y-2 px-4 pt-3">
              {error && <Banner onDismiss={() => setError(null)}>{error}</Banner>}
              {notice && (
                <Banner tone="success" onDismiss={() => setNotice(null)}>
                  {notice}
                </Banner>
              )}
            </div>
          )}

          {loadingFile && (
            <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted">
              <Spinner /> Reading GGUF header…
            </div>
          )}

          {!loadingFile && !file && (
            <EmptyState
              icon={<IconCube className="size-10" />}
              title="No file open"
              hint={
                backendUp === false
                  ? "The backend is not reachable. Start it, then reload this page."
                  : "Register a models folder in the sidebar and pick a .gguf file to inspect its metadata and tensors."
              }
            />
          )}

          {!loadingFile && file && (
            <>
              <section className="border-b border-line bg-surface px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <h1 className="text-base font-semibold break-all">{file.filename}</h1>
                  <span className="chip">{file.architecture ?? "unknown arch"}</span>
                  <span className="chip">{formatBytes(file.size_bytes)}</span>
                  <span className="chip">{file.endian.toLowerCase()}</span>
                  {file.total_parameters !== null && (
                    <span className="chip">{formatCount(file.total_parameters)} params</span>
                  )}

                  <div className="ml-auto flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={reloadFile}
                      title="Re-read the file from disk"
                    >
                      <IconRefresh className="size-3.5" /> Reload
                    </button>
                    <a
                      className="btn btn-sm"
                      href={api.downloadUrl(file.root_id, file.rel_path)}
                      download
                    >
                      <IconDownload className="size-3.5" /> Download
                    </a>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setRebrandOpen(true)}
                    >
                      <IconWand className="size-3.5" /> Rebrand
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={() => setSaveOpen(true)}
                      disabled={!edits.length}
                    >
                      <IconSave className="size-3.5" /> Save…
                    </button>
                  </div>
                </div>
              </section>

              <nav className="flex items-center gap-1 border-b border-line bg-surface px-3">
                {tabs.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setTab(entry.id)}
                    className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition ${
                      tab === entry.id
                        ? "border-accent text-content"
                        : "border-transparent text-muted hover:text-content"
                    }`}
                  >
                    {entry.id === "chat" && <IconSparkles className="size-3.5" />}
                    {entry.label}
                    {entry.badge && (
                      <span className="text-[11px] text-faint">{entry.badge}</span>
                    )}
                  </button>
                ))}
              </nav>

              <div className="min-h-0 flex-1 overflow-hidden bg-surface">
                {tab === "metadata" && (
                  <div className="flex h-full flex-col">
                    <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
                      <div className="relative max-w-xs flex-1">
                        <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
                        <input
                          className="input pl-8"
                          placeholder="Filter keys and values…"
                          value={filter}
                          onChange={(event) => setFilter(event.target.value)}
                        />
                      </div>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setAddFieldOpen(true)}
                      >
                        <IconPlus className="size-3.5" /> Add field
                      </button>
                      <span className="text-xs text-muted">
                        Click any value to edit it.
                      </span>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto">
                      <MetadataTable
                        items={effectiveMetadata}
                        stagedKeys={stagedKeys}
                        filter={filter}
                        onStage={stageEdit}
                        onRevert={revertKey}
                      />
                    </div>
                  </div>
                )}

                {tab === "tensors" && <TensorTable tensors={file.tensors} />}

                {tab === "chat" && (
                  <ChatPanel
                    file={file}
                    providers={providers}
                    providerId={providerId}
                    onProviderChange={selectProvider}
                    pendingEdits={edits}
                    onEditsChange={setEdits}
                    onApplied={(outputRelPath) => {
                      setNotice(
                        outputRelPath
                          ? `Assistant wrote changes to ${outputRelPath}`
                          : "Assistant wrote changes to disk",
                      );
                      if (outputRelPath) void openFile(file.root_id, outputRelPath);
                    }}
                    onOpenProviders={() => setProvidersOpen(true)}
                  />
                )}
              </div>
            </>
          )}
        </main>
      </div>

      {file && (
        <>
          <SaveDialog
            open={saveOpen}
            file={file}
            edits={edits}
            onClose={() => setSaveOpen(false)}
            onSaved={(result) => handleWritten(result, "Saved")}
          />
          <RebrandDialog
            open={rebrandOpen}
            file={file}
            onClose={() => setRebrandOpen(false)}
            onStage={stageMany}
            onApplied={(result) =>
              handleWritten(result, "Rebranded", { clearEdits: false })
            }
          />
          <AddFieldDialog
            open={addFieldOpen}
            onClose={() => setAddFieldOpen(false)}
            onStage={stageEdit}
            existingKeys={effectiveMetadata.map((item) => item.key)}
          />
        </>
      )}

      <ProvidersDialog
        open={providersOpen}
        onClose={() => setProvidersOpen(false)}
        onChanged={(list) => {
          setProviders(list);
          if (!list.some((provider) => provider.id === providerId)) {
            setProviderId(list[0]?.id ?? null);
          }
        }}
      />
    </div>
  );
}
