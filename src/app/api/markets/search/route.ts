import { type NextRequest, NextResponse } from "next/server";
import { marketSearch } from "@/backend/db/marketSearch";
import { createApiErrorResponder } from "@/server/apiError";

const apiError = createApiErrorResponder("api-market-search");

/**
 * @swagger
 * /api/markets/search:
 *   get:
 *     tags: [Markets]
 *     summary: Search markets
 *     description: >
 *       Unified market search. The "interest" sort blends log-scaled volume +
 *       liquidity + view count with a time-to-resolve decay.
 *     parameters:
 *       - { name: q,            in: query, schema: { type: string },  description: "Full-text query (tsvector)" }
 *       - { name: category,     in: query, schema: { type: string },  description: "Exact category filter" }
 *       - { name: categories,   in: query, schema: { type: string },  description: "Comma-separated category list" }
 *       - { name: volumeMin,    in: query, schema: { type: number, default: 0 } }
 *       - { name: liquidityMin, in: query, schema: { type: number, default: 0 } }
 *       - { name: sort,         in: query, schema: { type: string, enum: [volume, liquidity, end_date, interest], default: volume } }
 *       - { name: limit,        in: query, schema: { type: integer, default: 50, maximum: 100 } }
 *       - { name: offset,       in: query, schema: { type: integer, default: 0 } }
 *     responses:
 *       200: { description: List of markets with total count }
 *       400: { description: Invalid query parameter }
 *       500: { description: Server error }
 */

/**
 * Parse a non-negative number from a raw query-param string.
 * Returns the fallback when raw is null, null when the value is invalid.
 */
function parseNonNegativeNumber(raw: string | null, fallback: number): number | null {
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Parse a positive integer from a raw query-param string.
 * Returns the fallback when raw is null, null when the value is out-of-range.
 */
function parsePositiveInt(raw: string | null, fallback: number, max: number): number | null {
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > max) return null;
  return n;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const q = sp.get("q") ?? undefined;
  const category = sp.get("category") ?? undefined;
  const categoriesRaw = sp.get("categories");
  const categories = categoriesRaw
    ? categoriesRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  const volumeMin = parseNonNegativeNumber(sp.get("volumeMin"), 0);
  if (volumeMin === null) {
    return apiError({ status: 400, error: "Invalid volumeMin" });
  }

  const liquidityMin = parseNonNegativeNumber(sp.get("liquidityMin"), 0);
  if (liquidityMin === null) {
    return apiError({ status: 400, error: "Invalid liquidityMin" });
  }

  const limit = parsePositiveInt(sp.get("limit"), 50, 100);
  if (limit === null) {
    return apiError({ status: 400, error: "Invalid limit" });
  }

  const rawOffset = parseNonNegativeNumber(sp.get("offset"), 0);
  if (rawOffset === null) {
    return apiError({ status: 400, error: "Invalid offset" });
  }
  const offset = Math.floor(rawOffset);

  const sortRaw = sp.get("sort") ?? "volume";
  const sort: "volume" | "liquidity" | "end_date" | "interest" =
    sortRaw === "liquidity" || sortRaw === "end_date" || sortRaw === "interest"
      ? sortRaw
      : "volume";

  try {
    const filterOpts = { q, category, categories, volumeMin, liquidityMin };
    const [markets, total] = await Promise.all([
      marketSearch.searchMarkets({ ...filterOpts, sort, limit, offset }),
      marketSearch.countMarkets(filterOpts),
    ]);

    return NextResponse.json({
      success: true,
      data: { markets, count: markets.length, total },
    });
  } catch (err) {
    return apiError({ status: 500, error: "Market search failed", cause: err });
  }
}
