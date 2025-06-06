
import type { Timestamp } from 'firebase/firestore';
import type { NegotiationSuggestionsOutput } from '@/ai/flows/negotiation-suggestions-flow';
import type { ExtractReceiptDetailsOutput as AIReceiptOutput } from '@/ai/flows/extract-receipt-details-flow'; // Import AI receipt type


export interface EditableInvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  // total will be calculated: quantity * unitPrice
}

export interface EditableInvoiceDetails {
  creatorName?: string;
  creatorAddress?: string;
  creatorEmail?: string;
  clientName?: string;
  clientAddress?: string;
  clientEmail?: string;
  invoiceNumber: string;
  invoiceDate: string; // YYYY-MM-DD
  dueDate: string;     // YYYY-MM-DD
  projectName?: string;
  deliverables: EditableInvoiceLineItem[];
  // totalAmount will be calculated from deliverables
  paymentInstructions?: string;
  // payInvoiceLink is generated, not edited by user directly here.
}

export interface Contract {
  id: string; // Document ID from Firestore
  userId: string; // Firebase Auth User ID
  brand: string;
  amount: number; // This will represent the total amount of the invoice, derived from editableInvoiceDetails if present
  dueDate: string; // YYYY-MM-DD
  status: 'pending' | 'paid' | 'overdue' | 'at_risk' | 'invoiced';
  contractType: 'sponsorship' | 'consulting' | 'affiliate' | 'retainer' | 'other';
  projectName?: string; // Optional project name
  
  // Client details for invoicing
  clientName?: string;
  clientEmail?: string;
  clientAddress?: string;
  paymentInstructions?: string; // Base payment instructions from contract

  extractedTerms?: {
    paymentMethod?: string;
    usageRights?: string;
    terminationClauses?: string;
    deliverables?: string[]; // AI extracted deliverables list
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
  
  editableInvoiceDetails?: EditableInvoiceDetails | null; // Structured, editable invoice data

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

// Receipt Feature Types
export type ExtractedReceiptData = AIReceiptOutput; // Use the Zod inferred type from the AI flow

export interface Receipt {
  id: string; // Document ID from Firestore
  userId: string;
  receiptImageUrl: string;
  receiptFileName: string;
  uploadedAt: Timestamp;
  ocrData?: ExtractedReceiptData | null; // Data directly from AI
  userEditedData?: { // User overrides/confirmations
    vendorName?: string;
    receiptDate?: string; // YYYY-MM-DD
    totalAmount?: number;
    currency?: string;
    lineItems?: Array<{ description?: string; quantity?: number; unitPrice?: number; totalPrice?: number; }>;
    category?: string; // User-set category
  } | null;
  status: 'processing' | 'needs_review' | 'categorized' | 'archived' | 'error';
  category?: string; // Final confirmed category
  notes?: string;
  contractId?: string | null; // Optional link to a contract
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}
