import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import { AuthProvider } from '@/hooks/use-auth'; 
import { AuthGuard } from '@/components/auth-gaurd';
import { ThemeProvider } from "next-themes";

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
        className={`${GeistSans.variable} antialiased font-sans`}
        suppressHydrationWarning
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <AuthProvider> 
            <AuthGuard>
              {children}
            </AuthGuard>
            <Toaster />
          </AuthProvider> 
        </ThemeProvider>
      </body>
    </html>
  );
}
