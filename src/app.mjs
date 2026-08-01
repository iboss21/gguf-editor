// Browser UI wiring for the GGUF editor. Pure DOM logic; all the actual
// GGUF parsing/serialization lives in ./gguf/*.mjs, and value
// formatting/parsing lives in ./value-format.mjs, both unit-tested
// independently of this file.

import { parseGGUF, exportGGUF, GGUFValueType, WELL_KNOWN_KEYS } from './gguf/index.mjs';
import { getAlignment } from './gguf/alignment.mjs';
import {
  formatBytes,
  formatShape,
  formatValue,
  valueTypeName,
  tensorTypeName,
  formatScalarForEditing,
  formatArrayForEditing,
  parseScalarInput,
  parseArrayInput,
} from './value-format.mjs';

const $ = (id) => document.getElementById(id);

const el = {
  dropZone: $('drop-zone'),
  chooseFileBtn: $('choose-file-btn'),
  fileInput: $('file-input'),
  statusMessage: $('status-message'),
  editor: $('editor'),
  fileName: $('file-name'),
  summarySize: $('summary-size'),
  summaryVersion: $('summary-version'),
  summaryTensorCount: $('summary-tensor-count'),
  summaryKvCount: $('summary-kv-count'),
  summaryAlignment: $('summary-alignment'),
  exportBtn: $('export-btn'),
  resetBtn: $('reset-btn'),
  tabBtnMetadata: $('tab-btn-metadata'),
  tabBtnTensors: $('tab-btn-tensors'),
  tabMetadata: $('tab-metadata'),
  tabTensors: $('tab-tensors'),
  metadataFilter: $('metadata-filter'),
  addMetadataBtn: $('add-metadata-btn'),
  metadataTableBody: document.querySelector('#metadata-table tbody'),
  tensorFilter: $('tensor-filter'),
  tensorsTableBody: document.querySelector('#tensors-table tbody'),
  metadataDialog: $('metadata-dialog'),
  metadataDialogTitle: $('metadata-dialog-title'),
  metadataForm: $('metadata-form'),
  metadataKeyInput: $('metadata-key-input'),
  metadataTypeSelect: $('metadata-type-select'),
  metadataItemTypeField: $('metadata-item-type-field'),
  metadataItemTypeSelect: $('metadata-item-type-select'),
  metadataValueField: $('metadata-value-field'),
  metadataValueInput: $('metadata-value-input'),
  metadataValueTextarea: $('metadata-value-textarea'),
  metadataFormError: $('metadata-form-error'),
  metadataCancelBtn: $('metadata-cancel-btn'),
  wellKnownKeys: $('well-known-keys'),
  renameDialog: $('rename-dialog'),
  renameForm: $('rename-form'),
  renameInput: $('rename-input'),
  renameFormError: $('rename-form-error'),
  renameCancelBtn: $('rename-cancel-btn'),
};

/** @type {import('./gguf/parser.mjs').GGUFModel|null} */
let model = null;
let fileName = '';
let editingMetadataIndex = null; // index into model.metadata, or null when adding a new entry
let renamingTensorIndex = null;

const SCALAR_TYPES = [
  GGUFValueType.STRING,
  GGUFValueType.BOOL,
  GGUFValueType.UINT8,
  GGUFValueType.INT8,
  GGUFValueType.UINT16,
  GGUFValueType.INT16,
  GGUFValueType.UINT32,
  GGUFValueType.INT32,
  GGUFValueType.UINT64,
  GGUFValueType.INT64,
  GGUFValueType.FLOAT32,
  GGUFValueType.FLOAT64,
];
const ALL_ADDABLE_TYPES = [...SCALAR_TYPES, GGUFValueType.ARRAY];

function populateSelect(select, types) {
  select.innerHTML = '';
  for (const type of types) {
    const opt = document.createElement('option');
    opt.value = String(type);
    opt.textContent = valueTypeName(type);
    select.appendChild(opt);
  }
}

function populateWellKnownKeys() {
  el.wellKnownKeys.innerHTML = '';
  for (const key of WELL_KNOWN_KEYS) {
    const opt = document.createElement('option');
    opt.value = key;
    el.wellKnownKeys.appendChild(opt);
  }
}

function showStatus(message, kind = '') {
  el.statusMessage.textContent = message;
  el.statusMessage.className = `status-message ${kind}`.trim();
}

function setDragOver(isOver) {
  el.dropZone.classList.toggle('drag-over', isOver);
}

async function loadFile(file) {
  showStatus(`Parsing ${file.name}\u2026`);
  try {
    model = await parseGGUF(file);
    fileName = file.name;
    el.editor.hidden = false;
    el.metadataFilter.value = '';
    el.tensorFilter.value = '';
    renderAll();
    showStatus(`Loaded ${file.name}`, 'success');
  } catch (err) {
    model = null;
    el.editor.hidden = true;
    showStatus(err.message || String(err), 'error');
  }
}

function resetEditor() {
  model = null;
  fileName = '';
  el.editor.hidden = true;
  el.fileInput.value = '';
  showStatus('');
}

function renderAll() {
  renderSummary();
  renderMetadataTable();
  renderTensorsTable();
}

function renderSummary() {
  const alignment = getAlignment(model.metadata);
  el.fileName.textContent = fileName;
  el.summarySize.textContent = formatBytes(model.fileSize);
  el.summaryVersion.textContent = String(model.version);
  el.summaryTensorCount.textContent = String(model.tensors.length);
  el.summaryKvCount.textContent = String(model.metadata.length);
  el.summaryAlignment.textContent = `${alignment} bytes`;
}

function renderMetadataTable() {
  const filter = el.metadataFilter.value.trim().toLowerCase();
  el.metadataTableBody.innerHTML = '';

  const rows = model.metadata
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !filter || entry.key.toLowerCase().includes(filter));

  if (rows.length === 0) {
    const tr = document.createElement('tr');
    tr.className = 'empty-row';
    tr.innerHTML = `<td colspan="4">${model.metadata.length === 0 ? 'No metadata entries.' : 'No entries match your filter.'}</td>`;
    el.metadataTableBody.appendChild(tr);
    return;
  }

  for (const { entry, index } of rows) {
    const tr = document.createElement('tr');

    const keyTd = document.createElement('td');
    keyTd.innerHTML = `<code class="key"></code>`;
    keyTd.querySelector('code').textContent = entry.key;
    tr.appendChild(keyTd);

    const typeTd = document.createElement('td');
    const typeLabel =
      entry.type === GGUFValueType.ARRAY
        ? `ARRAY<${valueTypeName(entry.value.itemType)}>`
        : valueTypeName(entry.type);
    typeTd.innerHTML = `<span class="type-badge"></span>`;
    typeTd.querySelector('.type-badge').textContent = typeLabel;
    tr.appendChild(typeTd);

    const valueTd = document.createElement('td');
    valueTd.className = 'value-cell';
    valueTd.textContent = formatValue(entry.type, entry.value);
    tr.appendChild(valueTd);

    const actionsTd = document.createElement('td');
    actionsTd.className = 'row-actions';
    actionsTd.innerHTML = `
      <button type="button" data-action="edit-metadata" data-index="${index}">Edit</button>
      <button type="button" class="danger" data-action="delete-metadata" data-index="${index}">Delete</button>
    `;
    tr.appendChild(actionsTd);

    el.metadataTableBody.appendChild(tr);
  }
}

function renderTensorsTable() {
  const filter = el.tensorFilter.value.trim().toLowerCase();
  el.tensorsTableBody.innerHTML = '';

  const rows = model.tensors
    .map((tensor, index) => ({ tensor, index }))
    .filter(({ tensor }) => !filter || tensor.name.toLowerCase().includes(filter));

  if (rows.length === 0) {
    const tr = document.createElement('tr');
    tr.className = 'empty-row';
    tr.innerHTML = `<td colspan="6">${model.tensors.length === 0 ? 'No tensors.' : 'No tensors match your filter.'}</td>`;
    el.tensorsTableBody.appendChild(tr);
    return;
  }

  for (const { tensor, index } of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><code class="key"></code></td>
      <td><span class="type-badge"></span></td>
      <td></td>
      <td></td>
      <td></td>
      <td class="row-actions">
        <button type="button" data-action="rename-tensor" data-index="${index}">Rename</button>
      </td>
    `;
    const cells = tr.querySelectorAll('td');
    cells[0].querySelector('code').textContent = tensor.name;
    cells[1].querySelector('.type-badge').textContent = tensorTypeName(tensor.type);
    cells[2].textContent = formatShape(tensor.dims);
    cells[3].textContent = formatBytes(tensor.length);
    cells[4].textContent = tensor.fileOffset.toString();
    el.tensorsTableBody.appendChild(tr);
  }
}

// --- Metadata add/edit dialog ---------------------------------------------

function updateValueFieldVisibility() {
  const type = Number(el.metadataTypeSelect.value);
  const isArray = type === GGUFValueType.ARRAY;
  el.metadataItemTypeField.hidden = !isArray;
  el.metadataValueInput.hidden = isArray;
  el.metadataValueTextarea.hidden = !isArray;
}

function openMetadataDialogForAdd() {
  editingMetadataIndex = null;
  el.metadataDialogTitle.textContent = 'Add metadata entry';
  el.metadataFormError.textContent = '';
  el.metadataKeyInput.value = '';
  el.metadataKeyInput.disabled = false;
  populateSelect(el.metadataTypeSelect, ALL_ADDABLE_TYPES);
  populateSelect(el.metadataItemTypeSelect, SCALAR_TYPES);
  el.metadataTypeSelect.value = String(GGUFValueType.STRING);
  el.metadataValueInput.value = '';
  el.metadataValueTextarea.value = '';
  updateValueFieldVisibility();
  el.metadataDialog.showModal();
  el.metadataKeyInput.focus();
}

function openMetadataDialogForEdit(index) {
  editingMetadataIndex = index;
  const entry = model.metadata[index];
  el.metadataDialogTitle.textContent = 'Edit metadata entry';
  el.metadataFormError.textContent = '';
  el.metadataKeyInput.value = entry.key;
  el.metadataKeyInput.disabled = false;
  populateSelect(el.metadataTypeSelect, ALL_ADDABLE_TYPES);
  populateSelect(el.metadataItemTypeSelect, SCALAR_TYPES);
  el.metadataTypeSelect.value = String(entry.type);

  if (entry.type === GGUFValueType.ARRAY) {
    el.metadataItemTypeSelect.value = String(entry.value.itemType);
    el.metadataValueTextarea.value = formatArrayForEditing(entry.value);
    el.metadataValueInput.value = '';
  } else {
    el.metadataValueInput.value = formatScalarForEditing(entry.type, entry.value);
    el.metadataValueTextarea.value = '';
  }
  updateValueFieldVisibility();
  el.metadataDialog.showModal();
  el.metadataKeyInput.focus();
}

function saveMetadataForm() {
  const key = el.metadataKeyInput.value.trim();
  const type = Number(el.metadataTypeSelect.value);

  if (!key) {
    el.metadataFormError.textContent = 'Key must not be empty.';
    return false;
  }
  const duplicate = model.metadata.some((m, i) => m.key === key && i !== editingMetadataIndex);
  if (duplicate) {
    el.metadataFormError.textContent = `Key "${key}" already exists.`;
    return false;
  }

  let value;
  try {
    if (type === GGUFValueType.ARRAY) {
      const itemType = Number(el.metadataItemTypeSelect.value);
      value = parseArrayInput(itemType, el.metadataValueTextarea.value);
      if (value.items.length === 0) {
        el.metadataFormError.textContent = 'Array must contain at least one value.';
        return false;
      }
    } else {
      value = parseScalarInput(type, el.metadataValueInput.value);
    }
  } catch (err) {
    el.metadataFormError.textContent = err.message;
    return false;
  }

  const newEntry = { key, type, value };
  if (editingMetadataIndex === null) {
    model.metadata.push(newEntry);
  } else {
    model.metadata[editingMetadataIndex] = newEntry;
  }
  return true;
}

// --- Tensor rename dialog --------------------------------------------------

function openRenameDialog(index) {
  renamingTensorIndex = index;
  el.renameFormError.textContent = '';
  el.renameInput.value = model.tensors[index].name;
  el.renameDialog.showModal();
  el.renameInput.focus();
}

function saveRenameForm() {
  const name = el.renameInput.value.trim();
  if (!name) {
    el.renameFormError.textContent = 'Name must not be empty.';
    return false;
  }
  const duplicate = model.tensors.some((t, i) => t.name === name && i !== renamingTensorIndex);
  if (duplicate) {
    el.renameFormError.textContent = `A tensor named "${name}" already exists.`;
    return false;
  }
  model.tensors[renamingTensorIndex].name = name;
  return true;
}

// --- Export -----------------------------------------------------------------

function downloadExportedFile() {
  try {
    const blob = exportGGUF(model);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || 'model.gguf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    showStatus(`Exported ${a.download}`, 'success');
  } catch (err) {
    showStatus(`Failed to export: ${err.message || err}`, 'error');
  }
}

// --- Tabs --------------------------------------------------------------------

function selectTab(tab) {
  const isMetadata = tab === 'metadata';
  el.tabBtnMetadata.classList.toggle('active', isMetadata);
  el.tabBtnTensors.classList.toggle('active', !isMetadata);
  el.tabBtnMetadata.setAttribute('aria-selected', String(isMetadata));
  el.tabBtnTensors.setAttribute('aria-selected', String(!isMetadata));
  el.tabMetadata.hidden = !isMetadata;
  el.tabTensors.hidden = isMetadata;
}

// --- Event wiring --------------------------------------------------------------

function init() {
  populateWellKnownKeys();

  el.chooseFileBtn.addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', () => {
    if (el.fileInput.files[0]) loadFile(el.fileInput.files[0]);
  });

  el.dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    setDragOver(true);
  });
  el.dropZone.addEventListener('dragleave', () => setDragOver(false));
  el.dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) loadFile(file);
  });

  el.resetBtn.addEventListener('click', resetEditor);
  el.exportBtn.addEventListener('click', downloadExportedFile);

  el.tabBtnMetadata.addEventListener('click', () => selectTab('metadata'));
  el.tabBtnTensors.addEventListener('click', () => selectTab('tensors'));

  el.metadataFilter.addEventListener('input', renderMetadataTable);
  el.tensorFilter.addEventListener('input', renderTensorsTable);

  el.addMetadataBtn.addEventListener('click', openMetadataDialogForAdd);
  el.metadataTypeSelect.addEventListener('change', updateValueFieldVisibility);
  el.metadataCancelBtn.addEventListener('click', () => el.metadataDialog.close());
  el.metadataForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (saveMetadataForm()) {
      el.metadataDialog.close();
      renderSummary();
      renderMetadataTable();
    }
  });

  el.renameCancelBtn.addEventListener('click', () => el.renameDialog.close());
  el.renameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (saveRenameForm()) {
      el.renameDialog.close();
      renderTensorsTable();
    }
  });

  el.metadataTableBody.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const index = Number(btn.dataset.index);
    if (btn.dataset.action === 'edit-metadata') openMetadataDialogForEdit(index);
    if (btn.dataset.action === 'delete-metadata') {
      model.metadata.splice(index, 1);
      renderSummary();
      renderMetadataTable();
    }
  });

  el.tensorsTableBody.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const index = Number(btn.dataset.index);
    if (btn.dataset.action === 'rename-tensor') openRenameDialog(index);
  });
}

init();
