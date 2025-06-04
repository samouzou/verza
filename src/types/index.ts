
import type { Timestamp } from 'firebase/firestore';
import type { NegotiationSuggestionsOutput } from '@/ai/flows/negotiation-suggestions-flow';

export interface Contract {
  id: string; // Document ID from Firestore
  userId: string; // Firebase Auth User ID
  brand: string;
  amount: number;
  dueDate: string; // YYYY-MM-DD
  status: 'pending' | 'paid' | 'overdue' | 'at_risk' | 'invoiced';
  contractType: 'sponsorship' | 'consulting' | 'affiliate' | 'retainer' | 'other';
  projectName?: string; // Optional project name
  
  // Client details for invoicing
  clientName?: string;
  clientEmail?: string;
  clientAddress?: string;
  paymentInstructions?: string;

  extractedTerms?: {
    paymentMethod?: string;
    usageRights?: string;
    terminationClauses?: string;
    deliverables?: string[];
    lateFeePenalty?: string;
  };
  summary?: string;
  contractText?: string;
  fileName?: string;
  fileUrl: string | null;
  negotiationSuggestions?: NegotiationSuggestionsOutput | null;
  
  // Invoice-specific fields
  invoiceStatus?: 'none' | 'draft' | 'sent' | 'viewed' | 'paid' | 'overdue';
  invoiceHtmlContent?: string;
  invoiceNumber?: string;
  invoiceHistory?: Array<{ timestamp: Timestamp; action: string; details?: string }>;
  lastReminderSentAt?: Timestamp | null;
  
  // Recurrence fields
  isRecurring?: boolean;
  recurrenceInterval?: 'monthly' | 'quarterly' | 'annually';
  
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export interface EarningsDataPoint {
  month: string; // e.g., "Jan", "Feb"
  year: number; // e.g., 2024
  collected: number;
  invoiced: number;
}

export interface UpcomingIncome extends Pick<Contract, 'id' | 'brand' | 'amount' | 'dueDate' | 'projectName'> {}

export interface AtRiskPayment extends Pick<Contract, 'id' | 'brand' | 'amount' | 'dueDate' | 'status' | 'projectName'> {
  riskReason: string;
}

// For Firestore user document
export interface UserProfileFirestoreData {
  uid: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  emailVerified: boolean;
  address?: string | null;
  createdAt?: Timestamp;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  subscriptionStatus?: 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete' | 'none';
  trialEndsAt?: Timestamp | null;
  subscriptionEndsAt?: Timestamp | null;
  trialExtensionUsed?: boolean;
  stripeAccountId?: string | null;
  stripeAccountStatus?: 'none' | 'onboarding_incomplete' | 'pending_verification' | 'active' | 'restricted' | 'restricted_soon';
  stripeChargesEnabled?: boolean;
  stripePayoutsEnabled?: boolean;
}
