import { type NextRequest, NextResponse } from "next/server";
import { marketSearch } from "@/backend/db/marketSearch";
import { createApiErrorResponder } from "@/server/apiError";

const apiError = createApiErrorResponder("api-market-suggest");

const MAX_LIMIT = 20;
const DEFAULT_LIMIT = 8;
const MAX_PREFIX_LEN = 80;

/**
 * @swagger
 * /api/markets/suggest:
 *   get:
 *     tags: [Markets]
 *     summary: Tag autocomplete
 *     description: Returns up to `limit` tag suggestions matching the prefix `q`.
 *     parameters:
 *       - { name: q,     in: query, required: true, schema: { type: string }, description: "Prefix (≤ 80 chars, alphanum + spaces)" }
 *       - { name: limit, in: query, schema: { type: integer, default: 8, maximum: 20 } }
 *     responses:
 *       200: { description: Suggestion list }
 *       500: { description: Server error }
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const raw = (sp.get("q") ?? "").trim();
  // Drop punctuation; the index stores raw labels and we only need a
  // simple prefix match on alphanumerics + spaces.
  const prefix = raw.replace(/[^A-Za-z0-9 ]/g, "").slice(0, MAX_PREFIX_LEN);

  if (prefix.length === 0) {
    return NextResponse.json({ success: true, data: [] });
  }

  const limitRaw = sp.get("limit");
  const limit = limitRaw
    ? Math.min(Math.max(parseInt(limitRaw, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  try {
    const suggestions = await marketSearch.getTagSuggestions(prefix, limit);
    return NextResponse.json({ success: true, data: suggestions });
  } catch (err) {
    return apiError({ status: 500, error: "Market suggestions failed", cause: err });
  }
}
