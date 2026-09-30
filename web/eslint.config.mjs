import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextCoreWebVitals,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
  {
    // T6b: the Truchsess lifecycle API is fiat through Stripe only. Escrow, the fee module,
    // the router, x402 and every chain client are frozen for it; an import here fails lint
    // before it can fail a customer. tests/company-os-frozen-boundaries.test.ts pins the same.
    files: ["app/api/company-os/**/*.ts", "lib/companyOs/**/*.ts", "app/store/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "viem", message: "The lifecycle API never touches the chain (CEO decision 2026-09-29)." },
            { name: "wagmi", message: "The lifecycle API never touches the chain (CEO decision 2026-09-29)." },
            { name: "ethers", message: "The lifecycle API never touches the chain (CEO decision 2026-09-29)." },
            { name: "@/lib/contracts", message: "Escrow, router and fee module are frozen for the lifecycle API." },
            { name: "@/lib/wagmi", message: "The lifecycle API never touches the chain (CEO decision 2026-09-29)." },
          ],
          patterns: ["viem/*", "wagmi/*", "@/hooks/useEscrow*", "@/components/escrow/*", "**/contracts/*"],
        },
      ],
    },
  },
]);
