
'use server';
/**
 * @fileOverview Generates HTML for an invoice based on contract details.
 *
 * - generateInvoiceHtml - A function that handles invoice HTML generation.
 * - GenerateInvoiceHtmlInput - The input type for the function.
 * - GenerateInvoiceHtmlOutput - The return type for the function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import type { Contract } from '@/types'; // Assuming Contract type has relevant fields

const GenerateInvoiceHtmlInputSchema = z.object({
  // Creator's details
  creatorName: z.string().optional().default("Your Company/Name"),
  creatorAddress: z.string().optional().default("123 Creator Lane, Suite 100, Creative City, CC 12345"),
  creatorEmail: z.string().optional().default("you@example.com"),
  
  // Client details from Contract
  clientName: z.string().optional().describe("The name of the client or brand being invoiced."),
  clientAddress: z.string().optional().describe("The mailing address of the client."),
  clientEmail: z.string().optional().describe("The email address of the client for billing."),

  // Invoice specifics
  invoiceNumber: z.string().describe("The unique identifier for this invoice."),
  invoiceDate: z.string().describe("The date the invoice is issued (YYYY-MM-DD)."),
  dueDate: z.string().describe("The date the payment is due (YYYY-MM-DD)."),
  
  // Contract details
  contractId: z.string().describe("The ID of the related contract."),
  projectName: z.string().optional().describe("The name of the project this invoice is for."),
  deliverables: z.array(z.object({ description: z.string(), quantity: z.number().default(1), unitPrice: z.number(), total: z.number() })).describe("List of services or deliverables with pricing."),
  totalAmount: z.number().describe("The total amount due for this invoice."),
  paymentInstructions: z.string().optional().describe("Instructions for how the client should make the payment (e.g., bank details, PayPal)."),
  payInvoiceLink: z.string().optional().describe("The fully qualified URL that the 'Pay Now' button in the invoice should point to. If provided, include a prominent 'Pay Now' button."),
});
export type GenerateInvoiceHtmlInput = z.infer<typeof GenerateInvoiceHtmlInputSchema>;

const GenerateInvoiceHtmlOutputSchema = z.object({
  invoiceHtml: z.string().describe('The generated HTML content for the invoice.'),
});
export type GenerateInvoiceHtmlOutput = z.infer<typeof GenerateInvoiceHtmlOutputSchema>;

export async function generateInvoiceHtml(input: GenerateInvoiceHtmlInput): Promise<GenerateInvoiceHtmlOutput> {
  return generateInvoiceHtmlFlow(input);
}

const prompt = ai.definePrompt({
  name: 'generateInvoiceHtmlPrompt',
  input: {schema: GenerateInvoiceHtmlInputSchema},
  output: {schema: GenerateInvoiceHtmlOutputSchema},
  prompt: `
  You are an AI assistant that generates professional HTML invoices.
  Generate an HTML document for an invoice with the following details.
  Use basic inline CSS for styling to ensure it's reasonably well-formatted.
  The HTML should be a single, complete HTML document structure.

  Creator Information:
  - Name: {{{creatorName}}}
  - Address: {{{creatorAddress}}}
  - Email: {{{creatorEmail}}}

  Client Information:
  - Name: {{{clientName}}}
  - Address: {{{clientAddress}}}
  - Email: {{{clientEmail}}}

  Invoice Details:
  - Invoice Number: {{{invoiceNumber}}}
  - Invoice Date: {{{invoiceDate}}}
  - Due Date: {{{dueDate}}}
  - Project Name: {{{projectName}}} (if available)

  Line Items:
  {{#each deliverables}}
  - Description: {{{this.description}}}, Quantity: {{{this.quantity}}}, Unit Price: \${{{this.unitPrice}}}, Total: \${{{this.total}}}
  {{/each}}

  Total Amount Due: \${{{totalAmount}}}

  {{#if payInvoiceLink}}
  Payment Link (for Pay Now button): {{{payInvoiceLink}}}
  {{/if}}

  Payment Instructions:
  {{{paymentInstructions}}}

  Please structure this as a clean HTML page. Include a prominent "Pay Now" button if a 'Payment Link' is provided above.
  Style the "Pay Now" button to be noticeable, for example, with a background color and padding.

  Example structure:
  <!DOCTYPE html>
  <html>
  <head>
    <title>Invoice {{{invoiceNumber}}}</title>
    <style>
      body { font-family: sans-serif; margin: 20px; color: #333; }
      .invoice-box { max-width: 800px; margin: auto; padding: 30px; border: 1px solid #eee; box-shadow: 0 0 10px rgba(0, 0, 0, .15); font-size: 16px; line-height: 24px; }
      .header, .client-details, .items-table, .totals, .payment-instructions, .pay-now-section { margin-bottom: 20px; }
      .header table { width: 100%; }
      .header table td { padding: 5px; vertical-align: top; }
      .header .invoice-details { text-align: right; }
      .items-table table { width: 100%; border-collapse: collapse; }
      .items-table table th, .items-table table td { border: 1px solid #ddd; padding: 8px; text-align: left; }
      .items-table table th { background-color: #f2f2f2; }
      .text-right { text-align: right; }
      .bold { font-weight: bold; }
      .pay-now-button { display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px; font-size: 16px; text-align: center;}
    </style>
  </head>
  <body>
    <div class="invoice-box">
      <!-- Header Section with Creator and Invoice Details -->
      <!-- Client Details Section -->
      <!-- Items Table Section -->
      <!-- Totals Section -->
      {{#if payInvoiceLink}}
      <div class="pay-now-section" style="text-align: center; margin-top: 30px;">
        <a href="{{{payInvoiceLink}}}" class="pay-now-button">Pay Now</a>
      </div>
      {{/if}}
      <!-- Payment Instructions Section -->
      <!-- Footer (Optional: Thank you note) -->
    </div>
  </body>
  </html>
  `,
});

const generateInvoiceHtmlFlow = ai.defineFlow(
  {
    name: 'generateInvoiceHtmlFlow',
    inputSchema: GenerateInvoiceHtmlInputSchema,
    outputSchema: GenerateInvoiceHtmlOutputSchema,
  },
  async (input) => {
    const {output} = await prompt(input);
    return output!;
  }
);

