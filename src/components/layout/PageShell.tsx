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
      <main className="mx-auto w-full max-w-[1280px] flex-1 px-6 sm:px-8 lg:px-12">{children}</main>
      <Footer />
    </div>
  );
}
