# Hosting

Decided on 2026-10-18; releases and the kit's pin changed on 2026-10-20 (below). See
[Web UI design](webui-design.md) for the page itself.

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
| the kit, on each push | builds the WebAssembly client with the freerdp-web release pinned in its `sources.lock` (a version and its commit), logs in from a browser to xrdp over SSH and websockify, and hands the tested client over as its pre-release `web-<YYYYMMDD>.<N>-<kit commit>` (its title names the page commit), with the xrdp packages; published once, never replaced |
| here, on each push or pull request | the page's unit tests (Node) |
| here, on publication | takes a tested client of the kit (below), lays this commit's page over it, adds the demo videos: the kit's newest `demo-*` pre-release, recorded in its CI with its newest tested client and xrdp preview, each file checked against its `SHA256SUMS` ([`fetch-media.sh`](../fetch-media.sh); [`media.json`](../media.json)'s pinned set when the kit has none), runs `test-page.mjs` on exactly these files, logs in from them with that pre-release's kit test and xrdp packages (`kit-test.sh`; once with the Asyncify build, once with JSPI), and only then deploys; then logs in again from the published page |

Which client:

- **exact** (the default): the client the kit built and tested with this very
  commit: the kit's newest build of it, `web-<YYYYMMDD>.<N>-<kit commit>` titled with it (before 21 October 2026 `web-<commit>-<kit commit>`; from before the kit froze
  its pre-releases, `web-<commit>`), found by [`kit-release.sh`](../kit-release.sh),
  SHA-256 checked; its `MANIFEST` must name the commit. The kit builds a page once it pins
  its release; a release the kit has not built cannot be published this way.
- **latest** (chosen by hand): the kit's newest tested client with this page laid over it, as
  [`site.sh`](../site.sh) does locally; for a roll-back to an old page the kit never built. The
  `MANIFEST` names the client's pre-release and, on its last line, this page commit. The login
  before the deploy still has to pass with that pair.

## Releases, and what the kit pins

The Pages belong to this repository, which publishes them itself. The release kit does not
choose page commits; it pins **freerdp-web releases**, so the page can move fast and the kit
follows on its own schedule:

1. A release is a version in `web/.well-known/manifest.webmanifest`, an annotated tag of that
   version, `<YYYYMMDD>.<N>` with no prefix (until 20261024.1 the tags were `v<version>`),
   on the commit that carries it, and a GitHub Release with its notes from
   [`CHANGELOG.md`](../CHANGELOG.md). The tag publishes nothing: it is the release the kit
   pins (since 2026-10-25; before, a tag also published the site).
2. The kit's `sources.lock` names the release as version plus commit; its CI
   (`build/check-release-pins.sh`) fails unless the release's tag exists and points to exactly
   that commit. Its upstream check watches this repository's release tags and opens an update
   issue for a new one.
3. The kit builds and tests its client with that release and hands it over as a pre-release
   (`web-<YYYYMMDD>.<N>-<kit commit>`), titled with the page commit.
4. Then the site is published from the tag, with that client ("exact", below).

So a page change and a kit change that need each other go: page on main → tag (the release;
the site is untouched) → the kit pins it, with its own change → the kit's pre-release, built and
tested with that page → publish the tag. The site only ever gets a pair the kit tested together,
and the login before the deploy checks that pair once more.

Not every version needs a release: tag the ones the kit should carry.

## Publishing is a decision, never a side effect

A push to main, a pull request or a release tag builds and tests the page, and does not
publish it. The site changes only by hand: *Run workflow* with **Use workflow from** set to a
release tag and **publish** ticked:

```sh
gh workflow run pages.yml --ref 20261025.1 -f publish=true              # client: exact
gh workflow run pages.yml --ref 20261024.1 -f publish=true -f client=latest   # a roll-back
```

A run on a branch is refused: what goes live is always a release. Before the deploy, the
`login` job logs in with the kit's test against exactly the files going live, with each build
of the client (Asyncify, JSPI); a pair that starts but cannot log in fails there, and the site
stays as it was. After the deploy, `check` logs in again from the published page.

GitHub's `github-pages` environment allows `main` and the tag patterns `[0-9]*` (releases are
named `<YYYYMMDD>.<N>`, no prefix, since 2026-10-25) and `v*` (the older releases, for a
roll-back).

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
