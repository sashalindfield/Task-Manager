// Reuse the same CSS as the add window (dark theme, identical form layout)
import '../add-window/add.css';

const form       = document.getElementById('edit-form');
const titleInput = document.getElementById('task-title');
const titleError = document.getElementById('title-error');
const btnCancel  = document.getElementById('btn-cancel');


let currentTaskId = null;   

// ── Pre-fill the form with the existing task data ─────────────────────────────
window.taskAPI.onLoadTask((task) => {
  currentTaskId = task.id;  // store it here
  titleInput.value = task.title;
  document.getElementById('task-priority').value = task.priority;
  document.getElementById('task-status').value   = task.status;
  titleInput.focus();
  titleInput.select();
});

// ── Save changes ──────────────────────────────────────────────────────────────
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const btnSave = document.getElementById('btn-save');
  // Ignore a second submit while the first one is still being saved.
  if (btnSave.disabled) return;

  // The task hasn't loaded yet, so there is nothing to save.
  if (currentTaskId === null) return;

  const title    = titleInput.value.trim();
  const priority = document.getElementById('task-priority').value;
  const status   = document.getElementById('task-status').value;

  // The title must not be blank after trimming.
  if (!title) {
    titleError.hidden = false;
    titleInput.focus();
    return;
  }
  titleError.hidden = true;

  // Both dropdowns must have a value (novalidate turns off the browser check).
  if (!priority || !status) return;

  // Disable the save button while the IPC call is in flight.
  btnSave.disabled    = true;
  btnSave.textContent = 'Saving…';

  try {
    const updated = await window.taskAPI.updateTask({
      id: currentTaskId,
      title,
      priority,
      status,
    });

    // Main returns null when it rejects the update, so treat that as a failure.
    if (!updated) throw new Error('Main rejected the update');

    // Main has saved and pushed the new list; close so the user sees it.
    setTimeout(() => window.taskAPI.closeWindow(), 200);

  } catch (err) {
    console.error('[edit-window] Failed to update task:', err);
    // Let the user try again.
    btnSave.disabled    = false;
    btnSave.textContent = 'Save Changes';
  }
});

btnCancel.addEventListener('click', () => window.taskAPI.closeWindow());

titleInput.addEventListener('input', () => {
  if (titleInput.value.trim()) titleError.hidden = true;
});

console.log('[edit-window] Edit window renderer loaded.');
