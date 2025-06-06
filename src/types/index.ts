
import type { Timestamp } from 'firebase/firestore';
import type { NegotiationSuggestionsOutput } from '@/ai/flows/negotiation-suggestions-flow';

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

// Simplified Receipt Feature Types
export interface Receipt {
  id: string; // Document ID from Firestore
  userId: string;
  
  // User-provided information
  description?: string; // User's description for the receipt
  category?: string;    // User-set category
  amount?: number;      // Optional: user can enter amount if they want for their records
  receiptDate?: string; // Optional: user can enter date YYYY-MM-DD for their records
  vendorName?: string;  // Optional: user can enter vendor for their records

  linkedContractId: string | null; // Link to a contract (brand/client)

  // Image proof
  receiptImageUrl: string;
  receiptFileName: string;
  
  status: 'uploaded' | 'linked' | 'submitted_for_reimbursement' | 'reimbursed' | 'archived'; // Simplified status
  
  uploadedAt: Timestamp;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

// Banking & Tax Feature Types
export interface BankTransaction {
  id: string; // Transaction ID from bank or generated
  userId: string;
  accountId: string; // Link to a bank account if multiple are connected
  date: string; // ISO Date string
  description: string;
  amount: number; // Positive for income, negative for expenses
  currency: string;
  category?: string; // User-defined or from bank/Finicity
  isTaxDeductible?: boolean;
  isBrandSpend?: boolean; // For reimbursement
  linkedReceiptId?: string | null; // Link to a Receipt document
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export interface TaxEstimation {
  estimatedTaxableIncome: number;
  estimatedTaxOwed: number;
  suggestedSetAsidePercentage: number;
  suggestedSetAsideAmount: number;
  notes?: string[]; // e.g., reminders about specific deductions or credits
  calculationDate: string; // ISO Date string
}
