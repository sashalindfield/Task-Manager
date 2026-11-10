// Base look (dark theme, header) is shared with the Add and Edit windows.
import '../add-window/add.css';
import './detail.css';

const detailList  = document.getElementById('detail-list');
const detailError = document.getElementById('detail-error');

// Read the task id from the page address (?id=5), which main puts there.
const taskId = Number(new URLSearchParams(window.location.search).get('id'));

// Turn Unix milliseconds into a readable date and time.
function formatTime(ms) {
  return new Date(ms).toLocaleString();
}

// Put each field on screen; textContent shows everything as plain text.
function showTask(task) {
  document.getElementById('detail-id').textContent       = task.id;
  document.getElementById('detail-title').textContent    = task.title;
  document.getElementById('detail-priority').textContent = task.priority;
  document.getElementById('detail-status').textContent   = task.status;
  document.getElementById('detail-created').textContent  = formatTime(task.createdAt);
  document.getElementById('detail-updated').textContent  = formatTime(task.updatedAt);

  // Show a grey placeholder when there are no notes.
  const notesEl = document.getElementById('detail-notes');
  notesEl.textContent = task.notes || 'No notes yet.';
  notesEl.classList.toggle('muted', !task.notes);
}

// Ask main for the task and show it, or show "Task not found".
async function loadTask() {
  const task = await window.taskAPI.getDetail(taskId);

  if (!task) {
    detailList.hidden  = true;
    detailError.hidden = false;
    return;
  }

  detailError.hidden = true;
  detailList.hidden  = false;
  showTask(task);
}

// ── Notes editing ─────────────────────────────────────────────────────────────
const notesView      = document.getElementById('notes-view');
const notesEditor    = document.getElementById('notes-editor');
const notesInput     = document.getElementById('notes-input');
const notesError     = document.getElementById('notes-error');
const btnEditNotes   = document.getElementById('btn-edit-notes');
const btnSaveNotes   = document.getElementById('btn-save-notes');
const btnCancelNotes = document.getElementById('btn-cancel-notes');

// Edit: show the textarea, filled with the task's current notes.
btnEditNotes.addEventListener('click', async () => {
  // Ask main for the latest notes so the box starts with the real value.
  const task = await window.taskAPI.getDetail(taskId);
  if (!task) return;

  notesInput.value  = task.notes;
  notesError.hidden = true;
  notesView.hidden  = true;
  notesEditor.hidden = false;
  notesInput.focus();
});

// Cancel: throw away the typing and go back; nothing is sent to main.
btnCancelNotes.addEventListener('click', () => {
  notesEditor.hidden = true;
  notesView.hidden   = false;
});

// Save: send the new notes to main, which validates and saves them.
btnSaveNotes.addEventListener('click', async () => {
  // Ignore a second click while saving.
  if (btnSaveNotes.disabled) return;

  const notes = notesInput.value;
  // Quick check here; main still does the real 500-character check.
  if (notes.length > 500) { notesError.hidden = false; return; }

  btnSaveNotes.disabled    = true;
  btnSaveNotes.textContent = 'Saving…';

  try {
    const updated = await window.taskAPI.updateNotes(taskId, notes);
    // Main returns null when it rejects the notes.
    if (!updated) throw new Error('Main rejected the notes');

    // Back to the normal view; main's push already redrew the new text.
    notesEditor.hidden = true;
    notesView.hidden   = false;
  } catch (err) {
    console.error('[detail-window] Failed to save notes:', err);
    notesError.hidden = false;
  } finally {
    btnSaveNotes.disabled    = false;
    btnSaveNotes.textContent = 'Save';
  }
});

// Redraw whenever main pushes a new list (nothing is stored here).
window.taskAPI.onTasksUpdated((tasks) => {
  // Find the task this window is showing.
  const task = tasks.find(t => t.id === taskId);
  // If it's missing, main closes this window, so there's nothing to draw.
  if (!task) return;
  detailError.hidden = true;
  detailList.hidden  = false;
  showTask(task);
});

// The Close button just closes this window.
document.getElementById('btn-close').addEventListener('click', () => window.close());

loadTask();

console.log('[detail-window] Detail window renderer loaded.');