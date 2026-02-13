
import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import './globals.css';
import '@syncfusion/ej2-base/styles/tailwind.css';
import '@syncfusion/ej2-buttons/styles/tailwind.css';
import '@syncfusion/ej2-dropdowns/styles/tailwind.css';
import '@syncfusion/ej2-inputs/styles/tailwind.css';
import '@syncfusion/ej2-lists/styles/tailwind.css';
import '@syncfusion/ej2-navigations/styles/tailwind.css';
import '@syncfusion/ej2-popups/styles/tailwind.css';
import '@syncfusion/ej2-splitbuttons/styles/tailwind.css';
import '@syncfusion/ej2-react-documenteditor/styles/tailwind.css';
import { Toaster } from '@/components/ui/toaster';
import { AuthProvider } from '@/hooks/use-auth'; 
import { AuthGuard } from '@/components/auth-gaurd';
import { ThemeProvider } from "next-themes";
import { TourProvider } from '@/hooks/use-tour';
import { TourGuide } from '@/components/tour/tour-guide';

export const metadata: Metadata = {
  title: 'Verza', // Updated title
  description: 'Smart contract management for creators.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body 
        className={`${GeistSans.className} antialiased`}
        suppressHydrationWarning
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <AuthProvider> 
            <TourProvider>
              <AuthGuard>
                {children}
              </AuthGuard>
              <TourGuide />
              <Toaster />
            </TourProvider>
          </AuthProvider> 
        </ThemeProvider>
      </body>
    </html>
  );
}

    