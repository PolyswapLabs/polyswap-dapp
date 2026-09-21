import { CreatePage } from "@/components/create";
import { PRIVATE_PAGE_ROBOTS } from "@/lib/seo";

interface Props {
  params: Promise<{ marketId: string }>;
}

export const metadata = {
  title: "Set up a swap · Polyswap",
  robots: PRIVATE_PAGE_ROBOTS,
};

export default async function CreateRoutePage({ params }: Props) {
  const { marketId } = await params;
  return <CreatePage marketId={marketId} />;
}
