export function shortWallet(address?: string | null): string {
  if (!address) return "unknown";
  if (address.length <= 9) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
