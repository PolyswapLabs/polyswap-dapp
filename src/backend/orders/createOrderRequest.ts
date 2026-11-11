import { isAddress, type Address } from "viem";
import type { ApiErrorOptions } from "@/server/apiError";

const MAX_START_DATE_AGE_MS = 60_000;

const REQUIRED_FIELDS = [
  "sellToken",
  "buyToken",
  "sellAmount",
  "selectedOutcome",
  "betPercentage",
  "marketId",
  "owner",
] as const;

interface CreateOrderRequestBody {
  sellToken: unknown;
  buyToken: unknown;
  sellAmount: unknown;
  minBuyAmount?: unknown;
  selectedOutcome: unknown;
  betPercentage: unknown;
  startDate?: unknown;
  deadline?: unknown;
  marketId: unknown;
  owner: unknown;
}

export interface CreateOrderInput {
  sellToken: Address;
  buyToken: Address;
  owner: Address;
  sellAmount: string;
  minBuyAmount: string;
  selectedOutcome: string;
  betPercentage: number;
  marketId: string;
  startDate: Date;
  requestedDeadline: string | undefined;
}

interface Rejected {
  rejection: ApiErrorOptions;
}

type Parsed<T> = { value: T } | Rejected;

function rejected(error: string, message?: string): Rejected {
  return { rejection: { status: 400, error, message } };
}

function isPositiveIntegerString(value: string): boolean {
  return /^\d+$/.test(value) && BigInt(value) > 0n;
}

function parseAddresses(
  body: CreateOrderRequestBody
): Parsed<Pick<CreateOrderInput, "sellToken" | "buyToken" | "owner">> {
  const { sellToken, buyToken, owner } = body;
  if (typeof sellToken !== "string" || !isAddress(sellToken)) {
    return rejected("Invalid sellToken address");
  }
  if (typeof buyToken !== "string" || !isAddress(buyToken)) {
    return rejected("Invalid buyToken address");
  }
  if (typeof owner !== "string" || !isAddress(owner)) {
    return rejected("Invalid owner address");
  }
  return { value: { sellToken, buyToken, owner } };
}

function parseAmounts(
  body: CreateOrderRequestBody
): Parsed<Pick<CreateOrderInput, "sellAmount" | "minBuyAmount">> {
  const { sellAmount } = body;
  if (typeof sellAmount !== "string" || !isPositiveIntegerString(sellAmount)) {
    return rejected("sellAmount must be a positive number string");
  }
  const minBuyAmount =
    typeof body.minBuyAmount === "string" && body.minBuyAmount !== "" ? body.minBuyAmount : "1";
  if (!isPositiveIntegerString(minBuyAmount)) {
    return rejected("minBuyAmount must be positive");
  }
  return { value: { sellAmount, minBuyAmount } };
}

function parseMarketChoice(
  body: CreateOrderRequestBody
): Parsed<Pick<CreateOrderInput, "selectedOutcome" | "betPercentage" | "marketId">> {
  const { selectedOutcome, marketId } = body;
  if (typeof selectedOutcome !== "string" || selectedOutcome === "") {
    return rejected("selectedOutcome must be a non-empty string");
  }
  const betPercentage = Number(body.betPercentage);
  if (
    !Number.isFinite(betPercentage) ||
    !Number.isInteger(betPercentage) ||
    betPercentage <= 0 ||
    betPercentage > 100
  ) {
    return rejected("betPercentage must be an integer from 1 to 100");
  }
  if (typeof marketId !== "string" || marketId === "") {
    return rejected("marketId must be a non-empty string");
  }
  return { value: { selectedOutcome, betPercentage, marketId } };
}

function parseSchedule(
  body: CreateOrderRequestBody
): Parsed<Pick<CreateOrderInput, "startDate" | "requestedDeadline">> {
  const { startDate: requestedStart, deadline: requestedDeadline } = body;
  if (requestedStart !== undefined && typeof requestedStart !== "string") {
    return rejected("Invalid startDate", "startDate must be a string");
  }
  if (requestedDeadline !== undefined && typeof requestedDeadline !== "string") {
    return rejected("Invalid deadline", "deadline must be a string");
  }
  if (requestedDeadline && Number.isNaN(new Date(requestedDeadline).getTime())) {
    return rejected("Invalid deadline", "deadline must be a valid date");
  }

  if (!requestedStart || requestedStart === "now") {
    return { value: { startDate: new Date(), requestedDeadline } };
  }
  const startDate = new Date(requestedStart);
  if (Number.isNaN(startDate.getTime())) {
    return rejected("Invalid startDate", "startDate must be a valid date");
  }
  if (startDate < new Date(Date.now() - MAX_START_DATE_AGE_MS)) {
    return rejected("startDate must not be in the past");
  }
  return { value: { startDate, requestedDeadline } };
}

export function parseCreateOrderRequest(rawBody: unknown): Parsed<CreateOrderInput> {
  if (typeof rawBody !== "object" || rawBody === null) {
    return rejected("Invalid request body", "The request body must be a JSON object");
  }
  const body = rawBody as CreateOrderRequestBody;

  const missing = REQUIRED_FIELDS.filter(
    (f) => body[f] === undefined || body[f] === null || body[f] === ""
  );
  if (missing.length > 0) {
    return rejected(
      "Missing required fields",
      `Missing required field${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`
    );
  }

  const addresses = parseAddresses(body);
  if ("rejection" in addresses) return addresses;
  const amounts = parseAmounts(body);
  if ("rejection" in amounts) return amounts;
  const marketChoice = parseMarketChoice(body);
  if ("rejection" in marketChoice) return marketChoice;
  const schedule = parseSchedule(body);
  if ("rejection" in schedule) return schedule;

  return {
    value: { ...addresses.value, ...amounts.value, ...marketChoice.value, ...schedule.value },
  };
}
