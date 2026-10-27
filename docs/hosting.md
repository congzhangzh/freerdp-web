# Hosting

Decided on 2026-10-18; releases and the kit's pin changed on 2026-10-20; since 2026-10-27 the
release kit publishes the site (below). See [Web UI design](webui-design.md) for the page
itself.

## Where the page lives

On this repository's GitHub Pages, served from its `gh-pages` branch:

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

## Who does what

One direction: this repository holds the page's source and its releases; the release kit
([rdp-release-kit](https://github.com/congzhangzh/rdp-release-kit)) pins a release, builds,
tests, records the demos and publishes. Nothing is compiled or published here, and nothing
flows back from the kit.

| Where | What |
|---|---|
| here, on each push or pull request | the page's unit tests (Node), and `kit-release.sh`'s own test ([`.github/workflows/test.yml`](../.github/workflows/test.yml)) |
| here, a release | a version, its tag `<YYYYMMDD>.<N>` and a GitHub Release (below); the site is untouched |
| the kit, on each push | builds the WebAssembly client with the freerdp-web release pinned in its `sources.lock` (a version and its commit), logs in from a browser to xrdp over SSH and websockify, records the demo videos, and puts the tested client, the videos and its xrdp packages into its rolling release `<YYYYMMDD>.<N>` (and the client into its pre-release `web-<YYYYMMDD>.<N>-<kit commit>`, titled with the page commit); published once, never replaced |
| the kit, publishing the site (by hand) | its `site` workflow takes one of its rolling releases: the client and this page from it, the demo videos with their lasting addresses (the kit's `build/site-anchors.json`), checked against the release's `SHA256SUMS`; runs this page's `test-page.mjs` at the page's commit on exactly these files; logs in from them to the release's own xrdp (Asyncify and JSPI); only then commits them to this repository's `gh-pages` branch (a deploy key that can write here and nowhere else); then logs in again from the live site |

Until 2026-10-27 this repository published the site itself (a `pages.yml` job took the
kit's client for a tag, laid the page over it and fetched the videos), pulling the kit's
pre-releases back here: a cycle between the two repositories. Every site that went live since
then is a commit of its own in `gh-pages`, so an older one can be served again.

## Releases, and what the kit pins

The release kit does not choose page commits; it pins **freerdp-web releases**, so the page
can move fast and the kit follows on its own schedule:

1. A release is a version in `web/.well-known/manifest.webmanifest`, an annotated tag of that
   version, `<YYYYMMDD>.<N>` with no prefix (until 20261024.1 the tags were `v<version>`),
   on the commit that carries it, and a GitHub Release with its notes from
   [`CHANGELOG.md`](../CHANGELOG.md). The tag publishes nothing.
2. The kit's `sources.lock` names the release as version plus commit; its CI
   (`build/check-release-pins.sh`) fails unless the release's tag exists and points to exactly
   that commit. Its upstream check watches this repository's release tags and opens an update
   issue for a new one.
3. The kit builds and tests its client with that release, records the demos with it, and
   makes a rolling release of it all.
4. The site is published from that kit release.

So a page change and a kit change that need each other go: page on main → tag (the release;
the site is untouched) → the kit pins it, with its own change → the kit's release, built and
tested with that page → publish that kit release. The site only ever gets a pair the kit
tested together, and the login before the deploy checks that pair once more.

Not every version needs a release: tag the ones the kit should carry. A change to the tests
or the docs alone needs none.

### Making a release, step by step

1. **The version**, in one commit on main named `<YYYYMMDD>.<N>: <what changed>`: the new
   `"version"` in `web/.well-known/manifest.webmanifest` (`<N>` counts that day's releases from
   1), its section at the top of [`CHANGELOG.md`](../CHANGELOG.md) (for developers) and of
   `web/release-notes.html` (for users, in plain words). Push; CI runs the unit tests.
2. **The release**: an annotated tag on that commit and a GitHub Release with the CHANGELOG
   section as its notes. Nothing is published.

   ```sh
   git tag -a 20261027.3 -m "FreeRDP Web 20261027.3" && git push origin 20261027.3
   gh release create 20261027.3 --verify-tag --latest --title 20261027.3 -F notes.md
   ```

3. **The kit pins it**: in rdp-release-kit, the `freerdp_web` line of `sources.lock` gets the
   version and the tag's commit (with `build/pins-table.sh --readme README.md` and a CHANGELOG
   line), pushed to its main. Its CI builds the client with this page, logs in, records the
   demos, and makes its rolling release.
4. **Publish** that kit release, in rdp-release-kit (see its `docs/RELEASE.md`):

   ```sh
   gh workflow run site.yml -R congzhangzh/rdp-release-kit -f release=<kit release> -f publish=true
   ```

## Publishing is a decision, never a side effect

A push, a pull request or a release tag here tests the page and publishes nothing; so does a
push to the kit. The site changes only when the kit's `site` workflow is run by hand with
**publish** ticked. Without it the workflow runs every check and stops before the deploy. A
release whose files fail the page test or cannot log in never reaches `gh-pages`, and the site
stays as it was. A roll-back is the same run with an older kit release.

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
