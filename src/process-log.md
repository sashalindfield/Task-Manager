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