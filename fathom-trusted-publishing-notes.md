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

## Bootstrap note

`0.1.0` was bootstrapped with a manual npm publish so the package page would exist for Trusted Publisher setup.

That means:

- do not push a `v0.1.0` tag after enabling trusted publishing
- the first tag-based automated publish should be the next unreleased version, e.g. `v0.1.1`
