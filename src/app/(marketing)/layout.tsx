import { LandingHeader } from "@/components/landing/LandingHeader";
import { Footer } from "@/components/layout/Footer";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <LandingHeader />
      {children}
      <Footer />
    </div>
  );
}
