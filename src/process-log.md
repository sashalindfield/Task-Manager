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