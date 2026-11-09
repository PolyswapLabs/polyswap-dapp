import { DashboardPage } from "@/components/dashboard/DashboardPage";
import { PRIVATE_PAGE_ROBOTS } from "@/lib/seo";

export const metadata = {
  title: "My swaps · Polyswap",
  robots: PRIVATE_PAGE_ROBOTS,
};

export default function DashboardRoute() {
  return <DashboardPage />;
}
