# Company mail bundle (CEO runbook)

Run these commands from the repository root on **Node.js 24 or newer**. They are
documentation only: do not run them until Old School GmbH's publisher key is already
enrolled in the store and the Penn package has been signed.

Create the Polar **sandbox** product first, then copy its product ID. With the
database connection entered locally (never in a command history), create the bundle:

```sh
read -rs DATABASE_URL
export DATABASE_URL
node scripts/company-os-store-admin.mjs create-bundle --id company-mail --name "Company mail" --description "Reads company mail and writes reply drafts. Never sends." --amount-cents 14900 --currency chf --polar-product <polar-product-id>
unset DATABASE_URL
```

After Penn's signed bundle is available, import it with the normal publisher command.
`FAIVR_STORE_BUNDLE=company-mail` attaches the signed manifest's actual model ID; do
not invent a model ID in a separate `add-package` command. This example stores the
uploaded artifact inline. If production uses object storage instead, replace
`FAIVR_STORE_ARTIFACT_INLINE=1` with the supported `FAIVR_ARTIFACT_URL` value.

```sh
read -rs DATABASE_URL
export DATABASE_URL
FAIVR_PACKAGE_ORIGIN=https://faivr.ai FAIVR_STORE_ARTIFACT_INLINE=1 FAIVR_STORE_BUNDLE=company-mail node scripts/import-company-os-bundle.mjs <penn.truchsess-bundle.tar>
node web/scripts/store-public-catalog-admin.mjs bundle-public --bundle company-mail --public true
unset DATABASE_URL
```
