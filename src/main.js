const { app, BrowserWindow, Menu, dialog, ipcMain, Tray, nativeImage, Notification } = require('electron')
const path = require('node:path');
const fs   = require('node:fs');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

// ── Task data — owned by main (same as v2) ────────────────────────────────────
let nextId = 5;

// Starting time used for the seed tasks below.
const seedTime = Date.now();

const tasks = [
  { id: 1, title: 'Design dashboard screen',     priority: 'High',   status: 'In Progress', createdAt: seedTime, updatedAt: seedTime, notes: '' },
  { id: 2, title: 'Write unit tests for API',    priority: 'Medium', status: 'To Do',       createdAt: seedTime, updatedAt: seedTime, notes: '' },
  { id: 3, title: 'Update README documentation', priority: 'Low',    status: 'Done',        createdAt: seedTime, updatedAt: seedTime, notes: '' },
  { id: 4, title: 'Fix login bug',               priority: 'High',   status: 'To Do',       createdAt: seedTime, updatedAt: seedTime, notes: '' },
];

// ── Module-scope window / tray references ─────────────────────────────────────
// IMPORTANT: must be module-scope — a local variable would be GC'd silently.
let mainWindow = null;
let addWindow  = null;
let editWindow = null;  // NEW in v3
let tray       = null;  // NEW in v3 — module-scope prevents the GC footgun - GC footgun is when the tray gets garbage collected if not referenced.

/*** V5 update - Declare the settingsPath variable for storing the path to the settings.json file ***/
//let settingsPath = path.join(app.getPath('userData'), 'settings.json');
 let settingsPath = null;
/*** v5 update - Load and save settings functions for managing the settings.json file */
  function loadSettings() {
    try {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch {
      return {};
    }
  }
  // *** V5 update - Save the settings.json file with the provided patch (updates).
  function saveSettings(patch) {
    const current = loadSettings();
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ ...current, ...patch }, null, 2)
    );
  }

// ── Helper: push current task list to the main window ─────────────────────────
function pushTasksToRenderer() {
  // NEW FEATURE 2 Refresh the tray tooltip and menu after every change
  updateTray();
  if (mainWindow) {
    mainWindow.webContents.send('tasks:updated', tasks);
  }
}

// ── IPC Handlers ──────────────────────────────────────────────────────────────

// ── Carried forward from v2 ───────────────────────────────────────────────────

// Return the full task list
ipcMain.handle('tasks:get', () => tasks);

// Open the add window
ipcMain.handle('window:open-add', () => { createAddWindow(); });

// Close the add window
ipcMain.handle('window:close-add', () => { if (addWindow) addWindow.close(); });

// Add a new task
// Validation constants for task properties
const VALID_PRIORITY = ['Low', 'Medium', 'High']
const VALID_STATUS = ['To Do','In Progress','Done']


// Task 3: an id is valid only if it is a positive whole number.
function isValidId(id) {
  return Number.isInteger(id) && id > 0;
}


// Notes are valid if they are text of 500 characters or fewer (empty is fine).
function isValidNotes(notes) {
  return typeof notes === 'string' && notes.length <= 500;
}


// Task 5: turn untrusted JSON from a file into a safe list of tasks.
function sanitizeTasks(parsed) {
  // The file must contain a list of tasks.
  if (!Array.isArray(parsed)) throw new Error('The file must contain a list of tasks.');

  const seenIds = new Set();   // remembers ids we've already accepted
  const clean = [];
  const now = Date.now();      // fallback time for files that have no timestamps

  for (const t of parsed) {
    // Skip anything that isn't an object (null, numbers, strings...).
    if (typeof t !== 'object' || t === null) continue;

    const id    = Number(t.id);
    const title = String(t.title ?? '').slice(0, 120);   // cap the length at 120

    // Skip bad ids, repeated ids, and blank titles.
    if (!isValidId(id) || seenIds.has(id) || title.trim().length === 0) continue;
    seenIds.add(id);

    const created = Number(t.createdAt);
    const updated = Number(t.updatedAt);

    // Build a NEW object from the known fields only; unknown keys are dropped.
    clean.push({
      id,
      title,
      priority:  VALID_PRIORITY.includes(t.priority) ? t.priority : 'Low',
      status:    VALID_STATUS.includes(t.status)     ? t.status   : 'To Do',
      // Keep a real timestamp from the file, otherwise use the current time.
      createdAt: Number.isFinite(created) && created > 0 ? created : now,
      updatedAt: Number.isFinite(updated) && updated > 0 ? updated : now,
      // Keep text notes (cut to 500 characters), otherwise use an empty string.
      notes:     typeof t.notes === 'string' ? t.notes.slice(0, 500) : '',
    });
  }

  return clean;
}


ipcMain.handle('tasks:add', (_event, task) => {
  // Reject anything that isn't a real object.
  if (typeof task !== 'object' || task === null) return null;

  // Notes are optional; use an empty string when none are sent.
  const notes = task.notes ?? '';

  // Validate the task object before adding it
  if (typeof task.title !== 'string' // Title must be a string  
      || task.title.trim().length === 0 // Title cannot be empty
      || task.title.length > 120 // Maximum title length is 120 characters
      || !VALID_PRIORITY.includes(task.priority) // Priority must be one of the valid options
      || !VALID_STATUS.includes(task.status) // Status must be one of the valid options
      || !isValidNotes(notes)) // Notes must be text of 500 characters or fewer
    return null

  // One timestamp so createdAt and updatedAt match on a new task.
  const now = Date.now();

  const newTask = {
    id:        nextId++,
    title:     task.title,
    priority:  task.priority,
    status:    task.status,
    createdAt: now,   // set by main only, never taken from the renderer
    updatedAt: now,   // set by main only, never taken from the renderer
    notes,
  };
  tasks.push(newTask);
  pushTasksToRenderer();
  return newTask;
});

// ── NEW in v3 — Edit / Delete ─────────────────────────────────────────────────

// Open the edit window for a specific task
ipcMain.handle('window:open-edit', (_event, taskId) => {
  createEditWindow(taskId);
});

// Close the edit window
ipcMain.handle('window:close-edit', () => { if (editWindow) editWindow.close(); });

// Return a single task by id (used by the edit window to pre-fill the form)
ipcMain.handle('tasks:getOne', (_event, taskId) => {
  return tasks.find(t => t.id === taskId) || null;
});

// Save edits to an existing task
ipcMain.handle('tasks:update', (_event, updated) => {
  // Reject anything that isn't a real object (null, a string, etc.).
  if (typeof updated !== 'object' || updated === null) return null;

  // The id must be a positive whole number.
  if (!Number.isInteger(updated.id) || updated.id <= 0) return null;

  // The task must actually exist in the array.
  const idx = tasks.findIndex(t => t.id === updated.id);
  if (idx === -1) return null;

  // Notes are optional here: keep the current notes if none are sent.
  const notes = updated.notes === undefined ? tasks[idx].notes : updated.notes;

  // Same field checks as tasks:add.
  if (typeof updated.title !== 'string'            // title must be text
      || updated.title.trim().length === 0         // and not blank
      || updated.title.length > 120                // and at most 120 characters
      || !VALID_PRIORITY.includes(updated.priority) // priority must be an allowed value
      || !VALID_STATUS.includes(updated.status)     // status must be an allowed value
      || !isValidNotes(notes))                      // notes must be 500 characters or fewer
    return null;

  // Copy only the known fields by hand, never spread the incoming object.
  tasks[idx] = {
    id:        tasks[idx].id,          // keep the id we already have
    title:     updated.title,
    priority:  updated.priority,
    status:    updated.status,
    createdAt: tasks[idx].createdAt,   // never changes after creation
    updatedAt: Date.now(),             // set by main on every edit
    notes,
  };

  pushTasksToRenderer();
  return tasks[idx];
});

// Delete a task — after native confirmation dialog in main
ipcMain.handle('tasks:delete', async (_event, taskId) => {
  // Reject ids that aren't positive whole numbers.
  if (!isValidId(taskId)) return false;

  // The task must exist before we ask the user anything.
  const task = tasks.find(t => t.id === taskId);
  if (!task) return false;

  // dialog.showMessageBox runs in main (dialog module is main-process only)
  const result = await dialog.showMessageBox(mainWindow, {
    type:      'warning',
    title:     'Delete Task',
    message:   `Delete "${task.title}"?`,
    detail:    'This action cannot be undone.',
    buttons:   ['Delete', 'Cancel'],
    defaultId: 1,   // Cancel is the safe default — Enter key triggers it
    cancelId:  1,   // Esc key also maps to Cancel
  });

  if (result.response !== 0) return false;   // 0 = Delete button

  // Look the task up again: it may have been removed while the dialog was open.
  const idx = tasks.findIndex(t => t.id === taskId);
  // splice(-1, 1) would delete the LAST task, so stop if it's gone.
  if (idx === -1) return false;

  tasks.splice(idx, 1);
  pushTasksToRenderer();
  return true;
});

// NEW FEATURE 3 Status cycle

// The order statuses move through then loop back to the start
const STATUS_ORDER = ['To Do', 'In Progress', 'Done'];

// Runs when the renderer calls window.taskAPI.cycleStatus(id).
ipcMain.handle('tasks:cycleStatus', (_event, taskId) => {
  // Reject ids that aren't positive whole numbers.
  if (!isValidId(taskId)) return null;

  // Find the task with this id; do nothing if it doesn't exist.
  const task = tasks.find(t => t.id === taskId);
  if (!task) return null;

  // Position of the next status; the % wraps Done back around to To Do.
  const nextIndex = (STATUS_ORDER.indexOf(task.status) + 1) % STATUS_ORDER.length;
  // Set the new status.
  task.status = STATUS_ORDER[nextIndex];
    // Record when this change happened.
  task.updatedAt = Date.now();

  // Only notify when the task has just become Done.
  if (task.status === 'Done') {
    // Keep only the first 80 characters of the title (Task 1).
    new Notification({ title: 'Task complete', body: task.title.slice(0, 80) }).show();
  }

  // Send the updated list to the renderer (this also updates the tray).
  pushTasksToRenderer();
  return task;
});

// NEW FEATURE 4 — Clear all tasks 
ipcMain.handle('tasks:clearAll', async () => {
  // Show the confirmation popup and wait for the user's answer.
  const result = await dialog.showMessageBox(mainWindow, {
    type:      'warning',
    title:     'Clear All Tasks',
    message:   'Clear all tasks?',
    detail:    'This action cannot be undone.',
    buttons:   ['Clear All', 'Cancel'],
    defaultId: 1,   // Enter key picks Cancel.
    cancelId:  1,   // Esc key picks Cancel.
  });

  // Button 0 is 'Clear All'; anything else means stop.
  if (result.response !== 0) return false;

  // Empty the array in place (same array, no items left).
  tasks.splice(0, tasks.length);
  // Send the empty list to the renderer (this also updates the tray).
  pushTasksToRenderer();
  return true;
});

// ── NEW in v3 — Context menu on a task card ───────────────────────────────────
// The renderer CANNOT call Menu.buildFromTemplate directly (renderer-process
// restriction). It invokes this handler; main builds the menu and calls
// menu.popup() — different from Menu.setApplicationMenu() which replaces the
// global menu bar.
ipcMain.handle('menu:showTaskContext', (_event, taskId, taskTitle) => {
  const menu = Menu.buildFromTemplate([
    {
      label: 'Edit Task',
      click: () => { createEditWindow(taskId); }
    },
    { type: 'separator' },
    {
      label: `Delete "${taskTitle}"`,
      click: async () => {
        const result = await dialog.showMessageBox(mainWindow, {
          type:      'warning',
          title:     'Delete Task',
          message:   `Delete "${taskTitle}"?`,
          detail:    'This action cannot be undone.',
          buttons:   ['Delete', 'Cancel'],
          defaultId: 1,
          cancelId:  1,
        });
        if (result.response === 0) {
          const idx = tasks.findIndex(t => t.id === taskId);
          if (idx !== -1) {
            tasks.splice(idx, 1);
            pushTasksToRenderer();
          }
        }
      }
    },
  ]);

  // popup() positions the menu under the cursor in the window.
  // setApplicationMenu() would replace the entire menu bar — NOT what we want here.
  menu.popup({ window: mainWindow });
});

// ── NEW in v3 — File dialogs ──────────────────────────────────────────────────

// Open a JSON file and load tasks from it
ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return false;
  try {
       const parsed = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
    // Task 5: only load tasks that pass the allowlist.
    const clean = sanitizeTasks(parsed);
    tasks.splice(0, tasks.length, ...clean);
    nextId = Math.max(...tasks.map(t => t.id), 0) + 1;
    pushTasksToRenderer();
    return true;
  } catch (err) {
    dialog.showMessageBox(mainWindow, {
      type: 'error', message: 'Could not read file', detail: err.message,
    });
    return false;
  }
});

// Save current tasks to a JSON file
ipcMain.handle('dialog:saveFile', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: 'tasks.json',
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return false;
  try {
    fs.writeFileSync(result.filePath, JSON.stringify(tasks, null, 2), 'utf8');
    return true;
  } catch (err) {
    dialog.showMessageBox(mainWindow, {
      type: 'error', message: 'Could not save file', detail: err.message,
    });
    return false;
  }
});

ipcMain.on('settings:saveFilter', (_event, filter) => {
  saveSettings({activeFilter: filter});
});


// ── Window creation ───────────────────────────────────────────────────────────

const createWindow = () => {
  const saved = loadSettings().windowState || {};
mainWindow = new BrowserWindow({
  
    width: saved.width || 800, // *** v5 update - use saved width if available, otherwise default to 800
    height: saved.height || 600, // *** v5 update - use saved height if available, otherwise default to 600
    x: saved.x, // *** v5 update - undefined = OS places the window
    y: saved.y, // *** v5 update
    title: 'Task Manager',
    icon: path.join(app.getAppPath(), 'assets', 'icon.png'), //<a href="https://www.flaticon.com/free-icons/execution" title="execution icons">Execution icons created by kliwir art - Flaticon</a>
    webPreferences: {
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox: true,
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
  });

  //***v5 update - save window state on resize and move */
  function saveWindowState() {
    if (!mainWindow || mainWindow.isMinimized()) return;
    const { x, y, width, height } = mainWindow.getBounds();
    saveSettings({ windowState: { x, y, width, height } });
  }
  /***v5 update:agttach saveWindowState to events */
  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move',   saveWindowState);

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  mainWindow.webContents.on('did-finish-load', () => {
  pushTasksToRenderer();

  // Push saved filter to renderer
  const settings = loadSettings();
  if (settings.activeFilter) {
    mainWindow.webContents.send('tasks:restoreFilter', settings.activeFilter);
  }
});

  // NEW in v3: 'close' fires BEFORE the window closes — we can cancel it
  // and hide to tray instead of quitting.
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();  // cancel the close
      mainWindow.hide();        // hide to tray
    }
  });

  // 'closed' fires AFTER the window is destroyed — null the reference.
  // (Same pattern as v2, but now meaningful because hide-to-tray keeps
  // the window alive most of the time.)
  mainWindow.on('closed', () => { mainWindow = null; });
};

function createAddWindow() {
  if (addWindow) { addWindow.focus(); return; }

  addWindow = new BrowserWindow({
    width:       440,
    height:      520,
    parent:      mainWindow,
    modal:       true,
    title:       'Add Task',
    icon: path.join(app.getAppPath(), 'assets', 'icon.png'), 
    resizable:   false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox: true,
      preload: ADD_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
  });

  addWindow.loadURL(ADD_WINDOW_WEBPACK_ENTRY);
  addWindow.on('closed', () => { addWindow = null; });
}

// NEW in v3: Edit window — pre-filled form for an existing task
function createEditWindow(taskId) {
  if (editWindow) { editWindow.focus(); return; }

  editWindow = new BrowserWindow({
    width: 440, height: 520,
    parent: mainWindow, modal: true,
    title: 'Edit Task',
    icon: path.join(app.getAppPath(), 'assets', 'icon.png'), 
    resizable: false, minimizable: false, maximizable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox: true,
      preload: EDIT_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
  });

  editWindow.loadURL(EDIT_WINDOW_WEBPACK_ENTRY);

  editWindow.webContents.on('did-finish-load', () => {
    const task = tasks.find(t => t.id === taskId);
    editWindow.webContents.send('edit:loadTask', task);
  });

  editWindow.on('closed', () => { editWindow = null; });
}

// NEW FEATURE 1 - Priority filter click handler
function onPriorityFilterClick(menuItem) {
  if (mainWindow) {
    mainWindow.webContents.send('tasks:filter', menuItem.label);
  }
}

// ── App menu ──────────────────────────────────────────────────────────────────
function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label:       'Add Task',
          accelerator: 'CmdOrCtrl+N',
          click:       () => createAddWindow(),
        },
        { type: 'separator' },
        {
          label:       'Open Tasks…',    // NEW in v3
          accelerator: 'CmdOrCtrl+O',
          click:       () => ipcMain.emit('dialog:openFile'),
          // Trigger via the same IPC handler so the logic lives in one place
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openFile'],
              filters: [{ name: 'JSON Files', extensions: ['json'] }],
            });
            if (result.canceled || result.filePaths.length === 0) return;
            try {
                            const parsed = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
              // Task 5: only load tasks that pass the allowlist.
              const clean = sanitizeTasks(parsed);
              tasks.splice(0, tasks.length, ...clean);
              nextId = Math.max(...tasks.map(t => t.id), 0) + 1;
              pushTasksToRenderer();
            } catch (err) {
              dialog.showMessageBox(mainWindow, {
                type: 'error', message: 'Could not read file', detail: err.message,
              });
            }
          },
        },
        {
          label:       'Save Tasks…',    // NEW in v3
          accelerator: 'CmdOrCtrl+S',
          click: async () => {
            const result = await dialog.showSaveDialog(mainWindow, {
              defaultPath: 'tasks.json',
              filters: [{ name: 'JSON Files', extensions: ['json'] }],
            });
            if (result.canceled || !result.filePath) return;
            fs.writeFileSync(result.filePath, JSON.stringify(tasks, null, 2), 'utf8');
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools', visible: !app.isPackaged },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        // NEW FEATURE 1 line separating the filter from the zoom items
        {type: 'separator'},
        {
       label: 'Filter by Priority',
          submenu: [
            // 'radio' = only one can be selected; All starts checked.
            // All four share the same click handler from step 1a.
            { label: 'All',    type: 'radio', checked: true, click: onPriorityFilterClick },
            { label: 'High',   type: 'radio',                 click: onPriorityFilterClick },
            { label: 'Medium', type: 'radio',                 click: onPriorityFilterClick },
            { label: 'Low',    type: 'radio',                 click: onPriorityFilterClick },
          ],
        },
      ],
    },
  ];

  if (process.platform === 'darwin') {
    template.unshift({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// NEW Feature 2 — Tray helpers / Note - Got stuck on several parts of this piece and did have to use AI for help.

// Count the tasks whose status is not 'Done'.
function countIncomplete() {
  return tasks.filter(t => t.status !== 'Done').length;
}

// Use the main window as the dialog parent only if it is visible.
function getDialogParent() {
  return mainWindow && mainWindow.isVisible() ? mainWindow : null;
}

//Bonus A confirm on mark all done
// Tray action: confirm first, then set every task's status to 'Done'.
async function markAllDone() {
  // Show the confirmation popup and wait for the user's answer.
  const result = await dialog.showMessageBox(getDialogParent(), {
    type:      'question',
    title:     'Mark All Done',
    message:   'Mark all tasks as Done?',
    detail:    'Every task will be set to Done.',
    buttons:   ['Mark All Done', 'Cancel'],
    defaultId: 1,   // Enter key picks Cancel.
    cancelId:  1,   // Esc key picks Cancel.
  });

  // Button 0 is 'Mark All Done'; anything else means stop.
  if (result.response !== 0) return;

  // Set every task's status to Done, and record the change time on the ones that changed.
  const now = Date.now();
  tasks.forEach(t => {
    if (t.status !== 'Done') {
      t.status = 'Done';
      t.updatedAt = now;
    }
  });
  // Push the change to the renderer (this also updates the tray).
  pushTasksToRenderer();
}

// Tray action: confirm first, then remove all 'Done' tasks.
async function clearDoneTasks() {
  const result = await dialog.showMessageBox(getDialogParent(), {
    type:      'warning',
    title:     'Clear Done Tasks',
    message:   'Remove all completed tasks?',
    detail:    'This action cannot be undone.',
    buttons:   ['Clear Done', 'Cancel'],
    defaultId: 1,   // Enter key picks Cancel.
    cancelId:  1,   // Esc key picks Cancel.
  });

  // Button 0 is 'Clear Done'; anything else means stop.
  if (result.response !== 0) return;

  // Keep only the tasks that are not Done.
  const remaining = tasks.filter(t => t.status !== 'Done');
  // Swap the array contents in place (same array object, new contents).
  tasks.splice(0, tasks.length, ...remaining);
  pushTasksToRenderer();
}

// Refresh the tray tooltip and rebuild its right-click menu.
function updateTray() {
  // The tray does not exist yet during startup, so do nothing.
  if (!tray) return;

  const incomplete = countIncomplete();

  // Tooltip shown when hovering over the tray icon.
  tray.setToolTip(`Task Manager — ${incomplete} incomplete`);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Tasks',
      click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } },
    },
    { type: 'separator' },
    // Greyed out when every task is already Done.
    { label: 'Mark All Done',    enabled: incomplete > 0,                       click: markAllDone },
    // Greyed out when there are no Done tasks to remove.
    { label: 'Clear Done Tasks', enabled: tasks.some(t => t.status === 'Done'), click: clearDoneTasks },
    { type: 'separator' },
    { role: 'quit' },
  ]);

  // Replace the old menu so it matches the current tasks.
  tray.setContextMenu(contextMenu);
}

function createTray() {
  // Build the tray icon from the assets folder.
  //const iconPath = path.join(app.getAppPath(), 'assets', 'icon.png');
  const iconPath = path.join(process.resourcesPath, 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);

  // Keep it in the module-level variable so it isn't garbage collected.
  tray = new Tray(icon);

  // Set the first tooltip and menu.
  updateTray();

  // Double-clicking the tray icon shows the main window.
  tray.on('double-click', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {

  settingsPath = path.join(app.getPath('userData'), 'settings.json');
  console.log('settings path:', settingsPath);
  buildMenu();
  createWindow();
  createTray();   // NEW in v3

  // macOS: re-open the window when the Dock icon is clicked
  app.on('activate', () => {
    if (mainWindow === null) {
      createWindow();
    } else {
      mainWindow.show();
    }
  });
saveSettings({test: true}); //v4

  console.log(loadSettings());//v4
});


// Windows / Linux: quit when the last window closes.
// macOS: the app stays alive (Dock icon remains; 'activate' re-opens it).
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// NEW in v3: signal the 'close' handler that we really are quitting,
// so it doesn't intercept and hide the window to tray again.
app.on('before-quit', () => {
  app.isQuitting = true;
  if (tray) tray.destroy();
});
