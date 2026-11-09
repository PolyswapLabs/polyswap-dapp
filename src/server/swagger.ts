import { createSwaggerSpec } from "next-swagger-doc";

export const getApiDocs = () => {
  const spec = createSwaggerSpec({
    apiFolder: "src/app/api",
    definition: {
      openapi: "3.0.0",
      info: {
        title: "Polyswap API",
        version: "1.0.0",
        description:
          "API for Polyswap - Decentralized prediction market order management with CoW Protocol integration",
      },
      servers: [
        {
          url: process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000",
          description: "API Server",
        },
      ],
      tags: [
        { name: "Health", description: "Health check endpoints" },
        { name: "Markets", description: "Polymarket markets data" },
        { name: "Orders", description: "Polyswap order management" },
      ],
      components: {
        schemas: {
          Market: {
            type: "object",
            properties: {
              id: { type: "string" },
              slug: { type: "string" },
              event_slug: { type: "string", nullable: true },
              question: { type: "string" },
              description: { type: "string", nullable: true },
              category: { type: "string", nullable: true },
              tags: { type: "array", items: { type: "string" } },
              outcomes: { type: "array", items: { type: "string" } },
              volume: { type: "number" },
              liquidity: { type: "number" },
              end_date: { type: "string", format: "date-time", nullable: true },
              clob_token_ids: { type: "array", items: { type: "string" } },
              protocol_version: { type: "string", enum: ["v1", "v2"], nullable: true },
              position_ids: { type: "array", items: { type: "string" } },
              condition_id: { type: "string", nullable: true },
              active: { type: "boolean" },
              neg_risk: { type: "boolean" },
            },
          },
          Order: {
            type: "object",
            properties: {
              id: { type: "integer" },
              order_hash: { type: "string", nullable: true },
              sell_token: { type: "string" },
              buy_token: { type: "string" },
              sell_amount: { type: "string" },
              start_time: { type: "string", format: "date-time" },
              end_time: { type: "string", format: "date-time" },
              market_id: { type: "string", nullable: true },
              outcome_selected: { type: "string", nullable: true },
              bet_percentage: { type: "number", nullable: true },
              status: {
                type: "string",
                enum: ["draft", "live", "filled", "canceled", "errored", "expired"],
              },
              order_uid: { type: "string", nullable: true },
              last_error_reason: { type: "string", nullable: true },
              last_error_retry_at: { type: "string", nullable: true },
              filled_at: { type: "string", format: "date-time", nullable: true },
              gate_opened_at: { type: "string", format: "date-time", nullable: true },
              actual_sell_amount: { type: "string", nullable: true },
              actual_buy_amount: { type: "string", nullable: true },
            },
          },
          Error: {
            type: "object",
            properties: {
              success: { type: "boolean", example: false },
              error: { type: "string" },
              message: { type: "string" },
              errorId: { type: "string", format: "uuid" },
            },
          },
        },
      },
    },
  });
  return spec;
};
