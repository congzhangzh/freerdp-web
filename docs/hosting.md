# Hosting

Decided on 2026-10-18. See [Web UI design](webui-design.md) for the page itself.

## Where the page lives

On this repository's own GitHub Pages, built and published by
[`.github/workflows/pages.yml`](../.github/workflows/pages.yml):

    https://congzhangzh.github.io/freerdp-web/

The owner's user site has a custom domain, and GitHub then serves every project site of the
account under it: that address answers with a redirect to the same path on that domain.
The site was published from rdp-release-kit before (`…/rdp-release-kit/`); that address now
redirects here. Both are on the same origin, so the browser's saved hosts, passwords and
passkey vault are still there after the move.

GitHub Pages serves static files only: the page, the WebAssembly client and the demo videos.
It never sees a session; the browser connects to a gateway the user starts (normally through
an SSH tunnel), or, in the installed app, to the RDP server directly.

## How the site is built

| Step | What |
|---|---|
| the client | the release kit at the commit in [`kit.lock`](../kit.lock) builds FreeRDP for WebAssembly with this page (`PAGE_SRC`, `PAGE_REV`: the `MANIFEST` names this commit) |
| the demo videos | [`fetch-media.sh`](../fetch-media.sh) downloads them from the `demo-media-1` release, checks their SHA-256 ([`media.json`](../media.json)); not in git |
| tests | `test-page.mjs` (the page with the client, no server) and the kit's login test: xrdp in a throwaway container, over SSH and websockify |
| publication | only on purpose, see below; then the `check` job logs in from the published page |

A page is never published with a client it was not tested with: both come from the same run.

## Publishing is a decision, never a side effect

A push to main or a pull request builds and tests the page, and does not publish it. The site
changes only:

1. **by version**: pushing a `v*` tag publishes that tag's tested page; or
2. **by hand**: *Run workflow* with **publish** ticked publishes the tested page of the chosen
   branch or tag (for example an older tag, to roll back).

GitHub's `github-pages` environment allows `main` and the tag pattern `v*`.

## Paths, caching and updates

- The page uses relative paths only, so it works under a project path such as
  `/freerdp-web/` as well as at a site root. The IWA manifest keeps its root-relative
  `id` and `start_url`, which the installed app needs.
- GitHub Pages cannot send COOP/COEP headers; `coi-serviceworker.js` adds them so the
  client's threads work. It caches nothing.
- Pages decides its own cache headers; a published page may take a few minutes to reach
  every visitor. An open session keeps running the code it started with; the next reload
  gets the new version. The running version is shown in the session's Info panel.
- Passwords saved by the browser, the passkey vault and the installed app belong to the
  site's origin. Moving to another address starts with empty storage there; the vault has
  no export.

## Local preview

`serve.py` (or any static server) serves a local build for testing. Its cache headers
apply only to that local server, not to GitHub Pages.
