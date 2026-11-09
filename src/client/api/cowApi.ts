import { isRecord } from "@/shared/guards";

const COW_QUOTE_URL = "https://api.cow.fi/polygon/api/v1/quote";

/** CoW's placeholder for the chain's native token, which its quote API does not accept. */
const NATIVE_TOKEN_PLACEHOLDER = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const WRAPPED_NATIVE_TOKEN = "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270";

export class CowQuoteError extends Error {
  readonly errorType: string | null;
  readonly description: string | null;
  readonly status: number;
  constructor(
    message: string,
    errorType: string | null,
    description: string | null,
    status: number
  ) {
    super(message);
    this.name = "CowQuoteError";
    this.errorType = errorType;
    this.description = description;
    this.status = status;
  }
}

export interface CowQuoteParams {
  sellToken: string;
  buyToken: string;
  /** Amount to sell in wei (as a decimal string). */
  sellAmount: string;
  userAddress: string;
}

export interface CowQuote {
  buyAmount: string;
  sellAmount: string;
}

function toQuotableToken(tokenAddress: string): string {
  return tokenAddress.toLowerCase() === NATIVE_TOKEN_PLACEHOLDER.toLowerCase()
    ? WRAPPED_NATIVE_TOKEN
    : tokenAddress;
}

function parseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function parseCowError(res: Response): Promise<CowQuoteError> {
  const body = parseJsonRecord(await res.text());
  const errorType = typeof body?.errorType === "string" ? body.errorType : null;
  const description = typeof body?.description === "string" ? body.description : null;
  return new CowQuoteError(
    description ?? `CoW quote API error (${res.status})`,
    errorType,
    description,
    res.status
  );
}

function readQuote(json: unknown): CowQuote {
  if (!isRecord(json) || !isRecord(json.quote)) {
    throw new Error(`useQuote: unexpected API response shape`);
  }
  const { buyAmount, sellAmount } = json.quote as Partial<CowQuote>;
  if (!buyAmount || !sellAmount) {
    throw new Error(`useQuote: missing buyAmount/sellAmount in CoW response`);
  }
  return { buyAmount, sellAmount };
}

/** Callers validate the params: see `toQuoteParams` in useSwapEstimates. */
export async function fetchCowQuote({
  sellToken,
  buyToken,
  sellAmount,
  userAddress,
}: CowQuoteParams): Promise<CowQuote> {
  const res = await fetch(COW_QUOTE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sellToken: toQuotableToken(sellToken),
      buyToken: toQuotableToken(buyToken),
      from: userAddress,
      receiver: userAddress,
      kind: "sell",
      sellAmountBeforeFee: sellAmount,
    }),
  });
  if (!res.ok) throw await parseCowError(res);
  return readQuote(await res.json());
}
