import { publicPageMetadata } from "@/lib/seo";

export const metadata = publicPageMetadata({
  title: "API documentation | Polyswap",
  description: "Explore the Polyswap API reference for market data and conditional swap orders.",
  path: "/api-docs",
});

export default function ApiDocsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
