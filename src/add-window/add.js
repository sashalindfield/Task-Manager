import './add.css';

const form        = document.getElementById('add-form');
const titleInput  = document.getElementById('task-title');
const titleError  = document.getElementById('title-error');
const btnCancel   = document.getElementById('btn-cancel');
const savedNotice = document.getElementById('saved-notice');

titleInput.focus();

// Async because we use await inside the submit handler.
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const btnSave = document.getElementById('btn-save');
  // Ignore a second submit while the first one is still being saved.
  if (btnSave.disabled) return;

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
  btnSave.disabled = true;
  btnSave.textContent = 'Saving…';

  try {
    // Send the task to main; await because addTask is asynchronous.
    const saved = await window.taskAPI.addTask({ title, priority, status });

    // Main returns null when it rejects the task, so treat that as a failure.
    if (!saved) throw new Error('Main rejected the task');

    // Show the success state only after main confirms the task was saved.
    form.hidden = true;
    savedNotice.hidden = false;

    // Close this window after the acknowledgement is visible.
    setTimeout(() => window.taskAPI.closeWindow(), 800);

  } catch (err) {
    console.error('[add-window] Failed to save task:', err);
    // Let the user try again.
    btnSave.disabled = false;
    btnSave.textContent = 'Save Task';
  }
});


btnCancel.addEventListener('click', () => window.close());

titleInput.addEventListener('input', () => {
  if (titleInput.value.trim()) titleError.hidden = true;
});

console.log('[add-window] Add window renderer loaded. This is renderer process #2.');