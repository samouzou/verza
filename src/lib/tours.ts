
import type { Tour } from '@/types';

export const dashboardTour: Tour = {
  id: 'dashboard-tour',
  steps: [
    {
      selector: '#summary-card-pending-income',
      title: 'Pending Income',
      content: 'This card shows the total amount of money you have invoiced but not yet received, based on the current filters.',
      side: 'bottom',
      align: 'start',
    },
    {
      selector: '#summary-card-total-contracts',
      title: 'Total Contracts',
      content: 'A quick count of all the active contracts you are managing in Verza.',
      side: 'bottom',
    },
    {
      selector: '#summary-card-at-risk',
      title: 'At-Risk Payments',
      content: 'Highlights payments that are overdue or due very soon, helping you stay on top of your cash flow.',
      side: 'bottom',
      align: 'end',
    },
    {
      selector: '#earnings-chart-container',
      title: 'Earnings Chart',
      content: 'Visualize your collected vs. invoiced income over the year to track your financial performance.',
      side: 'bottom',
      align: 'center',
    },
    {
      selector: '#upcoming-income-container',
      title: 'Upcoming Income',
      content: 'A list of your next expected payments based on the due dates of your sent invoices.',
      side: 'left',
      align: 'start',
    },
    {
      selector: '#at-risk-payments-container',
      title: 'At-Risk Details',
      content: 'This table provides a detailed look at all payments that need your attention, including overdue and soon-to-be-due invoices.',
      side: 'top',
      align: 'center',
    },
  ],
};

export const contractsTour: Tour = {
  id: 'contracts-tour',
  steps: [
    {
      selector: '#add-contract-button',
      title: 'Add a Contract',
      content: 'Click here to start a new contract. You can upload a file (DOCX, PDF, image) or paste text directly for our AI to analyze.',
      side: 'bottom',
      align: 'end',
    },
    {
      selector: '#contract-search-input',
      title: 'Search Contracts',
      content: 'Quickly find any contract by searching for a brand name, file name, or contract type.',
      side: 'bottom',
      align: 'start',
    },
    {
      selector: '#contract-list-container',
      title: 'Your Contracts',
      content: 'All of your contracts are listed here. You can see their status, amount, and due date at a glance.',
      side: 'top',
      align: 'center',
    },
     {
      selector: '#contract-actions-menu',
      title: 'Contract Actions',
      content: 'Use this menu to view, edit, or delete a contract.',
      side: 'left',
      align: 'end',
    },
  ],
};

export const insightsTour: Tour = {
  id: 'insights-tour',
  steps: [
    {
      selector: '#connect-accounts-card',
      title: 'Connect Your Social Accounts',
      content: 'Start by connecting your Instagram, TikTok, or YouTube accounts. This allows Verza to fetch your engagement data for analysis.',
      side: 'bottom',
      align: 'start',
    },
    {
      selector: '#how-it-works-card',
      title: 'How Insights Work',
      content: 'Once connected, Verza provides trends and AI-powered estimates to help you gauge your market value for brand deals.',
      side: 'top',
      align: 'start',
    },
  ],
};
