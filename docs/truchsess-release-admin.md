# Truchsess stable release channel (CEO runbook)

The Store reads release metadata for enrolled Truchsess boxes from the private
`oldschool-ag/truchsess` repository. It never stores or streams the release bytes.

## GitHub token and Vercel configuration

In GitHub, open **Settings → Developer settings → Personal access tokens → Fine-grained
tokens → Generate new token**. Set the resource owner to **oldschool-ag**, select
**Only select repositories** and choose **truchsess** only. Under repository
permissions, set **Contents** to **Read-only**. Do not grant any other permission.

Copy the token directly into Vercel as the production and preview environment
variable named `TRUCHSESS_RELEASES_TOKEN`. Do not put it in Git, a shell command,
or a build log.

## Database migration

No manual SQL step is required. Every Vercel production and preview deployment runs
the Store migration runner before Next.js builds. Neon’s Vercel integration provides
the matching deployment-scoped direct URL as `DATABASE_URL_UNPOOLED`; it is never
printed. The runner verifies it targets the same Neon host, port, and database path as
`DATABASE_URL` after normalizing only Neon’s `-pooler` hostname suffix. `STORE_MIGRATIONS_DATABASE_URL`
is an optional documented override for a separately scoped direct URL and is held to
the same deployment-database check.

## Hold back or resume stable updates

From the repository root in the configured Store-admin environment:

```sh
node web/scripts/store-release-admin.mjs set-stable truchsess-iso-20261011-8f10bc7
node web/scripts/store-release-admin.mjs clear
```

Replace the example tag with the reviewed release you want boxes to receive.
`set-stable` pins enrolled boxes to that exact release tag. `clear` returns stable
to the newest published `truchsess-iso-*` release.

## GitHub release integrity and download links

Each update asset must have a valid `sha256:<64 hex digits>` digest in GitHub's
release-asset metadata. That digest supplies the response's `sha256` value.
Checksum files are optional. If a checksum file lists an update asset, every entry
for that asset must match GitHub's digest; a mismatch makes the release unavailable.
A release with GitHub digests and no checksum files can be served. Missing or
invalid GitHub digests are refused even if a checksum file lists the asset.

GitHub normally returns download links lasting about 60 minutes for large assets.
The Store accepts links with valid `jwt` and `se` expiry values whose earlier expiry
is still in the future and at most 70 minutes away. It reports that actual expiry,
without extending it or rewriting signed URLs. Expired, unverifiable, or longer-lived
links make the release unavailable. Metadata stays cached for five minutes; each
request fetches fresh download links and the response remains `private, no-store`.

The response includes the closure, its signature, the release manifest and its
signature, without ISO or checksum files. The Store never proxies update payloads
or passes its GitHub token to a box. The box must still verify each asset's digest
and the release signature before applying an update.
