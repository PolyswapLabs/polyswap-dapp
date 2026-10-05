import { type NextRequest, NextResponse } from "next/server";
import { DatabaseService } from "@/backend/services/databaseService";
import {
  createMarketRecommendationService,
  RecommendationUnavailableError,
} from "@/backend/services/marketRecommendationService";
import { parseRecommendationOptions } from "@/lib/marketRecommendations";
import { createApiErrorResponder } from "@/lib/apiError";

const apiError = createApiErrorResponder("api-market-recommendations");
const recommendations = createMarketRecommendationService({
  loadCandidates: (category) => DatabaseService.getRecommendationCandidates(category),
});

/**
 * @swagger
 * /api/markets/recommended:
 *   get:
 *     tags: [Markets]
 *     summary: Recommended active markets
 *     description: Read-only database shortlist of up to 300 markets enriched with at most three Gamma requests of 100 IDs each. Results and totals share odds and quality filters. Enrichment is cached in process memory for two minutes. On Gamma HTTP 429, returns source=database with backend base filters and pauses Gamma until Retry-After or two minutes have elapsed; odds and live-metric filters do not apply to this fallback.
 *     parameters:
 *       - { name: category, in: query, schema: { type: string }, description: "Crypto-relevant category; omit for All" }
 *       - { name: oddsMin, in: query, schema: { type: integer, minimum: 5, maximum: 94, default: 10 } }
 *       - { name: oddsMax, in: query, schema: { type: integer, minimum: 6, maximum: 95, default: 90 } }
 *       - { name: limit, in: query, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
 *       - { name: offset, in: query, schema: { type: integer, minimum: 0, default: 0 } }
 *     responses:
 *       200: { description: Markets, total, source, asOf, candidateCount and truncated; fallbackReason on database fallback }
 *       400: { description: Invalid category, odds range or pagination }
 *       503: { description: Non-rate-limit Gamma failure or invalid response }
 *       500: { description: Database or internal error }
 */
export async function GET(req: NextRequest) {
  const options = parseRecommendationOptions(req.nextUrl.searchParams);
  if (!options) {
    return apiError({
      status: 400,
      error: "Invalid recommendation filters",
      message:
        "Choose a supported category, integer odds between 5% and 95% (minimum below maximum), a limit from 1 to 100, and a non-negative integer offset.",
    });
  }
  try {
    const data = await recommendations.getPage(options);
    return NextResponse.json({ success: true, data }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return apiError({
      status: cause instanceof RecommendationUnavailableError ? 503 : 500,
      error: "Recommendations unavailable",
      message: "We couldn’t load recommendations. Try again, or use search to find a market.",
      cause,
    });
  }
}
