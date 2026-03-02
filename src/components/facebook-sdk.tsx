"use client";

import Script from 'next/script';
import * as React from 'react';

export function FacebookSDK() {
  React.useEffect(() => {
    // This ensures initialization happens only on the client
    (window as any).fbAsyncInit = function() {
      (window as any).FB.init({
        appId      : '823225343427188',
        cookie     : true,
        xfbml      : true,
        version    : 'v20.0'
      });
      (window as any).FB.AppEvents.logPageView();
    };
  }, []);

  return (
    <>
      <Script
        async
        defer
        crossOrigin="anonymous"
        src="https://connect.facebook.net/en_US/sdk.js"
        id="facebook-jssdk"
        strategy="afterInteractive"
      />
    </>
  );
}
