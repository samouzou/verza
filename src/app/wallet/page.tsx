import { PageHeader } from "@/components/page-header";
import { WalletOverview } from "@/components/wallet/wallet-overview";
import { TransactionHistory } from "@/components/wallet/transaction-history";

export default function WalletPage() {
  return (
    <>
      <PageHeader
        title="Creator Wallet"
        description="View your earnings and manage payouts (UI Placeholder)."
      />
      <div className="space-y-8">
        <WalletOverview />
        <TransactionHistory />
      </div>
    </>
  );
}
