import { CreatorsPage } from "@/components/creators";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { Footer } from "@/components/layout/Footer";
import { publicPageMetadata } from "@/lib/seo";

export const metadata = publicPageMetadata({
  title: "Meet the creators | Polyswap",
  description:
    "Meet Polyswap co-founders Lucas Leclerc and Baptiste Florentin. The team built the contracts, listener, app and design after ETHGlobal Bangkok.",
  path: "/creators",
});

export default function CreatorsRoute() {
  return (
    <div className="flex min-h-screen flex-col">
      <LandingHeader />
      <main className="page-container w-full flex-1">
        <CreatorsPage />
      </main>
      <Footer />
    </div>
  );
}
