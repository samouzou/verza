// Adding a comment to refresh compilation context
import type { Timestamp } from 'firebase/firestore';
import type { NegotiationSuggestionsOutput } from '../ai/flows/negotiation-suggestions-flow';

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
  userId: string; // Firebase Auth User ID of the creator/talent
  ownerType: 'user' | 'agency'; // To distinguish personal vs agency contracts
  ownerId: string; // UID of the user or ID of the agency
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
  clientTin?: string;
  paymentInstructions?: string; // Base payment instructions from contract

  extractedTerms?: {
    paymentMethod?: string;
    usageRights?: string;
    terminationClauses?: string;
    deliverables?: string[]; // AI extracted deliverables list
    lateFeePenalty?: string;
  };
  summary?: string;
  contractText?: string | null;
  previousContractText?: string | null;
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

  // E-Signature fields (HelloSign/Dropbox Sign)
  helloSignRequestId?: string | null;
  signatureStatus?: 'none' | 'sent' | 'viewed_by_signer' | 'signed' | 'declined' | 'canceled' | 'error' | null;
  signedDocumentUrl?: string | null;
  lastSignatureEventAt?: Timestamp | null;
  lastGeneratedSignatureFilePath?: string | null;
  
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

// Interface for a snapshot of a contract version shared with a brand
export interface SharedContractVersion {
  id: string; // Document ID (the unique share token)
  originalContractId: string; // ID of the parent contract
  userId: string; // Creator's UID
  sharedAt: Timestamp;
  contractData: Omit<Contract, 'id' | 'userId' | 'createdAt' | 'updatedAt' | 'invoiceHistory' | 'lastReminderSentAt' | 'negotiationSuggestions' | 'helloSignRequestId' | 'signatureStatus' | 'signedDocumentUrl' | 'lastSignatureEventAt'>; // Snapshot of relevant contract data at time of sharing
  notesForBrand: string | null;
  status: 'active' | 'revoked'; // Status of this share link
  brandHasViewed?: boolean;
  lastViewedByBrandAt?: Timestamp;
}

export interface CommentReply {
  replyId: string; // Unique ID for the reply (client-generated or Firestore ID if subcollection)
  creatorId: string; // UID of the creator replying
  creatorName: string; // Display name of the creator
  replyText: string;
  repliedAt: Timestamp;
}

// Interface for comments made by a brand on a shared contract version
export interface ContractComment {
  id: string; // Comment ID, will be Firestore document ID
  sharedVersionId: string; // Link to the SharedContractVersion
  originalContractId: string; // ID of the parent contract
  creatorId: string; // UID of the creator who owns the shared version (for rules/queries)
  commenterName: string;
  commenterEmail?: string; // Optional
  commentText: string;
  commentedAt: Timestamp;
  replies?: CommentReply[]; // Array of replies
}

export interface RedlineProposal {
  id: string; // Firestore document ID
  sharedVersionId: string;
  originalContractId: string;
  creatorId: string; // The user ID of the contract creator
  proposerName: string;
  proposerEmail?: string | null;
  originalText: string; // The exact text snippet to be replaced
  proposedText: string; // The suggested replacement text
  comment?: string | null; // Justification or comment for the change
  status: 'proposed' | 'accepted' | 'rejected';
  proposedAt: Timestamp;
  reviewedAt?: Timestamp | null;
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
  tin?: string | null;
  createdAt?: Timestamp;
  role: 'individual_creator' | 'agency_owner';
  isAgencyOwner?: boolean; // Added this field
  agencyMemberships?: AgencyMembership[];
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  subscriptionStatus?: 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete' | 'none';
  subscriptionInterval?: 'month' | 'year' | null; 
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
  
  description?: string; 
  category?: string;    
  amount?: number;      
  receiptDate?: string; 
  vendorName?: string;  

  linkedContractId: string | null; 

  receiptImageUrl: string;
  receiptFileName: string;
  
  status: 'uploaded' | 'linked' | 'submitted_for_reimbursement' | 'reimbursed' | 'archived'; 
  
  uploadedAt: Timestamp;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

// Banking & Tax Feature Types
export interface BankAccount {
  id: string;
  userId: string;
  providerAccountId: string;
  name: string;
  officialName: string | null;
  mask: string;
  type: string;
  subtype: string | null;
  balance: number;
  provider: "Finicity"; // Or other providers in the future
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface BankTransaction {
  id: string; 
  userId: string;
  accountId: string; 
  date: string; 
  description: string;
  amount: number; 
  currency: string;
  category?: string; 
  isTaxDeductible?: boolean;
  isBrandSpend?: boolean; 
  linkedReceiptId?: string | null; 
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export interface TaxEstimation {
  estimatedTaxableIncome: number;
  estimatedTaxOwed: number;
  suggestedSetAsidePercentage: number;
  suggestedSetAsideAmount: number;
  notes?: string[]; 
  calculationDate: string; 
}

// Agency & Talent Types
export interface Talent {
  userId: string;
  email: string;
  displayName: string | null;
  status: 'pending' | 'active';
  joinedAt?: Timestamp;
}

export interface Agency {
  id: string;
  name: string;
  ownerId: string; // UID of the user who owns the agency
  createdAt: Timestamp;
  updatedAt?: Timestamp;
  talent: Talent[];
}

export interface AgencyMembership {
  agencyId: string;
  agencyName: string;
  role: 'owner' | 'talent';
  status: 'pending' | 'active';
}
