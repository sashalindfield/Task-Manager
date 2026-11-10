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

// The Close button just closes this window.
document.getElementById('btn-close').addEventListener('click', () => window.close());

loadTask();

console.log('[detail-window] Detail window renderer loaded.');