import { CreateSwapView } from "@/components/create/CreateSwapView";
import { PRIVATE_PAGE_ROBOTS } from "@/server/seo";

interface Props {
  params: Promise<{ marketId: string }>;
}

export const metadata = {
  title: "Set up a swap · Polyswap",
  robots: PRIVATE_PAGE_ROBOTS,
};

export default async function CreateSwapPage({ params }: Props) {
  const { marketId } = await params;
  return <CreateSwapView marketId={marketId} />;
}
