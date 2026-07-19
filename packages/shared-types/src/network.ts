// FairCoin network identifier. Mirrors @fairco.in/core's NetworkType, inlined
// locally so @oxypay/shared-types stays zero-runtime-dep for a clean CJS+ESM
// publish (a package importing from @fairco.in/core cannot ship CommonJS,
// since @fairco.in/core has no CJS export of its own).
export type NetworkType = 'mainnet' | 'testnet';
