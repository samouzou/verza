"use client";

import { usePathname, useSearchParams } from 'next/navigation';
import Script from 'next/script';
import { useEffect, Suspense } from 'react';
import { GA_MEASUREMENT_ID } from '@/lib/analytics';

/**
 * @fileOverview Google Analytics (gtag.js) implementation with automatic page view tracking on route changes.
 */

function AnalyticsInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (pathname && (window as any).gtag) {
      (window as any).gtag('config', GA_MEASUREMENT_ID, {
        page_path: pathname + searchParams.toString(),
      });
    }
  }, [pathname, searchParams]);

  return null;
}

export function GoogleAnalytics() {
  return (
    <>
      <Script
        async
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());

          gtag('config', '${GA_MEASUREMENT_ID}', {
            page_path: window.location.pathname,
          });
        `}
      </Script>
      <Suspense fallback={null}>
        <AnalyticsInner />
      </Suspense>
    </>
  );
}
