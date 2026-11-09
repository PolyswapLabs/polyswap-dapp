import { SwapDetailView } from "@/components/dashboard/SwapDetailView";
import { PRIVATE_PAGE_ROBOTS } from "@/server/seo";

interface Props {
  params: Promise<{ orderId: string }>;
}

export const metadata = {
  title: "Swap · Polyswap",
  robots: PRIVATE_PAGE_ROBOTS,
};

export default async function SwapDetailPage({ params }: Props) {
  const { orderId } = await params;
  return <SwapDetailView orderId={orderId} />;
}
