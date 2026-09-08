/**
 * Hand-written ABI literal for the two `BatchAnchor` read functions the browser needs to
 * independently re-verify an inclusion proof (ticket S2-03). Source of truth is
 * `contracts/contracts/BatchAnchor.sol` — deliberately NOT imported from
 * `contracts/artifacts` (a build output from another owner's toolchain); a four-entry ABI
 * literal here is safer and keeps this ticket's file scope inside `apps/web/`.
 */
export const batchAnchorAbi = [
  {
    type: "function",
    name: "getRoot",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "anchorCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
