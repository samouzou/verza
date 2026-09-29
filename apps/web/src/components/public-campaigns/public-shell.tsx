import Link from 'next/link';
import Image from 'next/image';
import type { ReactNode } from 'react';

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen overflow-x-clip bg-secondary/40 text-foreground">
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/campaigns/open" className="flex items-center gap-2 font-semibold">
            <Image src="/verza-icon.svg" alt="Verza" width={28} height={28} />
            <span>Verza</span>
            <span className="hidden text-sm font-normal text-muted-foreground sm:inline">· Creator campaigns</span>
          </Link>
          <nav className="flex items-center gap-3 text-sm sm:gap-4">
            <Link href="/campaigns/open" className="hidden text-muted-foreground hover:text-foreground sm:inline">
              Open campaigns
            </Link>
            <Link
              href="/login"
              className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground hover:bg-primary/90"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-12">{children}</main>
      <footer className="border-t bg-background">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Verza. Paid creator campaigns from real brands.</span>
          <span className="flex gap-4">
            <a href="https://www.tryverza.com" className="hover:text-foreground">tryverza.com</a>
            <a href="https://www.tryverza.com/terms-of-service" className="hover:text-foreground">Terms</a>
            <a href="https://www.tryverza.com/privacy-policy" className="hover:text-foreground">Privacy</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
