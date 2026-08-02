"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { api, ApiError } from "@/lib/api";
import { breadcrumbs, formatBytes, formatDate } from "@/lib/format";
import type { EntryInfo, RootInfo } from "@/lib/types";
import {
  Banner,
  EmptyState,
  Field,
  IconChevronRight,
  IconFile,
  IconFolder,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
  Modal,
  Spinner,
} from "./ui";

interface ExplorerProps {
  activeRootId: string | null;
  onActiveRootChange: (rootId: string | null) => void;
  openedRelPath: string | null;
  onOpenFile: (rootId: string, relPath: string) => void;
  /** Bumped by the workspace after a write so new files show up right away. */
  refreshToken: number;
}

export function Explorer({
  activeRootId,
  onActiveRootChange,
  openedRelPath,
  onOpenFile,
  refreshToken,
}: ExplorerProps) {
  const [roots, setRoots] = useState<RootInfo[]>([]);
  const [dirPath, setDirPath] = useState("");
  const [entries, setEntries] = useState<EntryInfo[]>([]);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<EntryInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const refreshRoots = useCallback(async () => {
    try {
      const list = await api.listRoots();
      setRoots(list);
      setError(null);
      return list;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      return [];
    }
  }, []);

  // Load roots once, and auto-select the first one so the app is usable
  // immediately after a root has been registered.
  useEffect(() => {
    void (async () => {
      const list = await refreshRoots();
      if (list.length && !activeRootId) onActiveRootChange(list[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDirectory = useCallback(
    async (rootId: string, path: string) => {
      setLoading(true);
      try {
        const listing = await api.browse(rootId, path);
        setEntries(listing.entries);
        setDirPath(listing.rel_path);
        setError(null);
      } catch (err) {
        setEntries([]);
        setError(err instanceof ApiError ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!activeRootId) {
      setEntries([]);
      return;
    }
    setSearchResults(null);
    setQuery("");
    void loadDirectory(activeRootId, "");
  }, [activeRootId, loadDirectory]);

  // Re-read the current directory when the workspace writes a file, so a
  // freshly created "…-edited.gguf" appears without a manual refresh.
  useEffect(() => {
    if (!refreshToken || !activeRootId) return;
    void loadDirectory(activeRootId, dirPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  // Debounced recursive search across the active root.
  useEffect(() => {
    if (!activeRootId) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults(null);
      return;
    }
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const result = await api.search(activeRootId, trimmed);
        setSearchResults(result.results);
        setError(null);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query, activeRootId]);

  const activeRoot = useMemo(
    () => roots.find((r) => r.id === activeRootId) ?? null,
    [roots, activeRootId],
  );

  const crumbs = breadcrumbs(dirPath);
  const visible = searchResults ?? entries;

  async function handleDeleteRoot(root: RootInfo) {
    if (!confirm(`Remove root "${root.label}"?\n\nThis only unregisters the folder — no files are deleted.`))
      return;
    try {
      await api.deleteRoot(root.id);
      const list = await refreshRoots();
      if (activeRootId === root.id) onActiveRootChange(list[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  return (
    <aside className="flex h-full w-full flex-col border-r border-line bg-surface">
      <div className="border-b border-line p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="label mb-0">Model roots</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void refreshRoots()}
              title="Reload roots"
            >
              <IconRefresh className="size-3.5" />
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setAddOpen(true)}
              title="Register a folder"
            >
              <IconPlus className="size-3.5" />
            </button>
          </div>
        </div>

        {roots.length === 0 ? (
          <button type="button" className="btn w-full" onClick={() => setAddOpen(true)}>
            <IconPlus className="size-3.5" /> Add a models folder
          </button>
        ) : (
          <ul className="space-y-1">
            {roots.map((root) => (
              <li key={root.id} className="group flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onActiveRootChange(root.id)}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition ${
                    root.id === activeRootId
                      ? "bg-raised text-content"
                      : "text-muted hover:bg-raised hover:text-content"
                  }`}
                  title={root.path}
                >
                  <IconFolder
                    className={`size-4 shrink-0 ${root.id === activeRootId ? "text-accent" : ""}`}
                  />
                  <span className="min-w-0 flex-1 truncate">{root.label}</span>
                  {!root.exists && (
                    <span className="chip border-danger/40 text-danger">missing</span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteRoot(root)}
                  className="btn-ghost rounded p-1 text-faint opacity-0 transition group-hover:opacity-100 hover:text-danger"
                  aria-label={`Remove root ${root.label}`}
                >
                  <IconTrash className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {activeRoot && (
        <div className="border-b border-line p-3">
          <div className="relative">
            <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
            <input
              className="input pl-8"
              placeholder="Search .gguf files…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {!searchResults && (
            <nav className="mt-2 flex flex-wrap items-center gap-0.5 text-xs text-muted">
              <button
                type="button"
                className="rounded px-1 py-0.5 hover:bg-raised hover:text-content"
                onClick={() => void loadDirectory(activeRoot.id, "")}
              >
                {activeRoot.label}
              </button>
              {crumbs.map((crumb) => (
                <span key={crumb.path} className="flex items-center gap-0.5">
                  <IconChevronRight className="size-3 text-faint" />
                  <button
                    type="button"
                    className="rounded px-1 py-0.5 hover:bg-raised hover:text-content"
                    onClick={() => void loadDirectory(activeRoot.id, crumb.path)}
                  >
                    {crumb.name}
                  </button>
                </span>
              ))}
            </nav>
          )}
        </div>
      )}

      {error && (
        <div className="p-3">
          <Banner onDismiss={() => setError(null)}>{error}</Banner>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted">
            <Spinner /> Loading…
          </div>
        )}

        {!loading && !activeRoot && (
          <EmptyState
            icon={<IconFolder className="size-8" />}
            title="No folder registered"
            hint="Point GGUF Editor at a directory holding .gguf files — for example your Ollama, LM Studio, or llama.cpp models folder."
          />
        )}

        {!loading && activeRoot && visible.length === 0 && (
          <EmptyState
            icon={<IconFile className="size-8" />}
            title={searchResults ? "No matches" : "Empty folder"}
            hint={
              searchResults
                ? `No .gguf file under ${activeRoot.label} matches “${query}”.`
                : "This folder has no visible entries."
            }
          />
        )}

        <ul>
          {!loading &&
            dirPath &&
            !searchResults &&
            (() => {
              const parent = dirPath.split("/").slice(0, -1).join("/");
              return (
                <li>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-muted hover:bg-raised"
                    onClick={() => void loadDirectory(activeRoot!.id, parent)}
                  >
                    <IconFolder className="size-4 shrink-0" />
                    <span>..</span>
                  </button>
                </li>
              );
            })()}

          {!loading &&
            visible.map((entry) => {
              const isOpened = openedRelPath === entry.rel_path;
              return (
                <li key={entry.rel_path}>
                  <button
                    type="button"
                    onClick={() =>
                      entry.is_dir
                        ? void loadDirectory(activeRoot!.id, entry.rel_path)
                        : entry.is_gguf && onOpenFile(activeRoot!.id, entry.rel_path)
                    }
                    disabled={!entry.is_dir && !entry.is_gguf}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition ${
                      isOpened
                        ? "bg-accent/12 text-content"
                        : "hover:bg-raised disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent"
                    }`}
                    title={entry.rel_path}
                  >
                    {entry.is_dir ? (
                      <IconFolder className="size-4 shrink-0 text-muted" />
                    ) : (
                      <IconFile
                        className={`size-4 shrink-0 ${entry.is_gguf ? "text-accent" : "text-faint"}`}
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate">
                      {searchResults ? entry.rel_path : entry.name}
                    </span>
                    {!entry.is_dir && (
                      <span
                        className="shrink-0 text-[11px] text-faint"
                        title={formatDate(entry.modified_at)}
                      >
                        {formatBytes(entry.size_bytes)}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
        </ul>
      </div>

      <AddRootDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={async (root) => {
          setAddOpen(false);
          await refreshRoots();
          onActiveRootChange(root.id);
        }}
      />
    </aside>
  );
}

function AddRootDialog({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: (root: RootInfo) => void | Promise<void>;
}) {
  const [path, setPath] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPath("");
      setLabel("");
      setError(null);
    }
  }, [open]);

  async function submit() {
    if (!path.trim()) return;
    setBusy(true);
    try {
      const root = await api.createRoot(path.trim(), label.trim() || undefined);
      await onAdded(root);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Register a models folder"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void submit()}
            disabled={busy || !path.trim()}
          >
            {busy && <Spinner className="size-3.5" />} Add root
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-3">
          <Banner onDismiss={() => setError(null)}>{error}</Banner>
        </div>
      )}
      <p className="mb-4 text-sm text-muted">
        The backend can only browse folders you register here. Paths are resolved on
        the machine running the backend, and <code className="font-mono">~</code> is
        expanded.
      </p>
      <Field
        label="Absolute path"
        hint="e.g. ~/.ollama/models, ~/.cache/lm-studio/models, or /models in Docker"
      >
        <input
          className="input font-mono"
          value={path}
          onChange={(event) => setPath(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && void submit()}
          placeholder="/home/you/models"
          autoFocus
        />
      </Field>
      <Field label="Label (optional)" hint="Defaults to the folder name.">
        <input
          className="input"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && void submit()}
          placeholder="Ollama"
        />
      </Field>
    </Modal>
  );
}
