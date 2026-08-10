import { http, createConfig } from "wagmi";
import { base } from "wagmi/chains";
import { injected } from "wagmi/connectors/injected";

export const config = createConfig({
  chains: [base],
  connectors: [injected()],
  transports: {
    [base.id]: http("https://mainnet.base.org"),
  },
});
