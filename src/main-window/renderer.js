import './renderer.css';

const taskList  = document.getElementById('task-list')
const emptyState = document.getElementById('empty-state')
const taskCount  = document.getElementById('task-count')
const btnAdd     = document.getElementById('btn-add')
const btnOpen    = document.getElementById('btn-open')   // NEW in v3
const btnSave    = document.getElementById('btn-save')   // NEW in v3
const btnClear   = document.getElementById('btn-clear')  // NEW FEATURE 4 the Clear All button in the header.

const filterBtns = document.querySelectorAll('.filter-btn');

console.log('Main window renderer loaded')


let activeFilter = 'all';
// NEW FEATURE 1
let priorityFilter = 'All';

// ── Render helpers ────────────────────────────────────────────────────────────

const PRIORITY_CLASS = { High: 'priority-high', Medium: 'priority-medium', Low: 'priority-low' };
const STATUS_CLASS   = { 'To Do': 'status-todo', 'In Progress': 'status-progress', Done: 'status-done' };
// NEW FEATURE 3 used only to label the button; main does the real change
const NEXT_STATUS = { 'To Do': 'In Progress', 'In Progress': 'Done', Done: 'To Do' };

// src/main-window/renderer.js
async function renderTasks(list) {
  // Use the list main just pushed, or ask main for the current one (?? = "if missing").
  const tasks = list ?? await window.taskAPI.getTasks();

  // Keep a task only if it matches BOTH the status button and the priority menu.
  const visible = tasks.filter(t =>
    (activeFilter === 'all' || t.status === activeFilter) &&
    (priorityFilter === 'All' || t.priority === priorityFilter)
  );

  // Remove all cards currently on screen.
  taskList.innerHTML = '';

  if (visible.length === 0) {
    // Nothing matches, so show the "No tasks here" message.
    emptyState.hidden = false;
  } else {
    // Hide the message and draw one card per matching task.
    emptyState.hidden = true;
    visible.forEach(task => taskList.appendChild(createTaskCard(task)));
  }

  // Footer shows the total number of tasks, not just the visible ones.
  taskCount.textContent = `${tasks.length} task${tasks.length === 1 ? '' : 's'}`;
}

function createTaskCard(task) {
  const li = document.createElement('li');
  li.className = 'task-card';
  li.dataset.id    = task.id;
  li.dataset.title = task.title;  // NEW in v3 — used by contextmenu listener

  li.innerHTML = `
    <div class="task-main">
      <span class="task-title">${escapeHtml(task.title)}</span>
      <div class="task-badges">
        <span class="badge ${PRIORITY_CLASS[task.priority]}">${task.priority}</span>
        <span class="badge ${STATUS_CLASS[task.status]}">${task.status}</span>
      </div>
    </div>
    <div class="task-actions">
      <button class="btn-action btn-cycle" data-action="cycle" data-id="${task.id}">→ ${NEXT_STATUS[task.status]}</button>
      <button class="btn-action btn-edit"   data-action="edit"   data-id="${task.id}">Edit</button>
      <button class="btn-action btn-delete" data-action="delete" data-id="${task.id}">Delete</button>
    </div>
  `;

  return li;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Filter buttons (same as v2) ───────────────────────────────────────────────
filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    window.taskAPI.saveFilter(activeFilter);
    renderTasks();
  });
});

// ── Add Task button (same as v2) ──────────────────────────────────────────────
btnAdd.addEventListener('click', () => {
  window.taskAPI.openAddWindow();
});

// ── NEW in v3 — File dialog buttons ──────────────────────────────────────────
btnOpen.addEventListener('click', () => window.taskAPI.openFile());
btnSave.addEventListener('click', () => window.taskAPI.saveFile());
btnClear.addEventListener('click', () => window.taskAPI.clearAll());

// ── NEW in v3 — Event delegation for Edit / Delete buttons ───────────────────
// One listener on the parent <ul> handles clicks for ALL cards —
// even cards that were added to the DOM after this listener was attached.
// e.target.closest() walks up from the clicked element to find the [data-action].
taskList.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const taskId = Number(btn.dataset.id);
  const action = btn.dataset.action;

  if (action === 'edit') {
    window.taskAPI.openEditWindow(taskId);
  }

  if (action === 'delete') {
    // Confirmation dialog runs in main via dialog.showMessageBox —
    // the renderer cannot call it directly (dialog is main-process only).
    await window.taskAPI.deleteTask(taskId);
    // No need to re-render here: main calls pushTasksToRenderer()
    // which triggers onTasksUpdated → renderTasks() below.
  }

  // NEW (Feature 3): the cycle button asks main to advance the status.
  if (action === 'cycle') {
    window.taskAPI.cycleStatus(taskId);
  }
});

// ── NEW in v3 — Right-click context menu ─────────────────────────────────────
// The renderer cannot call Menu.buildFromTemplate.
// We send the task id and title to main via IPC; main builds and pops up the menu.
taskList.addEventListener('contextmenu', (e) => {
  e.preventDefault();   // suppress the browser default context menu
  const card = e.target.closest('.task-card');
  if (!card) return;
  window.taskAPI.showTaskContextMenu(Number(card.dataset.id), card.dataset.title);
});

// NEW FEATURE 1 - reaat to the VIEW menu choice
window.taskAPI.onFilter((priority) => {
  priorityFilter = priority;
  renderTasks();
});

// Listen for the restoreFilter event from main and update the UI accordingly.
window.taskAPI.onRestoreFilter((filter) => {
  activeFilter = filter;
  filterBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  renderTasks();
});

// ── IPC — listen for task list updates from main (same as v2) ────────────────
window.taskAPI.onTasksUpdated((updatedTasks) => {
  renderTasks(updatedTasks);
});

// ── Load initial data ────────────────────────────────────────────────────────
// Draw the list once on startup; renderTasks() asks main for the tasks itself.
renderTasks();

console.log('[renderer] Main window renderer loaded. window.taskAPI:', window.taskAPI);
