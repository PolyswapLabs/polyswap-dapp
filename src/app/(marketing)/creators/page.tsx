import { CreatorsPage } from "@/components/creators";
import { publicPageMetadata } from "@/lib/seo";

export const metadata = publicPageMetadata({
  title: "Meet the creators | Polyswap",
  description:
    "Meet Polyswap co-founders Lucas Leclerc and Baptiste Florentin. The team built the contracts, listener, app and design after ETHGlobal Bangkok.",
  path: "/creators",
});

export default function CreatorsRoute() {
  return (
    <main className="page-container w-full flex-1">
      <CreatorsPage />
    </main>
  );
}
