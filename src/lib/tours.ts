
import type { Tour } from '@/types';

export const getStartedTour: Tour = {
  id: 'get-started-tour',
  steps: [
    {
      selector: '#nav-item-gigs',
      title: 'Welcome to the Exchange',
      content: "This is where you find paid opportunities. Brands post gigs here, and your verified stats help you stand out.",
      side: 'right',
      align: 'start',
    },
    {
      selector: '#nav-item-scene-spawner',
      title: 'Unleash Your Creativity',
      content: "Use AI to generate high-quality video clips and images. Perfect for iterating on hooks or creating B-roll.",
      side: 'right',
      align: 'start',
    },
  ],
};

export const dashboardTour: Tour = {
  id: 'dashboard-tour',
  steps: [
    {
      selector: '#summary-card-pending-income',
      title: 'Secured Income',
      content: 'Track your pending payments. These are funds held in Verza Campaign Vaults waiting for your verified submissions.',
      side: 'bottom',
      align: 'start',
    },
    {
      selector: '#earnings-chart-container',
      title: 'Growth Analytics',
      content: 'Visualize your collected vs. invoiced income. This chart helps you understand your business seasonality.',
      side: 'bottom',
      align: 'center',
    },
    {
      selector: '#summary-card-at-risk',
      title: 'ROI Protection',
      content: 'We highlight payments that are overdue or at risk, so you never lose track of what you are owed.',
      side: 'bottom',
      align: 'end',
    },
  ],
};

export const marketplaceTour: Tour = {
  id: 'marketplace-tour',
  steps: [
    {
      selector: '#marketplace-filters',
      title: 'Filter Opportunities',
      content: 'Filter by platform, niche, or minimum rate to find the gigs that match your style and value.',
      side: 'bottom',
    },
    {
      selector: '.lg\\:col-span-1 .sticky', // Target the Co-Pilot
      title: 'Your Marketplace Co-Pilot',
      content: 'Verza AI analyzes market signals in real-time to give you tips on how to win more deals and increase your rates.',
      side: 'left',
    },
  ],
};

export const gigDetailTour: Tour = {
  id: 'gig-detail-tour',
  steps: [
    {
      selector: '.lg\\:col-span-3', // Target submission area
      title: 'The Quality Gate',
      content: 'Submit your work here. Every video must pass the Verza Score—a simulation of 10,000 Gen Z scrollers—to ensure high retention.',
      side: 'top',
    },
    {
      selector: '.text-primary.font-bold.text-2xl', // Target the rate
      title: 'Pre-Funded Rates',
      content: 'The payment for this gig is already secured in the vault. Once your verified work is approved, funds release instantly to your wallet.',
      side: 'bottom',
    },
  ],
};

export const sceneSpawnerTour: Tour = {
  id: 'scene-spawner-tour',
  steps: [
    {
      selector: '[role="tablist"]',
      title: 'Generation Modes',
      content: 'Choose between Text-to-Video, Image-to-Video, or Image-to-Image. Iterate on visual ideas faster than ever.',
      side: 'bottom',
    },
    {
      selector: '#character',
      title: 'Persistent Characters',
      content: 'Create a character once and reuse them across different scenes to maintain visual consistency in your storytelling.',
      side: 'top',
    },
  ],
};

export const insightsTour: Tour = {
  id: 'insights-tour',
  steps: [
    {
      selector: '#connect-accounts-card',
      title: 'Verified Verification',
      content: 'Connect your accounts to import live platform data. Brands prioritize creators with verified metrics over self-reported ones.',
      side: 'bottom',
      align: 'start',
    },
    {
      selector: '#analyze-profile-card',
      title: 'AI Brand Strategy',
      content: 'Let Verza AI analyze your cross-platform content to distill your specialized niche and find your top 5 ideal brand partners.',
      side: 'top',
      align: 'start',
    },
  ],
};

export const agencyTour: Tour = {
  id: 'agency-tour',
  steps: [
    {
      selector: '#talent-roster-card',
      title: 'Manage Your Roster',
      content: 'Track your talent, their verified metrics, and manage their commission rates in one unified dashboard.',
      side: 'top',
      align: 'center',
    },
    {
      selector: '#ai-contract-generator-card',
      title: 'One-Click Agreements',
      content: 'Don\'t let legal slow you down. Describe the terms and let AI generate a standardized talent agreement instantly.',
      side: 'top',
      align: 'start',
    },
    {
      selector: '#create-payout-card',
      title: 'Direct Talent Payouts',
      content: 'Send funds directly to your talent\'s connected bank accounts. We handle the fees and the financial logging automatically.',
      side: 'bottom',
      align: 'end',
    },
  ],
};

export const contractsTour: Tour = {
  id: 'contracts-tour',
  steps: [
    {
      selector: '#add-contract-button',
      title: 'Institutionalize Quality',
      content: 'Upload any contract. Our AI extracts the heavy lifting—amounts, due dates, and usage rights—so you can focus on the work.',
      side: 'bottom',
      align: 'end',
    },
    {
      selector: '#contract-list-container',
      title: 'Agreement Hub',
      content: 'All your brand deals organized by status. From draft to fully paid, you have total visibility.',
      side: 'top',
      align: 'center',
    },
  ],
};
