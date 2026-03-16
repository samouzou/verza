/**
 * @fileOverview Analytics utility for tracking custom events in Google Analytics.
 */

export const GA_MEASUREMENT_ID = 'G-P25WPM207C';

type GTagEvent = {
  action: string;
  category: string;
  label: string;
  value?: number;
  currency?: string;
};

/**
 * Log a custom event to Google Analytics.
 * @param event The event details to track.
 */
export const trackEvent = ({ action, category, label, value, currency = 'USD' }: GTagEvent) => {
  if (typeof window !== 'undefined' && (window as any).gtag) {
    (window as any).gtag('event', action, {
      event_category: category,
      event_label: label,
      value: value,
      currency: currency,
    });
  }
};
