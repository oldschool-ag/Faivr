import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticatedJson, type AuthenticatedRequest } from "@/lib/companyOs/http";
import { activePublishers, StoreError, abandonBundleCheckout, billingBundle, bundleForCheckout, bundleSubscriptionRow, cancellableSubscription, catalogForAppliance, createBundleSubscription, createStoreInstallation, liveSubscription, ownerEmail, recordBundleCheckout, redeemEnrolmentCode, scheduleBundleCancellation, subscriptionViewOf } from "@/lib/companyOs/privateStore";
import { normalizePublicKeyPem, PublicKeyError } from "@/lib/companyOs/publisherKeys";
import { enrolmentRequestSchema, storeCancelSchema, storeCheckoutSchema, storeInstallationSchema } from "@/lib/companyOs/storeSchemas";
import { idempotent } from "@/lib/companyOs/store";
import { billingProvider, billingProviderFor, BillingProviderError } from "@/lib/companyOs/billing";

/**
 * The private store routes of the Truchsess lifecycle API (T6b).
 *
 * Every route but enrolment is signed by the enrolled appliance key exactly like the
 * locked V1 routes (authenticatedJson). The catalog is visible to enrolled appliances
 * only; there is no public listing, no review, no third-party publisher and no on-chain
 * call anywhere behind these handlers (tests/company-os-frozen-boundaries pins the last
 * point). Money goes through the configured billing provider (T6b.1: Polar by default,
 * Stripe as the second implementation); the appliance never sees a provider.
 */

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

function failure(error: unknown) {
  if (error instanceof StoreError) return json({ error: error.message }, error.status);
  if (error instanceof PublicKeyError) return json({ error: `public_key_invalid: ${error.message}` }, 400);
  if (error instanceof BillingProviderError) return json({ error: error.message }, error.status);
  const message = error instanceof Error ? error.message : "internal_error";
  const status = message.includes("not_configured") ? 503 : message.includes("not_found") ? 404 : message.includes("mismatch") || message.includes("reused") ? 409 : 502;
  return json({ error: message }, status);
}

function principalMismatch(auth: AuthenticatedRequest, tenantId: string, instanceId: string) {
  return tenantId !== auth.principal.tenantId || instanceId !== auth.principal.instanceId;
}

function serviceKey() {
  const publicKey = process.env.FAIVR_BILLING_SIGNING_PUBLIC_KEY?.trim();
  const keyId = process.env.FAIVR_BILLING_SIGNING_KEY_ID?.trim();
  if (!publicKey || !keyId) return null;
  try {
    return { keyId, publicKeyPem: normalizePublicKeyPem(publicKey).pem };
  } catch {
    return null;
  }
}

/** POST /api/company-os/v1/enrol: the one unsigned call, gated by a one-time enrolment code. */
export async function enrol(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const parsed = enrolmentRequestSchema.safeParse(body);
  if (!parsed.success) return json({ error: "invalid_enrolment_request" }, 400);
  try {
    const result = await redeemEnrolmentCode({ code: parsed.data.enrolmentCode, appliancePublicKeyPem: parsed.data.appliancePublicKeyPem, label: parsed.data.label });
    const publishers = await activePublishers();
    return json(
      {
        tenantId: result.tenantId,
        instanceId: result.instanceId,
        keyId: result.keyId,
        label: result.label,
        enrolledAt: result.enrolledAt,
        storeOrigin: req.nextUrl.origin,
        serviceKey: serviceKey(),
        publishers: publishers.map((publisher) => ({ keyId: publisher.keyId, publicKeyPem: publisher.publicKeyPem, publisherId: publisher.publisherId, name: publisher.name })),
      },
      201,
    );
  } catch (error) {
    return failure(error);
  }
}

/** GET /api/company-os/v1/store/catalog: the bundles and packages this appliance may install. */
export async function storeCatalog(req: NextRequest) {
  const auth = await authenticatedJson(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const provider = billingProvider();
    const bundles = await catalogForAppliance(auth.principal.tenantId, auth.principal.instanceId, { priceConfigured: (bundle) => !("error" in provider.productReference(bundle)) });
    const publishers = await activePublishers();
    return json({
      storeOrigin: req.nextUrl.origin,
      billingProvider: provider.name,
      publishers: publishers.map((publisher) => ({ keyId: publisher.keyId, publicKeyPem: publisher.publicKeyPem, publisherId: publisher.publisherId, name: publisher.name })),
      serviceKey: serviceKey(),
      bundles,
    });
  } catch (error) {
    return failure(error);
  }
}

function checkoutReturnUrls(req: NextRequest, successUrl?: string, cancelUrl?: string) {
  const origin = req.nextUrl.origin;
  return { successUrl: successUrl ?? `${origin}/store/checkout/success`, cancelUrl: cancelUrl ?? `${origin}/store/checkout/cancel` };
}

/** POST /api/company-os/v1/store/checkout-sessions: one checkout per function bundle at the configured provider. */
export async function storeCheckoutSessions(req: NextRequest) {
  const auth = await authenticatedJson(req);
  if (auth instanceof NextResponse) return auth;
  const parsed = storeCheckoutSchema.safeParse(auth.json);
  if (!parsed.success) return json({ error: "invalid_store_checkout_request", issues: parsed.error.issues }, 400);
  if (principalMismatch(auth, parsed.data.tenantId, parsed.data.instanceId)) return json({ error: "principal_mismatch" }, 403);
  try {
    const provider = billingProvider();
    return json(
      await idempotent(auth.principal.tenantId, auth.principal.idempotencyKey, "store.checkout.create", auth.bodyHash, async () => {
        const row = await bundleForCheckout(parsed.data.bundleId);
        const bundle = billingBundle(row);
        const existing = await liveSubscription(auth.principal.tenantId, bundle.id);
        if (existing && existing.subscription_state !== "checkout_pending") throw new StoreError(`subscription_exists:${existing.id}`, 409);
        const reference = provider.productReference(bundle);
        if ("error" in reference) throw new Error(reference.error);
        const created = await createBundleSubscription({ tenantId: auth.principal.tenantId, instanceId: auth.principal.instanceId, bundleId: bundle.id, provider: provider.name });
        try {
          const urls = checkoutReturnUrls(req, parsed.data.successUrl, parsed.data.cancelUrl);
          const checkout = await provider.createCheckout({
            bundle,
            subscriptionId: created.subscriptionId,
            tenantId: auth.principal.tenantId,
            instanceId: auth.principal.instanceId,
            ownerAccountId: auth.principal.tenantId,
            ownerEmail: await ownerEmail(auth.principal.tenantId),
            successUrl: urls.successUrl,
            cancelUrl: urls.cancelUrl,
          });
          await recordBundleCheckout(created.subscriptionId, checkout.checkoutId);
          return { subscriptionId: created.subscriptionId, checkoutSessionId: created.checkoutSessionId, bundleId: bundle.id, hostedUrl: checkout.url, subscriptionState: "checkout_pending", monthlyPriceCents: bundle.monthlyPriceCents, currency: bundle.currency, billingProvider: provider.name };
        } catch (error) {
          await abandonBundleCheckout(created.subscriptionId);
          throw error;
        }
      }),
      201,
    );
  } catch (error) {
    return failure(error);
  }
}

/**
 * GET /api/company-os/v1/store/subscriptions?subscriptionId=|bundleId=[&customerPortal=1]:
 * the state the provider's webhook mirrored. With `customerPortal=1` the answer also carries a
 * fresh, short-lived link to the provider's customer portal for the owner (T6b.1); the
 * appliance asks for it only when the CEO clicks "Manage subscription".
 */
export async function storeSubscriptions(req: NextRequest) {
  const auth = await authenticatedJson(req);
  if (auth instanceof NextResponse) return auth;
  const subscriptionId = req.nextUrl.searchParams.get("subscriptionId") ?? undefined;
  const bundleId = req.nextUrl.searchParams.get("bundleId") ?? undefined;
  const wantsPortal = ["1", "true", "yes"].includes((req.nextUrl.searchParams.get("customerPortal") ?? "").toLowerCase());
  if (!subscriptionId && !bundleId) return json({ error: "subscription_or_bundle_required" }, 400);
  try {
    const row = await bundleSubscriptionRow(auth.principal.tenantId, { subscriptionId, bundleId });
    if (!row) return json({ error: "subscription_not_found" }, 404);
    const view: Record<string, unknown> = subscriptionViewOf(row);
    if (wantsPortal && row.subscription_state !== "checkout_pending") {
      const portal = await billingProviderFor(row.billing_provider).customerPortalUrl({ ownerAccountId: row.tenant_id, providerCustomerId: row.provider_customer_id, returnUrl: null });
      view.customerPortalUrl = portal?.url ?? null;
      view.customerPortalExpiresAt = portal?.expiresAt ?? null;
    }
    return json({ subscription: view });
  } catch (error) {
    return failure(error);
  }
}

/** POST /api/company-os/v1/store/subscriptions/cancel: cancel a bundle nothing is installed from. */
export async function storeSubscriptionCancel(req: NextRequest) {
  const auth = await authenticatedJson(req);
  if (auth instanceof NextResponse) return auth;
  const parsed = storeCancelSchema.safeParse(auth.json);
  if (!parsed.success) return json({ error: "invalid_store_cancel_request" }, 400);
  if (principalMismatch(auth, parsed.data.tenantId, parsed.data.instanceId)) return json({ error: "principal_mismatch" }, 403);
  try {
    return json(
      await idempotent(auth.principal.tenantId, auth.principal.idempotencyKey, "store.subscription.cancel", auth.bodyHash, async () => {
        const subscription = await cancellableSubscription(auth.principal.tenantId, parsed.data.subscriptionId);
        if (!subscription.provider_subscription_id) throw new Error("billing_subscription_not_configured");
        const cancellation = await billingProviderFor(subscription.billing_provider).cancelAtPeriodEnd(subscription.provider_subscription_id, `faivr-store-cancel-${subscription.id}`);
        await scheduleBundleCancellation(subscription.id, cancellation.effectiveAt);
        return { subscriptionId: subscription.id, bundleId: subscription.bundle_id, subscriptionState: "cancel_at_period_end", effectiveAt: cancellation.effectiveAt };
      }),
    );
  } catch (error) {
    return failure(error);
  }
}

/** POST /api/company-os/v1/store/installations: an entitled installation of one package of a subscribed bundle. */
export async function storeInstallations(req: NextRequest) {
  const auth = await authenticatedJson(req);
  if (auth instanceof NextResponse) return auth;
  const parsed = storeInstallationSchema.safeParse(auth.json);
  if (!parsed.success) return json({ error: "invalid_store_installation_request", issues: parsed.error.issues }, 400);
  if (principalMismatch(auth, parsed.data.tenantId, parsed.data.instanceId)) return json({ error: "principal_mismatch" }, 403);
  try {
    return json(
      await idempotent(auth.principal.tenantId, auth.principal.idempotencyKey, "store.installation.create", auth.bodyHash, () =>
        createStoreInstallation({ tenantId: auth.principal.tenantId, instanceId: auth.principal.instanceId, bundleId: parsed.data.bundleId, modelId: parsed.data.faivrAgentModelId }),
      ),
      201,
    );
  } catch (error) {
    return failure(error);
  }
}
