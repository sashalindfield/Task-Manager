const { app, BrowserWindow, Menu, dialog, ipcMain, Tray, nativeImage } = require('electron')
const path = require('node:path');
const fs   = require('node:fs');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

// ── Task data — owned by main (same as v2) ────────────────────────────────────
let nextId = 5;

const tasks = [
  { id: 1, title: 'Design dashboard screen',     priority: 'High',   status: 'In Progress' },
  { id: 2, title: 'Write unit tests for API',    priority: 'Medium', status: 'To Do'       },
  { id: 3, title: 'Update README documentation', priority: 'Low',    status: 'Done'        },
  { id: 4, title: 'Fix login bug',               priority: 'High',   status: 'To Do'       },
];

// ── Module-scope window / tray references ─────────────────────────────────────
// IMPORTANT: must be module-scope — a local variable would be GC'd silently.
let mainWindow = null;
let addWindow  = null;
let editWindow = null;  // NEW in v3
let tray       = null;  // NEW in v3 — module-scope prevents the GC footgun - GC footgun is when the tray gets garbage collected if not referenced.

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
ipcMain.handle('tasks:add', (_event, task) => {
  const newTask = {
    id:       nextId++,
    title:    task.title,
    priority: task.priority,
    status:   task.status,
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
  const idx = tasks.findIndex(t => t.id === updated.id);
  if (idx === -1) return null;
  tasks[idx] = { ...tasks[idx], ...updated };
  pushTasksToRenderer();
  return tasks[idx];
});

// Delete a task — after native confirmation dialog in main
ipcMain.handle('tasks:delete', async (_event, taskId) => {
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

  const idx = tasks.findIndex(t => t.id === taskId);
  tasks.splice(idx, 1);
  pushTasksToRenderer();
  return true;
});

// NEW FEATURE 3 Status cycle

// The order statuses move through then loop back to the start
const STATUS_ORDER = ['To Do', 'In Progress', 'Done'];

// Runs when the renderer calls window.taskAPI.cycleStatus(id)
ipcMain.handle('tasks:cycleStatus', (_event, taskId) => {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return null;

// Position of the next status
const nextIndex = (STATUS_ORDER.indexOf(task.status) + 1) % STATUS_ORDER.length;
task.status = STATUS_ORDER[nextIndex];

pushTasksToRenderer();
return task;
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
    const loaded = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
    tasks.splice(0, tasks.length, ...loaded);
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

// ── Window creation ───────────────────────────────────────────────────────────

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    title: 'Task Manager',
    icon: path.join(app.getAppPath(), 'assets', 'icon.png'), //<a href="https://www.flaticon.com/free-icons/execution" title="execution icons">Execution icons created by kliwir art - Flaticon</a>
    webPreferences: {
      contextIsolation: true,
      nodeIntegration:  false,
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
  });

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

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
    height:      380,
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
    width: 440, height: 380,
    parent: mainWindow, modal: true,
    title: 'Edit Task',
    icon: path.join(app.getAppPath(), 'assets', 'icon.png'), 
    resizable: false, minimizable: false, maximizable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration:  false,
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
              const loaded = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
              tasks.splice(0, tasks.length, ...loaded);
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
        { role: 'toggleDevTools' },
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

// Tray action: set every task's status to 'Done'.
function markAllDone() {
  tasks.forEach(t => { t.status = 'Done'; });
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
  const iconPath = path.join(app.getAppPath(), 'assets', 'icon.png');
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
