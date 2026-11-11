import { DashboardView } from "@/components/dashboard/DashboardView";
import { PRIVATE_PAGE_ROBOTS } from "@/server/seo";

export const metadata = {
  title: "My swaps · Polyswap",
  robots: PRIVATE_PAGE_ROBOTS,
};

export default function DashboardPage() {
  return <DashboardView />;
}
