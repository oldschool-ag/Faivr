export const metadata = { title: "Subscription started" };

/**
 * Where Stripe sends the appliance owner after a successful bundle checkout. The page
 * carries no state: the appliance learns the outcome by polling the lifecycle API.
 */
export default function StoreCheckoutSuccessPage() {
  return (
    <main style={{ maxWidth: 560, margin: "80px auto", padding: "0 24px", fontFamily: "system-ui, sans-serif", lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 24, marginBottom: 12 }}>Subscription started</h1>
      <p>Thank you. Your payment was received by Stripe.</p>
      <p>You can close this tab and return to your appliance. Under Administration, Packages, Store, the bundle shows as subscribed within a minute, and Install becomes available for its packages.</p>
    </main>
  );
}
