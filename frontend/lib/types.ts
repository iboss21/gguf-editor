/**
 * TypeScript mirror of `backend/app/models/schemas.py`.
 *
 * Keep this file in sync with the Pydantic models — they are the JSON
 * contract between the FastAPI backend and this UI.
 */

// --- Explorer -------------------------------------------------------------

export interface RootInfo {
  id: string;
  label: string;
  path: string;
  exists: boolean;
  created_at: string;
}

export interface EntryInfo {
  name: string;
  rel_path: string;
  is_dir: boolean;
  is_gguf: boolean;
  size_bytes: number | null;
  modified_at: string | null;
}

export interface DirectoryListing {
  root_id: string;
  rel_path: string;
  parent_rel_path: string | null;
  entries: EntryInfo[];
}

export interface SearchResult {
  root_id: string;
  query: string;
  results: EntryInfo[];
}

// --- GGUF metadata / tensors ---------------------------------------------

export interface MetadataItem {
  key: string;
  value: unknown;
  value_type: string;
  array_value_type: string | null;
  is_array: boolean;
  array_length: number | null;
  truncated: boolean;
  editable: boolean;
  modified: boolean;
}

export interface TensorItem {
  name: string;
  shape: number[];
  dtype: string;
  n_elements: number;
}

export interface GGUFFileInfo {
  root_id: string;
  rel_path: string;
  filename: string;
  size_bytes: number;
  architecture: string | null;
  endian: string;
  metadata: MetadataItem[];
  tensor_count: number;
  tensors: TensorItem[];
  total_parameters: number | null;
}

export type EditOp = "set" | "delete" | "rename";

export interface MetadataEdit {
  op: EditOp;
  key: string;
  value?: unknown;
  value_type?: string | null;
  array_value_type?: string | null;
  new_key?: string | null;
}

export type OutputMode = "overwrite" | "new_name";

export interface OutputOptions {
  mode: OutputMode;
  filename: string | null;
  backup: boolean;
}

export interface ApplyEditsResponse {
  success: boolean;
  output_rel_path: string;
  backup_rel_path: string | null;
  file: GGUFFileInfo;
}

// --- Providers ------------------------------------------------------------

export type ProviderScope = "local" | "global" | "byok";
export type ProviderKind = "openai_compatible" | "anthropic";

export interface ProviderPublic {
  id: string;
  name: string;
  kind: ProviderKind;
  scope: ProviderScope;
  base_url: string;
  model: string | null;
  has_api_key: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProviderCreate {
  name: string;
  kind: ProviderKind;
  scope: ProviderScope;
  base_url: string;
  api_key?: string | null;
  model?: string | null;
}

export interface ProviderUpdate {
  name?: string | null;
  base_url?: string | null;
  api_key?: string | null;
  clear_api_key?: boolean;
  model?: string | null;
}

export interface ProviderTestResult {
  ok: boolean;
  detail: string;
  models: string[];
}

// --- Chat -----------------------------------------------------------------

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ToolEvent {
  tool: string;
  args: Record<string, unknown>;
  result: string;
}

export interface ChatResponse {
  message: ChatMessage;
  tool_events: ToolEvent[];
  pending_edits: MetadataEdit[];
  metadata_preview: MetadataItem[];
  applied: boolean;
  output_rel_path: string | null;
}

// --- UI-only helpers ------------------------------------------------------

/** Scalar GGUF value types the metadata editor can create from scratch. */
export const SCALAR_VALUE_TYPES = [
  "STRING",
  "BOOL",
  "UINT8",
  "UINT16",
  "UINT32",
  "UINT64",
  "INT8",
  "INT16",
  "INT32",
  "INT64",
  "FLOAT32",
  "FLOAT64",
] as const;

export type ScalarValueType = (typeof SCALAR_VALUE_TYPES)[number];

export const INT_VALUE_TYPES = new Set<string>([
  "UINT8",
  "UINT16",
  "UINT32",
  "UINT64",
  "INT8",
  "INT16",
  "INT32",
  "INT64",
]);

export const FLOAT_VALUE_TYPES = new Set<string>(["FLOAT32", "FLOAT64"]);
