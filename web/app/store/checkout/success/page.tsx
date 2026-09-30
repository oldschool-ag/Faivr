export const metadata = { title: "Payment received" };

/**
 * Where the billing provider sends the appliance owner after a successful bundle checkout.
 * The page carries no state and says nothing else: the appliance learns the outcome by
 * polling the lifecycle API.
 */
export default function StoreCheckoutSuccessPage() {
  return (
    <main style={{ maxWidth: 560, margin: "80px auto", padding: "0 24px", fontFamily: "system-ui, sans-serif", lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 24, marginBottom: 12 }}>Payment received</h1>
      <p>Payment received, go back to your appliance.</p>
    </main>
  );
}
