import type { TokenViewModel } from "@/types/viewModels";

const POPULAR_SYMBOLS: readonly string[] = [
  "USDC",
  "USDC.e",
  "USDT",
  "DAI",
  "WETH",
  "WBTC",
  "WPOL",
  "LINK",
];

export interface TokenGroup {
  id: "owned" | "popular" | "rest";
  title: string;
  tokens: TokenViewModel[];
}

/** Addresses are compared and looked up in lower case everywhere in the picker. */
export function tokenKey(token: Pick<TokenViewModel, "address">): string {
  return token.address.toLowerCase();
}

function matchesQuery(token: TokenViewModel, normalizedQuery: string): boolean {
  return (
    token.symbol.toLowerCase().includes(normalizedQuery) ||
    token.name.toLowerCase().includes(normalizedQuery) ||
    tokenKey(token).includes(normalizedQuery)
  );
}

function bySymbol(a: TokenViewModel, b: TokenViewModel): number {
  return a.symbol.localeCompare(b.symbol);
}

function ownedTokens(
  tokens: TokenViewModel[],
  balances: ReadonlyMap<string, bigint>
): TokenViewModel[] {
  const balanceOf = (token: TokenViewModel) => balances.get(tokenKey(token)) ?? 0n;
  return tokens
    .filter((token) => balanceOf(token) > 0n)
    .sort((a, b) => {
      const balanceA = balanceOf(a);
      const balanceB = balanceOf(b);
      if (balanceA === balanceB) return bySymbol(a, b);
      return balanceB > balanceA ? 1 : -1;
    });
}

/** Splits the tokens matching `query` into the picker's sections, leaving out empty ones. */
export function groupTokens(params: {
  options: ReadonlyArray<TokenViewModel>;
  query: string;
  balances: ReadonlyMap<string, bigint>;
  showBalances: boolean;
}): TokenGroup[] {
  const { options, query, balances, showBalances } = params;
  const normalizedQuery = query.trim().toLowerCase();
  const matching = options.filter((token) => matchesQuery(token, normalizedQuery));

  const owned = showBalances ? ownedTokens(matching, balances) : [];
  const claimed = new Set(owned.map(tokenKey));

  const popular = matching
    .filter((token) => POPULAR_SYMBOLS.includes(token.symbol) && !claimed.has(tokenKey(token)))
    .sort((a, b) => POPULAR_SYMBOLS.indexOf(a.symbol) - POPULAR_SYMBOLS.indexOf(b.symbol));
  popular.forEach((token) => claimed.add(tokenKey(token)));

  const rest = matching.filter((token) => !claimed.has(tokenKey(token))).sort(bySymbol);

  const groups: TokenGroup[] = [
    { id: "owned", title: "In your wallet", tokens: owned },
    { id: "popular", title: "Popular", tokens: popular },
    { id: "rest", title: query ? "Results" : "All tokens", tokens: rest },
  ];
  return groups.filter((group) => group.tokens.length > 0);
}
