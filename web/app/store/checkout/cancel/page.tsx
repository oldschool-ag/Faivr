export const metadata = { title: "Checkout cancelled" };

/** Where the billing provider sends the appliance owner who left the checkout without paying. Nothing was charged. */
export default function StoreCheckoutCancelPage() {
  return (
    <main style={{ maxWidth: 560, margin: "80px auto", padding: "0 24px", fontFamily: "system-ui, sans-serif", lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 24, marginBottom: 12 }}>Checkout cancelled</h1>
      <p>Nothing was charged and no subscription was started.</p>
      <p>You can close this tab. On your appliance, under Administration, Packages, Store, press Subscribe again whenever you want to continue.</p>
    </main>
  );
}
