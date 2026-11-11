import { type NextRequest, NextResponse } from "next/server";
import { marketRepository } from "@/backend/db/marketRepository";
import { createApiErrorResponder } from "@/server/apiError";

const apiError = createApiErrorResponder("api-markets-batch");

const MAX_BATCH_MARKETS = 50;

/**
 * @swagger
 * /api/markets:
 *   get:
 *     tags: [Markets]
 *     summary: Get several markets by slug or numeric id
 *     description: Batch form of `GET /api/markets/{slug}`, with the same id/slug resolution. Unknown identifiers are left out of the result. Never counts views.
 *     parameters:
 *       - { name: ids, in: query, required: true, style: form, explode: true, schema: { type: array, maxItems: 50, items: { type: string, maxLength: 255 } }, description: "Repeat for each market, e.g. `?ids=123&ids=some-slug`" }
 *     responses:
 *       200: { description: "Object keyed by the requested identifier, each value a market record" }
 *       400: { description: Missing, too many or invalid identifiers }
 *       500: { description: Server error }
 */
export async function GET(req: NextRequest) {
  const identifiers = [...new Set(req.nextUrl.searchParams.getAll("ids"))];
  if (
    identifiers.length === 0 ||
    identifiers.length > MAX_BATCH_MARKETS ||
    identifiers.some((id) => id.length === 0 || id.length > 255)
  ) {
    return apiError({
      status: 400,
      error: "Invalid identifiers",
      message: `Pass between 1 and ${MAX_BATCH_MARKETS} non-empty \`ids\` of at most 255 characters.`,
    });
  }

  try {
    const markets = await marketRepository.getMarketsByIdentifiers(identifiers);
    return NextResponse.json({ success: true, data: Object.fromEntries(markets) });
  } catch (err) {
    return apiError({ status: 500, error: "Market lookup failed", cause: err });
  }
}
