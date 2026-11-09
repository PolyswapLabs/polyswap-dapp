import { type NextRequest, NextResponse } from "next/server";
import { marketRepository } from "@/backend/db/marketRepository";
import { createApiErrorResponder } from "@/server/apiError";
import { createLogger } from "@/backend/logger";

const apiError = createApiErrorResponder("api-market-detail");
const log = createLogger("api-market-detail");

/**
 * @swagger
 * /api/markets/{slug}:
 *   get:
 *     tags: [Markets]
 *     summary: Get a single market by slug or numeric id
 *     description: Resolves numeric strings as ids first, otherwise as slugs (with fallback the other way).
 *     parameters:
 *       - { name: slug,  in: path,  required: true, schema: { type: string } }
 *       - { name: track, in: query, schema: { type: string, enum: ["1"] }, description: "When `1`, increments view_count (fire-and-forget)" }
 *     responses:
 *       200: { description: Market record }
 *       400: { description: Invalid identifier }
 *       404: { description: Market not found }
 *       500: { description: Server error }
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug: identifier } = await params;
  if (!identifier || identifier.length > 255) {
    return apiError({ status: 400, error: "Invalid identifier" });
  }

  // Opt-in view tracking: callers that represent an actual user landing on
  // the market detail page pass `?track=1`. Side-traffic (e.g. swap rows,
  // create form) omits it so we don't inflate the count with internal lookups.
  const shouldTrack = req.nextUrl.searchParams.get("track") === "1";

  try {
    const isNumericId = /^\d+$/.test(identifier);
    const market = isNumericId
      ? ((await marketRepository.getMarketById(identifier)) ??
        (await marketRepository.getMarketBySlug(identifier)))
      : ((await marketRepository.getMarketBySlug(identifier)) ??
        (await marketRepository.getMarketById(identifier)));

    if (!market) {
      return apiError({ status: 404, error: "Market not found" });
    }

    if (shouldTrack) {
      // Fire-and-forget. View tracking must never block the response or fail
      // the request — the count is a soft signal, not a contract.
      void marketRepository.incrementMarketViews(identifier).catch((err) => {
        log.error("View increment failed:", err);
      });
    }

    return NextResponse.json({ success: true, data: market });
  } catch (err) {
    return apiError({ status: 500, error: "Market lookup failed", cause: err });
  }
}
