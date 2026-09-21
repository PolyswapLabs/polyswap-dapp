import { Suspense } from "react";
import { MarketsSearchResults } from "@/components/markets";
import { PRIVATE_PAGE_ROBOTS } from "@/lib/seo";

export const metadata = {
  title: "Search · Polyswap",
  robots: PRIVATE_PAGE_ROBOTS,
};

export default function MarketsSearchPage() {
  return (
    <Suspense fallback={null}>
      <MarketsSearchResults />
    </Suspense>
  );
}
