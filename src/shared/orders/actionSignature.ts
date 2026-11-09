/**
 * The EIP-191 message a wallet signs to authorise an order action. The client
 * signs it and the server verifies it, so both must build it here.
 */
export function createActionSignatureMessage(
  action: string,
  orderIdentifier: string,
  timestamp: number,
  chainId: number
): string {
  return `PolySwap Action Request\nAction: ${action}\nOrder: ${orderIdentifier}\nTimestamp: ${timestamp}\nChain: ${chainId}`;
}
