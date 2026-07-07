# Public Deployment

This document is public-safe deployment context for users and integrators. It intentionally omits private env var inventories, signer details, admin execution notes, and broadcast artifacts.

## Network

- Chain: Base mainnet
- Chain ID: 8453
- Public explorer: Basescan

## Canonical Contract Addresses

| Component | Address | Explorer |
|---|---|---|
| Identity Registry | `0x8D97B74fA9bFa67Db1A8Cf315dA91390612B90F6` | https://basescan.org/address/0x8D97B74fA9bFa67Db1A8Cf315dA91390612B90F6 |
| Reputation Registry | `0x00280bc9cFF156a8E8E9aE7c54029B74902a829c` | https://basescan.org/address/0x00280bc9cFF156a8E8E9aE7c54029B74902a829c |
| Validation Registry | `0x95DF02B02e2D777E0fcB80F83c061500C112F05b` | https://basescan.org/address/0x95DF02B02e2D777E0fcB80F83c061500C112F05b |
| Fee Module | `0xD68D402Bb450A79D8e639e41F0455990A223E47F` | https://basescan.org/address/0xD68D402Bb450A79D8e639e41F0455990A223E47F |
| Router | `0x7EC51888ecd3E47c6F4cF324474041790C8aB7fa` | https://basescan.org/address/0x7EC51888ecd3E47c6F4cF324474041790C8aB7fa |
| Verification Registry | `0x6654FA7d6eE8A0f6641a5535AeE346115f06e161` | https://basescan.org/address/0x6654FA7d6eE8A0f6641a5535AeE346115f06e161 |

## Notes

- The app runtime source of truth for these addresses is `web/lib/contracts.ts`.
- The contracts use UUPS upgradeability gated by onchain roles.
- Public repo and app hardening do not remediate the live protocol-admin risk described in `docs/protocol-admin-risk.md`.
- Do not treat this document as evidence that live upgrade authority is protected by a Safe or timelock.
