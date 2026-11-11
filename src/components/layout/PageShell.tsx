"use client";

import { Masthead } from "./Masthead";
import { Footer } from "./Footer";
import { useWalletModal } from "@/components/modals/WalletModalProvider";

interface Props {
  children: React.ReactNode;
}

export function PageShell({ children }: Props) {
  const wallet = useWalletModal();

  return (
    <div className="flex min-h-screen flex-col">
      <Masthead onConnectWallet={wallet.open} />
      <main className="page-container w-full flex-1">{children}</main>
      <Footer />
    </div>
  );
}
