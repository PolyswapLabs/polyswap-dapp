import { PageShell } from "@/components/layout/PageShell";
import { PolymarketDataGate } from "@/components/providers/PolymarketDataGate";
import { WalletModalProvider } from "@/components/modals/WalletModalProvider";
import ClientWeb3Provider from "@/components/providers/ClientWeb3Provider";
import { RuntimeConfigProvider } from "@/components/providers/RuntimeConfigProvider";
import { UnavailableModal } from "@/components/modals/UnavailableModal";
import { BetaNoticeModal } from "@/components/modals/BetaNoticeModal";
import {
  isDappMaintenanceMode,
  isOrderCreationDisabled,
  isPolymarketSentinelPostOnly,
} from "@/shared/env";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  if (isDappMaintenanceMode()) {
    return (
      <UnavailableModal
        heading="Under maintenance"
        body="Polyswap is temporarily unavailable while maintenance is in progress. Please return to the home page and try again later."
      />
    );
  }

  return (
    <PolymarketDataGate>
      <RuntimeConfigProvider
        orderCreationDisabled={isOrderCreationDisabled()}
        polymarketSentinelPostOnly={isPolymarketSentinelPostOnly()}
      >
        <ClientWeb3Provider>
          <WalletModalProvider>
            <PageShell>{children}</PageShell>
            <BetaNoticeModal />
          </WalletModalProvider>
        </ClientWeb3Provider>
      </RuntimeConfigProvider>
    </PolymarketDataGate>
  );
}
