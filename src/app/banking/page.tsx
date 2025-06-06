
"use client";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, AlertTriangle, Landmark, BarChart3, TrendingUp, FileWarning } from "lucide-react";

// Placeholder for Finicity Connect - In a real scenario, you'd use their SDK/API
const handleConnectFinicity = () => {
  alert("Finicity connection flow would start here. (Coming Soon!)");
  // This would typically involve:
  // 1. Calling a backend endpoint to get a Finicity Connect URL.
  // 2. Redirecting the user to that URL or opening it in a modal/iframe.
  // 3. Handling the callback from Finicity after successful connection.
};

export default function BankingPage() {
  const { user, isLoading: authLoading } = useAuth();

  if (authLoading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>;
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4">
        <AlertTriangle className="w-16 h-16 text-destructive mb-4" />
        <h2 className="text-2xl font-semibold mb-2">Access Denied</h2>
        <p className="text-muted-foreground">Please log in to manage banking and tax information.</p>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Banking & Taxes"
        description="Connect bank accounts, categorize transactions, and estimate your taxes."
      />
      <div className="space-y-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Landmark className="h-6 w-6 text-primary" /> Bank Connections</CardTitle>
            <CardDescription>Securely connect your bank accounts using Finicity to import transactions.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Placeholder for connected accounts list */}
            <div className="p-4 border rounded-md bg-muted text-center">
              <p className="text-sm text-muted-foreground">No bank accounts connected yet.</p>
            </div>
            <Button onClick={handleConnectFinicity} className="w-full sm:w-auto">
              Connect Bank Account (Finicity - Coming Soon)
            </Button>
             <p className="text-xs text-muted-foreground">
              Verza uses Finicity, a Mastercard company, for secure bank connections. Your bank credentials are never stored by Verza.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BarChart3 className="h-6 w-6 text-primary" /> Transactions</CardTitle>
            <CardDescription>View, categorize, and manage your imported bank transactions.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="p-6 border rounded-md bg-muted text-center">
              <p className="text-lg text-muted-foreground">Transaction management coming soon!</p>
              <p className="text-sm text-muted-foreground mt-1">Once connected, your transactions will appear here for review and categorization.</p>
            </div>
            {/* Placeholder:
                - Transaction list/table
                - Filters (by account, date, category)
                - Ability to mark as 'tax deductible' or 'brand spend'
            */}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><TrendingUp className="h-6 w-6 text-primary" /> Tax Estimation</CardTitle>
            <CardDescription>Get an AI-powered estimate of your potential tax liability and suggested set-aside amounts.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="p-6 border rounded-md bg-muted text-center">
              <p className="text-lg text-muted-foreground">AI tax estimation coming soon!</p>
              <p className="text-sm text-muted-foreground mt-1">Categorize your income and expenses to get tax insights.</p>
            </div>
             <div className="mt-4 p-3 border-l-4 border-amber-500 bg-amber-50 dark:bg-amber-900/20 rounded-md">
                <div className="flex items-center gap-2">
                    <FileWarning className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                    <h3 className="font-semibold text-amber-700 dark:text-amber-300">Disclaimer</h3>
                </div>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                Tax estimations provided are for informational purposes only and should not be considered financial or legal advice. Consult with a qualified tax professional for personalized advice.
                </p>
            </div>
            {/* Placeholder:
                - Display for estimated tax owed, set-aside amount
                - Button to "Recalculate with AI"
            */}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
