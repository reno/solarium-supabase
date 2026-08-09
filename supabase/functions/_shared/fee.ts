export const FEE_BPS = 100n;

export function feeOf(price: bigint): bigint {
  return (price * FEE_BPS) / 10000n;
}

export const FEE_RATE = Number(FEE_BPS) / 10000;

export const FEE_LABEL = `${(Number(FEE_BPS) / 100).toFixed(1)}%`;
