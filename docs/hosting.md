# Hosting

Decided on 2026-10-18. See [Web UI design](webui-design.md) for the page itself.

## Where the page lives

On this repository's own GitHub Pages, built and published by
[`.github/workflows/pages.yml`](../.github/workflows/pages.yml):

    https://congzhangzh.github.io/freerdp-web/

That is the site's own address: the account's user site has no custom domain (one set there
would move every project site of the account under it, with a redirect). The site was
published from rdp-release-kit before (`…/rdp-release-kit/`); that address now redirects here,
on the same origin, so the browser's saved hosts, passwords and passkey vault come along.
Browser data saved while the account still had a custom domain belongs to that domain's
origin and does not appear here; export it there first if needed.

GitHub Pages serves static files only: the page, the WebAssembly client and the demo videos.
It never sees a session; the browser connects to a gateway the user starts (normally through
an SSH tunnel), or, in the installed app, to the RDP server directly.

## How the site is built

The release kit ([rdp-release-kit](https://github.com/congzhangzh/rdp-release-kit)) builds;
this repository publishes. Nothing is compiled here.

| Where | What |
|---|---|
| the kit, on each push | builds the WebAssembly client with the page commit pinned in its `sources.lock`, logs in from a browser to xrdp over SSH and websockify, and hands the tested client over as its pre-release `web-<commit>-<kit commit>`, with the xrdp packages; published once, never replaced |
| here, on each push or pull request | the page's unit tests (Node) |
| here, on publication | takes a tested client of the kit (below), lays this commit's page over it, adds the demo videos ([`media.json`](../media.json), checked), runs `test-page.mjs` on exactly these files, deploys, then logs in from the published page with that pre-release's kit test and xrdp packages |

Which client:

- **latest** (the default of a publication by hand): the kit's newest tested client, as
  [`site.sh`](../site.sh) does locally. A page change needs no kit run: about five minutes from
  *Run workflow* to the checked site. The `MANIFEST` names the client's pre-release and, on its
  last line, this page commit.
- **exact** (a `v*` tag, or chosen by hand): the client the kit built and tested with this very
  commit: the kit's newest build of it, `web-<commit>-<kit commit>` (or, from before the kit froze
  its pre-releases, `web-<commit>`), found by [`kit-release.sh`](../kit-release.sh),
  SHA-256 checked; its `MANIFEST` must name the commit. Pin the commit in the kit's `sources.lock`
  first; a commit the kit has not built cannot be published this way.

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
