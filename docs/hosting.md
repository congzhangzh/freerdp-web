# Hosting

Decided on 2026-10-18. See [Web UI design](webui-design.md) for the page itself.

## Where the page lives

GitHub Pages serves the page for free from a public repository: HTML, JavaScript and the
WASM client, nothing else. It does not run websockify, SSH or an RDP server and never
sees a session; the browser connects to a gateway the user starts (normally through an
SSH tunnel), or, in the installed app, to the RDP server directly.

| Repository | Owns |
|---|---|
| freerdp-web (this one) | the page: `web/`, its help pages, design notes |
| [rdp-release-kit](https://github.com/congzhangzh/rdp-release-kit) | the pinned build (FreeRDP + this page at a commit in `sources.lock`), the browser login test, and the GitHub Pages deployment |

The site is published from the release kit, because that is where the page and the WASM
client are built and tested together. A page is never combined with a client it was not
tested with.

The address follows the GitHub owner: `https://<owner>.github.io/<repository>/`. A
`freerdp-web.github.io` address would need a GitHub organization named `freerdp-web`;
none is assumed.

## Publishing is a decision, never a side effect

A push to main builds and tests the page, and does not publish it. The site changes only:

1. **by version**: pushing a `v*` tag of the release kit publishes the tested page of that
   tag, together with the release; or
2. **by hand**: *Run workflow* in the release kit's Actions tab with **publish** ticked
   publishes the tested page of the chosen branch or tag (for example to republish an
   older tag as a rollback).

After each publication the kit's `pages-check` job logs in from the published site, as a
user would. GitHub's `github-pages` environment must allow the tag pattern `v*` as well
as `main`, or the tag deployment is refused.

## Paths, caching and updates

- The page uses relative paths only, so it works under a project path such as
  `/rdp-release-kit/` as well as at a site root. The IWA manifest keeps its root-relative
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
