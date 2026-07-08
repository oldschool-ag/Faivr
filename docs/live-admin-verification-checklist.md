# Live Admin Verification Checklist

This checklist is read-only. It proves current onchain posture only when an operator runs it against Base mainnet, archives the evidence, and records the result in release notes. It does not migrate roles, configure a Safe, configure a timelock, or enable monitoring.

## Inputs

- RPC: Base mainnet RPC URL.
- Block range: from each proxy deployment block through the verification block.
- Verification block: record the exact block number used for all final reads.
- Contract addresses:
  - Identity Registry: `0x8D97B74fA9bFa67Db1A8Cf315dA91390612B90F6`
  - Reputation Registry: `0x00280bc9cFF156a8E8E9aE7c54029B74902a829c`
  - Validation Registry: `0x95DF02B02e2D777E0fcB80F83c061500C112F05b`
  - Fee Module: `0xD68D402Bb450A79D8e639e41F0455990A223E47F`
  - Router: `0x7EC51888ecd3E47c6F4cF324474041790C8aB7fa`
  - Verification Registry: `0x6654FA7d6eE8A0f6641a5535AeE346115f06e161`

## Roles To Prove

`DEFAULT_ADMIN_ROLE` is `0x0000000000000000000000000000000000000000000000000000000000000000` on every contract.

Non-default privileged roles:

| Contract | Role | Role ID |
| --- | --- | --- |
| Identity Registry | `REGISTRAR_ROLE` | `0xedcc084d3dcd65a1f7f23c65c46722faca6953d28e43150a467cf43e5c309238` |
| Reputation Registry | `FEEDBACK_ROUTER_ROLE` | `0x81d9bc03991480f94867aa0a2a3c97aebda18682f3bd91835802788566b1b7a8` |
| Reputation Registry | `SETTLEMENT_SOURCE_ROLE` | `0x05852396b96cc8b3a6ae6630424e6fb195a6d71dbb2ef7fafc3153d5e94a209b` |
| Validation Registry | none currently defined | n/a |
| Fee Module | `FEE_MANAGER_ROLE` | `0x6c0757dc3e6b28b2580c03fd9e96c274acf4f99d91fbec9b418fa1d70604ff1c` |
| Fee Module | `PAUSER_ROLE` | `0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a` |
| Fee Module | `ROUTER_ROLE` | `0x7a05a596cb0ce7fdea8a1e1ec73be300bdb35097c944ce1897202f7a13122eb2` |
| Router | none currently defined | n/a |
| Verification Registry | `VERIFIER_ROLE` | `0x0ce23c3e399818cfee81a7ab0880f714e53d7672b08df0fa62f2843416e1ea09` |

## Holder Reconstruction

OpenZeppelin `AccessControlUpgradeable` is not enumerable in these contracts. Do not claim "all holders" from `hasRole` checks alone.

For each contract and role:

1. Export `RoleGranted(bytes32,address,address)`, `RoleRevoked(bytes32,address,address)`, and `RoleAdminChanged(bytes32,bytes32,bytes32)` logs from deployment block through the verification block.
2. Sort by block number, transaction index, and log index.
3. Build the final holder set by applying grants and revokes for that role.
4. Verify every final holder with `hasRole(role, holder)`.
5. Also verify every expected Safe, EOA, router, fee module, and operations address even if it is missing from the reconstructed set.
6. Archive the raw logs, final holder table, and every `hasRole` read.

Command shape:

```bash
export BASE_RPC_URL=<base-mainnet-rpc>
export FROM_BLOCK=<proxy-deployment-block>
export TO_BLOCK=<verification-block-or-latest>
export CONTRACT=<contract-address>
export ROLE=<role-id>
export ACCOUNT=<candidate-address>

cast logs --rpc-url "$BASE_RPC_URL" --from-block "$FROM_BLOCK" --to-block "$TO_BLOCK" --address "$CONTRACT" 'RoleGranted(bytes32,address,address)' "$ROLE"
cast logs --rpc-url "$BASE_RPC_URL" --from-block "$FROM_BLOCK" --to-block "$TO_BLOCK" --address "$CONTRACT" 'RoleRevoked(bytes32,address,address)' "$ROLE"
cast logs --rpc-url "$BASE_RPC_URL" --from-block "$FROM_BLOCK" --to-block "$TO_BLOCK" --address "$CONTRACT" 'RoleAdminChanged(bytes32,bytes32,bytes32)' "$ROLE"
cast call "$CONTRACT" 'hasRole(bytes32,address)(bool)' "$ROLE" "$ACCOUNT" --rpc-url "$BASE_RPC_URL" --block "$TO_BLOCK"
```

You can use `contracts/script/AdminRoleReadiness.s.sol` to confirm known candidate EOAs and Safes. Its output is supplementary; it does not replace log reconstruction.

```bash
cd contracts
CURRENT_ADMIN=<candidate-eoa> TARGET_SAFE=<safe-address> EXTRA_CANDIDATE=<optional-address> \
  forge script script/AdminRoleReadiness.s.sol:AdminRoleReadiness --rpc-url "$BASE_RPC_URL"
```

## ERC1967 Slot Reads

Read these slots for every proxy:

- Implementation slot: `0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc`
- Admin slot: `0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103`

```bash
cast storage "$CONTRACT" 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc --rpc-url "$BASE_RPC_URL" --block "$TO_BLOCK"
cast storage "$CONTRACT" 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103 --rpc-url "$BASE_RPC_URL" --block "$TO_BLOCK"
```

Archive raw slot values and decoded addresses. For UUPS proxies, a zero ERC1967 admin slot does not prove there is no upgrade authority; upgrade authority is controlled by the implementation's `_authorizeUpgrade` role checks.

## Safe Control Proof

Safe control is proven only if the controlling admin address is a Safe and the relevant roles resolve to that Safe or to a timelock that the Safe controls.

For each admin Safe:

```bash
export SAFE=<safe-address>

cast code "$SAFE" --rpc-url "$BASE_RPC_URL" --block "$TO_BLOCK"
cast call "$SAFE" 'getOwners()(address[])' --rpc-url "$BASE_RPC_URL" --block "$TO_BLOCK"
cast call "$SAFE" 'getThreshold()(uint256)' --rpc-url "$BASE_RPC_URL" --block "$TO_BLOCK"
cast call "$SAFE" 'nonce()(uint256)' --rpc-url "$BASE_RPC_URL" --block "$TO_BLOCK"
```

Archive Safe address, code-present evidence, owners, threshold, nonce, and `hasRole(DEFAULT_ADMIN_ROLE, SAFE)` evidence for every governed contract. If any EOA still holds `DEFAULT_ADMIN_ROLE`, mark the release as an onchain verification gap or disclose the EOA as intentionally retained.

## Timelock Proof

Timelock status must be explicit: `live`, `absent/deferred`, or `not applicable`.

To mark `live`, archive all of the following:

- timelock address and code-present evidence;
- timelock minimum delay, using `getMinDelay()(uint256)` for OpenZeppelin TimelockController-compatible contracts;
- proof that upgrade/admin roles are held by the timelock, or that the controlling Safe can only execute those actions through the timelock;
- proposer, executor, canceller, and admin role holders if using OpenZeppelin TimelockController;
- one example queued/executed governance transaction, if available.

Command shape for OpenZeppelin-compatible timelocks:

```bash
export TIMELOCK=<timelock-address>

cast code "$TIMELOCK" --rpc-url "$BASE_RPC_URL" --block "$TO_BLOCK"
cast call "$TIMELOCK" 'getMinDelay()(uint256)' --rpc-url "$BASE_RPC_URL" --block "$TO_BLOCK"
```

If the Safe holds admin roles directly and no enforced delay is in the execution path, timelock status is `absent/deferred`. Disclosure alone does not remediate the governance risk.

## Release Evidence To Archive

Release notes must include or link to:

- verification date, verifier names, RPC/source used, and verification block;
- contract address table;
- raw AccessControl logs and reconstructed holder table for each role;
- direct `hasRole` outputs for every final holder and expected admin address;
- ERC1967 implementation/admin slot reads for every proxy;
- implementation addresses and source-verification links;
- Safe address, owners, threshold, nonce, and role-control evidence;
- timelock status plus the evidence above, or explicit `absent/deferred` disclosure;
- `AdminRoleReadiness` output if candidate checks were used;
- admin monitoring status and test-alert evidence from `docs/admin-monitoring-runbook.md`.
