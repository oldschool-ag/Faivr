# Checkout reconciliation runbook

## What runs automatically

On every authenticated Store catalog request, FAIVR checks only that box's own checkout-pending subscriptions older than 15 minutes. A Vercel cron also processes a bounded global batch every 15 minutes. Both ask the billing provider for the checkout's current state and use the checkout, tenant, and box references together.

- `succeeded` is accepted only after the provider reports the linked subscription active (or scheduled to cancel at period end).
- `expired`, `failed`, and still-`open` unpaid checkouts past the 15-minute threshold become locally cancelled with `checkoutState: "abandoned"` and the message `Checkout not finished. Subscribe again`. This does not cancel a subscription or expire a checkout at the provider.
- `confirmed` payments still in progress, unknown states, timeouts, and provider errors remain pending. They never grant access and are not abandoned merely because they are old.
- A later paid webhook for the exact locally abandoned checkout can recover it. It does not revive a real provider cancellation or a scheduled cancellation.

The legacy `state` remains `cancelled` for abandoned checkouts so existing boxes retain their Subscribe action. `checkoutState` and `message` are additive for newer clients. A box that does not poll or does not render those fields cannot be forced to update by the Store.

## Required Vercel setting

Set `CRON_SECRET` as an encrypted environment variable in both Production and Preview as appropriate for the deployment. Vercel sends it as `Authorization: Bearer <secret>` to `/api/cron/reconcile-checkouts`. The route fails closed with 401 when the secret is absent or wrong. Do not place the secret in source, logs, command lines, or this document.
