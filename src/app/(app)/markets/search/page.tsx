import { Suspense } from "react";
import { MarketsSearchView } from "@/components/markets/MarketsSearchView";
import { PRIVATE_PAGE_ROBOTS } from "@/server/seo";

export const metadata = {
  title: "Search · Polyswap",
  robots: PRIVATE_PAGE_ROBOTS,
};

export default function MarketsSearchPage() {
  return (
    <Suspense fallback={null}>
      <MarketsSearchView />
    </Suspense>
  );
}
