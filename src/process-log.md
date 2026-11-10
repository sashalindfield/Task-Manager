# Part 2 Process Log

- **Created a new public GitHub repo.** The school repo is private and the update
  feed needs to be readable, so I made a new public repo on my own account.

- **Pushed the project to the new public repo.** Cloned the empty repo first, then
  realised it doesn't make sense to have a seprate local folder for the project. Instead I added it as a second remote
  (`public`) in my real project folder and pushed with `git push public HEAD:main`,
  so the school remote (`origin`) is untouched.

- **Hit a pnpm trust policy error installing the GitHub publisher.** pnpm blocked
  `@octokit/endpoint@9.0.6` ("high-risk trust downgrade") because of
  `trustPolicy: no-downgrade` in pnpm-workspace.yaml. Rather than disabling the policy,
  I added a narrow `trustPolicyExclude` entry for that one package version.

- **Read the update library docs and chose one.** electron-updater's docs say
  Squirrel.Windows is not supported (NSIS only), and our installer is Squirrel, so I
  chose Electron's built-in autoUpdater through update-electron-app. It checks on
  startup, reads the `repository` field, and needs a public repo plus Squirrel assets
  (RELEASES, *-full.nupkg, *.exe) on each GitHub Release. Set notifyUser to false so the
  renderer shows its own UI. Added the check on launch in main.js.

- **Forwarded updater events to the renderer.** In main.js, listened to autoUpdater's
  `update-available` and `update-downloaded` events and sent `update:available` and
  `update:downloaded` to the main window with webContents.send, guarding against a
  missing or destroyed window. Only the version name (a string) is sent.

- **Added the update banner and restart button.** Added a hidden banner to the main
  window HTML/CSS. The renderer shows it on `update:available` and shows a "Restart
  and install" button on `update:downloaded`. The message is set with textContent,
  and the button calls window.taskAPI.installUpdate().

- **Set up publishing credentials.** Created a fine-grained GitHub token limited to
  the Task-Manager repo with Contents read/write, 7-day expiry. Loaded it into the
  terminal session as the GITHUB_TOKEN environment variable only; it is not saved in
  any file or committed. Set `draft: false` in the publisher config so releases go
  live and the update service can find them.

- **Published version 3.0.0 to GitHub Releases.** Ran `pnpm run publish` with
  GITHUB_TOKEN set. The release v3.0.0 appears on the repo's Releases page with
  TaskManagerSetup.exe, RELEASES and the full .nupkg attached.

- **Installed 3.0.0 from the Squirrel installer.** Ran TaskManagerSetup.exe from
  out\make, quit the app after the first run (Squirrel blocks update checks on first
  launch), then reopened it from the Start menu.

- **Published version 3.0.1.** Bumped the version in package.json from 3.0.0 to 3.0.1,
  pushed to the public repo, and ran `pnpm run publish`. v3.0.1 appears on the Releases
  page with its own RELEASES and full .nupkg files.

- **Ran the live update test.** Opened the installed 3.0.0 app from the Start menu.
  It found v3.0.1 on GitHub Releases, downloaded it, and showed the banner with the
  "Restart and install" button. Clicking the button restarted the app as 3.0.1, and
  `app-3.0.1` appeared in %LOCALAPPDATA%\TaskManager.