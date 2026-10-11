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

## Release transport rules

The Store uses GitHub's per-asset `sha256:` digest as the transport checksum. If a
release checksum file also names an asset, its digest must match GitHub's digest or
the Store refuses that release. Assets with neither source are refused.

GitHub's private-release redirects normally last about 60 minutes. The Store accepts
the earlier of the signed URL's `jwt.exp` and `se` expiries through 70 minutes to
allow clock skew. It returns a fresh URL on every request and never logs or caches
the URL. The Truchsess box remains responsible for the pinned-key release-signature
verification before applying anything.
