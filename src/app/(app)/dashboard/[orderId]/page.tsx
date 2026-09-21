import { SwapDetailPage } from "@/components/dashboard";
import { PRIVATE_PAGE_ROBOTS } from "@/lib/seo";

interface Props {
  params: Promise<{ orderId: string }>;
}

export const metadata = {
  title: "Swap · Polyswap",
  robots: PRIVATE_PAGE_ROBOTS,
};

export default async function SwapDetailRoute({ params }: Props) {
  const { orderId } = await params;
  return <SwapDetailPage orderId={orderId} />;
}
