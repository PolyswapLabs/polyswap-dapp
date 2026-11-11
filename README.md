<div align="center">

<img src="public/landing/thumbnail.png" alt="PolySwap illustration" width="560">

<h1>PolySwap</h1>

<p><strong>Token swaps on Polygon that execute only when a Polymarket outcome reaches the odds you choose.</strong></p>

<p>
  <img src="https://visitor-badge.laobi.icu/badge?page_id=PolyswapLabs.polyswap-dapp" alt="Repository views">
  <a href="https://github.com/PolyswapLabs/polyswap-dapp/stargazers"><img src="https://img.shields.io/github/stars/PolyswapLabs/polyswap-dapp?style=flat&logo=github&color=e8590c" alt="GitHub stars"></a>
  <a href="https://github.com/PolyswapLabs/polyswap-dapp/commits"><img src="https://img.shields.io/github/last-commit/PolyswapLabs/polyswap-dapp?style=flat&color=16140f" alt="Last commit"></a>
</p>

<p>
  <img src="https://img.shields.io/badge/Polygon-mainnet-7B3FE4?style=flat&logo=polygon&logoColor=white" alt="Polygon">
  <img src="https://img.shields.io/badge/CoW_Protocol-conditional_orders-012F7A?style=flat" alt="CoW Protocol">
  <img src="https://img.shields.io/badge/Polymarket-CLOB-2E5CFF?style=flat" alt="Polymarket">
  <img src="https://img.shields.io/badge/Safe-smart_account-12FF80?style=flat&logo=safe&logoColor=black" alt="Safe">
  <img src="https://img.shields.io/badge/Next.js-15-000000?style=flat&logo=nextdotjs&logoColor=white" alt="Next.js 15">
</p>

<p>
  <a href="https://polyswap.lucasl.dev"><b>Website</b></a> ·
  <a href="public/polyswap-ads.mp4"><b>Watch the video</b></a> ·
  <a href="#how-it-works"><b>How it works</b></a> ·
  <a href="#getting-started"><b>Getting started</b></a>
</p>

</div>

> _"Swap 1,000 USDC for WETH if 'Will the Fed cut rates in December?' trades at 70% YES or higher before Friday."_

Funds stay in your Safe until the condition is met. If it never is, the order expires and nothing moves.

## How it works

1. **Create.** You pick a market, an outcome, a probability threshold, the swap and an expiry date. The backend places a small Polymarket limit order that buys shares of that outcome at your threshold price. This is the _trigger order_ (called a `sentinel` in the code). Swaps with the same market, outcome, price and expiry share one trigger order.
2. **Sign.** Your Safe signs one transaction that creates a CoW Protocol conditional order on `ComposableCoW`. If needed, it also approves the sell token and installs CoW's `ExtensibleFallbackHandler`.
3. **Wait.** On every block, the PolySwap handler (the contract that decides when the conditional order is valid) reads the trigger order's fill on Polymarket's exchange contract. Once it has filled, the market has traded at your price and the condition is met.
4. **Swap.** CoW's watch tower then posts the order to the CoW order book, and solvers settle it in a batch auction.
5. **Clean up.** The backend sells the shares the trigger order bought, so it never holds market risk.

You can cancel a live order at any time. The Safe calls `ComposableCoW.remove()`, and the order can no longer trade.

```mermaid
sequenceDiagram
  actor User
  participant App as PolySwap app + API
  participant PM as Polymarket
  participant Safe
  participant CoW as ComposableCoW + handler
  participant WT as CoW watch tower

  User->>App: Choose market, threshold, swap
  App->>PM: Place trigger limit order at the threshold
  User->>Safe: Sign create (+ approve) transaction
  Safe->>CoW: Create conditional order
  loop Every block until filled or expired
    WT->>CoW: Is the order tradeable?
    CoW->>PM: Read trigger order fill on-chain
  end
  WT->>Safe: CoW solvers settle the swap (funds leave the Safe only now)
  App->>PM: Sell the trigger order's shares
```

## Architecture

| Part         | What it does                                                                                                                                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Web app**  | Next.js 15 / React 19. Market browser, order creation, dashboard. Wallets: Safe App and WalletConnect (Safe accounts only).                                                                                                  |
| **API**      | Next.js routes under `/api`. Markets, order creation (places the trigger order, returns the Safe transactions), order lookup and cancellation.                                                                               |
| **Listener** | Long-running Node process. Indexes order creation, trade and invalidation events, checks live orders every minute (fillable, expired, removed), sells the shares bought by trigger orders and syncs markets from Polymarket. |
| **Database** | PostgreSQL ([Nile](https://www.thenile.dev/)) through Prisma: markets, orders, trigger orders (`polymarket_sentinels`), sold positions, listener cursor.                                                                     |

```
src/
  app/          Next.js pages and API routes
  components/   UI
  hooks/        React hooks (orders, markets, Safe flow)
  client/       Browser-only code (API client, Safe, wagmi)
  server/       Server-only helpers for API routes (errors, Swagger, PostHog)
  backend/      Listener, database repositories, Polymarket and RPC clients
  shared/       Code used by both the browser and the backend
prisma/         Schema and migrations
script/         One-off operational scripts
test/           Unit and regression tests
```

## Getting started

Requirements: Node 24+, pnpm 11, a PostgreSQL database and a Polygon RPC.

```bash
pnpm install            # also runs `prisma generate`
cp .env.sample .env     # then fill it in (see below)
pnpm db:migrate         # apply migrations

pnpm start:listener     # terminal 1: listener and background jobs
pnpm dev                # terminal 2: web app on http://localhost:3000
```

The API is documented in Swagger UI at `http://localhost:3000/api-docs` (OpenAPI JSON at `/api/swagger`).

### Environment

`.env.sample` lists every variable with a comment. The ones you must set:

| Group      | Variables                                                                        |
| ---------- | -------------------------------------------------------------------------------- |
| Database   | `DATABASE_URL`, or `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` |
| RPC        | `RPC_URL`, `WSS_RPC_URL` (listener), `NEXT_PUBLIC_RPC_URL` (browser)             |
| Polymarket | `PK`, `CLOB_API_KEY`, `CLOB_SECRET`, `CLOB_PASS_PHRASE`                          |
| Wallets    | `NEXT_PUBLIC_WC_PROJECT_ID` (WalletConnect)                                      |

Generate the Polymarket API credentials from `PK` with `pnpm get-polymarket-creds`. The contract addresses in `.env.sample` are the Polygon mainnet deployments.

Sentry and PostHog only run when `ENVIRONMENT` is `prod` or `production`. `ORDER_CREATION_DISABLED` and `DAPP_MAINTENANCE` are the operational kill switches.

## Scripts

| Command                                                   | Purpose                                                         |
| --------------------------------------------------------- | --------------------------------------------------------------- |
| `pnpm dev` / `build` / `start`                            | Web app                                                         |
| `pnpm start:listener`                                     | Listener with every job (events, order health, seller, markets) |
| `pnpm start:listener-only`                                | Event indexing only                                             |
| `pnpm start:market-sync`                                  | Market sync only                                                |
| `pnpm markets:sync`                                       | Run one market sync, then exit                                  |
| `pnpm test`                                               | Tests (no database or network needed)                           |
| `pnpm typecheck` / `lint` / `format:check`                | Static checks                                                   |
| `pnpm db:migrate` / `db:status` / `db:diff` / `db:studio` | Prisma migrations and inspection                                |

Operational scripts (they act on the operator wallet, so read them before running):

| Command                           | Purpose                                            |
| --------------------------------- | -------------------------------------------------- |
| `pnpm get-polymarket-creds`       | Derive Polymarket API credentials from `PK`        |
| `pnpm setup-polymarket-approvals` | Grant the approvals Polymarket trading needs       |
| `pnpm register-cow-appdata`       | Register the CoW app-data document                 |
| `pnpm check-polymarket-orders`    | Print open orders, positions and on-chain balances |
| `pnpm cancel-polymarket-orders`   | Cancel every open Polymarket order                 |
| `pnpm sell-polymarket-positions`  | Sell every open Polymarket position                |
| `pnpm pusd`                       | Wrap or unwrap pUSD                                |

## Deployment

The `Dockerfile` builds the listener image. It contains only `src/backend`, `src/shared` and the ABIs, and runs the listener with every job, like `pnpm start:listener`. The web app is a standard Next.js build. Run `pnpm db:migrate` before deploying a release that adds migrations.

## Authors

| [<img src="https://github.com/Intermarch3.png?size=85" width=85><br><sub>Lucas Leclerc</sub>](https://github.com/Intermarch3) | [<img src="https://github.com/Pybast.png?size=85" width=85><br><sub>Baptiste Florentin</sub>](https://github.com/Pybast) |
| :---------------------------------------------------------------------------------------------------------------------------: | :----------------------------------------------------------------------------------------------------------------------: |
