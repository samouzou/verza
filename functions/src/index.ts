/**
 * Verza Contract Management Firebase Functions
 *
 * This file exports all the functions used in the Verza application:
 * - Payment processing functions
 * - Email notification functions
 * - Scheduled tasks
 */

import {
  createStripeConnectedAccount,
  createStripeAccountLink,
  createPaymentIntent,
  handlePaymentSuccess,
  handleStripeAccountWebhook,
} from "./payments";

// Export payment-related functions
export {
  createStripeConnectedAccount,
  createStripeAccountLink,
  createPaymentIntent,
  handlePaymentSuccess,
  handleStripeAccountWebhook,
};

// Export notification functions
export * from "./notifications";

// Export scheduler functions
export * from "./scheduler";

import {
  createStripeSubscriptionCheckoutSession,
  createStripeCustomerPortalSession,
  stripeSubscriptionWebhookHandler,
} from "./subscriptions";

export {
  createStripeSubscriptionCheckoutSession,
  createStripeCustomerPortalSession,
  stripeSubscriptionWebhookHandler,
};
