# Company mail bundle (CEO runbook)

Create the Polar sandbox product in Polar first, then copy its product ID. With the database connection entered locally (never in a command history), create the bundle:

```sh
read -rs DATABASE_URL
export DATABASE_URL
node scripts/company-os-store-admin.mjs create-bundle --id company-mail --name "Company mail" --description "Reads company mail and writes reply drafts. Never sends." --amount-cents 14900 --polar-product <polar-product-id>
unset DATABASE_URL
```

After Penn's signed bundle is available, import it with the normal publisher command, add it to the bundle, then publish it:

```sh
read -rs DATABASE_URL
export DATABASE_URL
node scripts/import-company-os-bundle.mjs <penn.truchsess-bundle.tar>
node scripts/company-os-store-admin.mjs add-package --bundle company-mail --model-id faivr.agent.penn
node web/scripts/store-public-catalog-admin.mjs bundle-public --bundle company-mail --public true
unset DATABASE_URL
```
