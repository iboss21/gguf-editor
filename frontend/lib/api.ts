/**
 * Thin typed client for the GGUF Editor backend.
 *
 * Every call goes through `request()` so FastAPI's `{"detail": ...}` error
 * bodies are turned into a single `ApiError` the UI can render directly.
 */
import type {
  ApplyEditsResponse,
  ChatMessage,
  ChatResponse,
  DirectoryListing,
  GGUFFileInfo,
  MetadataEdit,
  OutputOptions,
  ProviderCreate,
  ProviderPublic,
  ProviderTestResult,
  ProviderUpdate,
  RootInfo,
  SearchResult,
} from "./types";

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api"
).replace(/\/$/, "");

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function detailToMessage(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    // FastAPI validation errors: [{loc: [...], msg: "..."}]
    const parts = detail
      .map((d) =>
        d && typeof d === "object" && "msg" in d
          ? String((d as { msg: unknown }).msg)
          : null,
      )
      .filter(Boolean);
    if (parts.length) return parts.join("; ");
  }
  return fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(
      `Cannot reach the backend at ${API_BASE_URL}. Is it running?`,
      0,
    );
  }

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      message = detailToMessage(body?.detail, message);
    } catch {
      // Non-JSON error body — keep the status line.
    }
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export const api = {
  health(): Promise<{ status: string; service: string }> {
    return request("/health");
  },

  // --- Explorer -----------------------------------------------------------

  listRoots(): Promise<RootInfo[]> {
    return request("/explorer/roots");
  },

  createRoot(path: string, label?: string): Promise<RootInfo> {
    return post("/explorer/roots", { path, label: label || null });
  },

  deleteRoot(rootId: string): Promise<void> {
    return request(`/explorer/roots/${rootId}`, { method: "DELETE" });
  },

  browse(rootId: string, path = ""): Promise<DirectoryListing> {
    const params = new URLSearchParams({ root_id: rootId, path });
    return request(`/explorer/browse?${params}`);
  },

  search(rootId: string, query: string, limit = 200): Promise<SearchResult> {
    const params = new URLSearchParams({
      root_id: rootId,
      query,
      limit: String(limit),
    });
    return request(`/explorer/search?${params}`);
  },

  // --- GGUF ---------------------------------------------------------------

  inspect(rootId: string, relPath: string): Promise<GGUFFileInfo> {
    return post("/gguf/inspect", { root_id: rootId, rel_path: relPath });
  },

  applyEdits(
    rootId: string,
    relPath: string,
    edits: MetadataEdit[],
    output: OutputOptions,
  ): Promise<ApplyEditsResponse> {
    return post("/gguf/metadata", {
      root_id: rootId,
      rel_path: relPath,
      edits,
      output,
    });
  },

  previewRebrand(payload: {
    root_id: string;
    rel_path: string;
    find: string;
    replace: string;
    case_sensitive: boolean;
    keys?: string[] | null;
  }): Promise<{ edits: MetadataEdit[] }> {
    return post("/gguf/rebrand/preview", payload);
  },

  rebrand(payload: {
    root_id: string;
    rel_path: string;
    find: string;
    replace: string;
    case_sensitive: boolean;
    include_filename: boolean;
    keys?: string[] | null;
    output: OutputOptions;
  }): Promise<ApplyEditsResponse> {
    return post("/gguf/rebrand", payload);
  },

  downloadUrl(rootId: string, relPath: string): string {
    const params = new URLSearchParams({ root_id: rootId, rel_path: relPath });
    return `${API_BASE_URL}/gguf/download?${params}`;
  },

  // --- Providers ----------------------------------------------------------

  listProviders(): Promise<ProviderPublic[]> {
    return request("/providers");
  },

  createProvider(payload: ProviderCreate): Promise<ProviderPublic> {
    return post("/providers", payload);
  },

  updateProvider(id: string, payload: ProviderUpdate): Promise<ProviderPublic> {
    return request(`/providers/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },

  deleteProvider(id: string): Promise<void> {
    return request(`/providers/${id}`, { method: "DELETE" });
  },

  testProvider(id: string): Promise<ProviderTestResult> {
    return post(`/providers/${id}/test`, {});
  },

  // --- Chat ---------------------------------------------------------------

  chat(payload: {
    provider_id: string;
    messages: ChatMessage[];
    target?: { root_id: string; rel_path: string } | null;
    pending_edits?: MetadataEdit[];
    auto_apply?: boolean;
  }): Promise<ChatResponse> {
    return post("/chat", payload);
  },
};
