
# Verza Brand-Side Technical Brief

This document outlines the core business logic and integration requirements for the brand/marketing side of the Verza Marketplace.

## 1. Core Mission
Verza is the **operating system for the creator economy**. On the brand side, our goal is to turn "Influencer Marketing" into "Automated Performance Content" by removing friction in payments, quality control, and legal.

## 2. The Campaign Vault (Escrow) Logic
**Zero-Risk for Creators, Zero-Friction for Brands.**
- **Funding**: All gigs MUST be pre-funded. Use the `createGigFundingCheckoutSession` function.
- **Wallet**: Brands (Agencies) have a wallet. `availableBalance` is for top-ups; `escrowBalance` is for funds committed to active gigs.
- **Payout**: Funds are released only when a brand approves a verified submission. Use the `payoutCreatorForGig` function. This handles the 15% platform fee and transfers the net amount to the creator's Stripe account instantly.

## 3. The Quality Gate: Verza Score
- Every submission must pass **The Gauntlet** (AI simulation of 10k Gen Z scrollers).
- **Pass Threshold**: 65/100.
- Brands should not just see the score, but the **Feedback**. The AI feedback provides actionable insights into why content hits or misses (e.g., "The hook pacing is off").

## 4. Roster & Talent Management
- Brands can operate as **Agencies**.
- Agencies can invite creators to their "Roster" with a defined **Commission Rate**.
- When a rostered creator gets paid for a contract, the system automatically splits the payout: 
  - (Net Amount) * (Commission Rate) -> Agency Owner's Stripe.
  - (Net Amount) * (1 - Commission Rate) -> Creator's Stripe.

## 5. Marketplace Dynamics
- **Campaign Types**: 
  - `standard_sponsorship`: Commercial ad-read required.
  - `production_grant`: Editorial support (brand gets credit, creator keeps inventory).
- **Usage Rights**: Defined at the gig level (`30_days`, `1_year`, `perpetuity`). This is legally binding upon gig acceptance.
- **Whitelisting**: Brands can toggle this to request access to run ads through creator handles.

## 6. Real-Time Interactions
- **Notifications**: Trigger `submission_received` when a creator passes the Verza Score.
- **Messaging**: The "Share for Feedback" feature allows brands to comment and propose redlines on contracts without email back-and-forth.

## 7. Compliance
- Collect W-9 info (Legal Name, TIN, Address) in the brand profile to generate end-of-year Tax Summaries automatically.
