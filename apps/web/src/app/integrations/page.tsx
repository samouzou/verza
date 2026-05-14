import { PageHeader } from "@/components/page-header";
import { IntegrationCard } from "@/components/integrations/integration-card";


export default function IntegrationsPage() {
  return (
    <>
      <PageHeader
        title="Integrations"
        description="Connect your accounts to automatically import contracts and invoices."
      />
      <div className="space-y-6">
        <IntegrationCard
          serviceName="Gmail"
          serviceIconName={"Mail"}
          description="Allow SoloLedger to read your inbox for brand deal emails, contracts, and invoices."
          isConnectedInitial={true} // Mock initial connected state
        />
        <IntegrationCard
          serviceName="Google Drive"
          serviceIconName={"Database"}
          description="Parse files (PDFs, .docx) from your Google Drive. Looks for keywords like 'Contract', 'Agreement', 'Invoice'."          
        />
        <IntegrationCard
          serviceName="Dropbox"
          serviceIconName={"Cloud"}
          // loadServiceIcon={loadCloudIcon}
          description="Connect your Dropbox account to find and parse relevant documents."
        />
      </div>
      <div className="mt-8 p-4 bg-accent/20 border border-accent/30 rounded-lg text-sm text-accent-foreground/80">
       <p className="font-semibold mb-1">Privacy Note:</p>
       <p>SoloLedger only requests read-access to find relevant documents and will never modify or delete your files. You can revoke access at any time.</p>
      </div>
    </>
  );
}
