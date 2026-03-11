# Fathom trusted publishing notes

This package is set up for npm trusted publishing from GitHub Actions, mirroring the Plaud pattern.

## Expected workflow files

- `.github/workflows/ci.yml`
- `.github/workflows/publish.yml`

## Expected publish trigger

- Git tag push matching `v*`
- or manual `workflow_dispatch`

## npm trusted publisher setup

In npm, configure a Trusted Publisher for the GitHub repository that will own this package.

Important details:

- workflow filename: `publish.yml`
- package name: `fathom-video-cli`
- registry: npm public registry

## Preconditions before enabling publish

- final repo URL is known and added to `package.json`
- source tree is scrubbed of live customer data
- CI is green on `main`
- package name is still available
- npm organization or personal account ownership is decided

