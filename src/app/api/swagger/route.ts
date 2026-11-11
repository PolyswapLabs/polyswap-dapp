import { NextResponse } from "next/server";
import { getApiDocs } from "@/server/swagger";
import { createApiErrorResponder } from "@/server/apiError";

const apiError = createApiErrorResponder("api-swagger");

export async function GET() {
  try {
    const spec = getApiDocs();
    return NextResponse.json(spec);
  } catch (error) {
    return apiError({ status: 500, error: "Failed to generate API documentation", cause: error });
  }
}
