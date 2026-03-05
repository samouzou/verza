"use client";

import Script from 'next/script';

/**
 * @fileOverview Google Analytics (gtag.js) implementation.
 */
export function GoogleAnalytics() {
  return (
    <>
      <Script
        async
        src="https://www.googletagmanager.com/gtag/js?id=G-P25WPM207C"
        strategy="afterInteractive"
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());

          gtag('config', 'G-P25WPM207C');
        `}
      </Script>
    </>
  );
}
