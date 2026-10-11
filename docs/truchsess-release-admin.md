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

Apply the ordered migration from the repository root through the protected Store
database release path:

```sh
psql "$DATABASE_URL" -f web/sql/migrations/20261011_truchsess_release_channels.sql
```

`DATABASE_URL` must be supplied by the protected host/CI environment, not pasted
into chat or command history.

## Hold back or resume stable updates

From the repository root in the configured Store-admin environment:

```sh
node web/scripts/store-release-admin.mjs set-stable truchsess-iso-20261011-8f10bc7
node web/scripts/store-release-admin.mjs clear
```

Replace the example tag with the reviewed release you want boxes to receive.
`set-stable` pins enrolled boxes to that exact release tag. `clear` returns stable
to the newest published `truchsess-iso-*` release.

## Current upstream release blockers

The Store intentionally refuses to serve a release unless every required closure,
signature, and `.release.json` update asset has checksum-file provenance and GitHub
returns a signed download URL with valid `jwt` and `se` expiry values whose earlier
expiry is no more than ten minutes away. The currently observed release layout has a long-lived closure redirect
and lacks checksum entries for required signature/manifest assets. Fix those upstream
release artifacts before enabling this endpoint for boxes.
