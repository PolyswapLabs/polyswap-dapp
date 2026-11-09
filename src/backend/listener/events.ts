import { parseAbiItem, type Log } from "viem";

// parseAbiItem keeps each event strongly typed for watchEvent and getLogs, no cast needed.
export const CONDITIONAL_ORDER_CREATED_EVENT = parseAbiItem(
  "event ConditionalOrderCreated(address indexed owner, (address handler, bytes32 salt, bytes staticInput) params)"
);
export const TRADE_EVENT = parseAbiItem(
  "event Trade(address indexed owner, address sellToken, address buyToken, uint256 sellAmount, uint256 buyAmount, uint256 feeAmount, bytes orderUid)"
);
export const ORDER_INVALIDATED_EVENT = parseAbiItem(
  "event OrderInvalidated(address indexed owner, bytes orderUid)"
);

export interface EventHandlingOptions {
  allowTrading?: boolean;
}

export type MinedLog = Log<bigint, number, false>;

export function isMinedLog(log: Log): log is MinedLog {
  return log.transactionHash !== null && log.blockNumber !== null && log.logIndex !== null;
}
