'use server';
/**
 * @fileOverview Extracts contract details (brand, amount, due date, and common terms) from contract documents using an LLM.
 *
 * - extractContractDetails - A function that handles the contract detail extraction process.
 * - ExtractContractDetailsInput - The input type for the extractContractDetails function.
 * - ExtractContractDetailsOutput - The return type for the extractContractDetails function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const ExtractContractDetailsInputSchema = z.object({
  contractText: z.string().describe('The text content of the contract document.'),
});
export type ExtractContractDetailsInput = z.infer<typeof ExtractContractDetailsInputSchema>;

const ExtractedTermsSchema = z.object({
  paymentMethod: z.string().optional().describe('The method of payment (e.g., Bank Transfer, PayPal).'),
  deliverables: z.array(z.string()).optional().describe('A list of key deliverables or services to be provided.'),
  usageRights: z.string().optional().describe('Usage rights for the content or services.'),
  terminationClauses: z.string().optional().describe('Summary of termination clauses.'),
  lateFeePenalty: z.string().optional().describe('Details about late fees or penalties.'),
}).describe('Key terms extracted from the contract. All fields are optional.');


const ExtractContractDetailsOutputSchema = z.object({
  brand: z.string().describe('The brand or counterparty name in the contract. If not found, use "Unknown Brand".'),
  amount: z.number().describe('The payment amount specified in the contract. If not found, use 0.'),
  dueDate: z.string().describe('The payment due date in ISO 8601 format (YYYY-MM-DD). If not found, use current date.'),
  extractedTerms: ExtractedTermsSchema.optional().describe('An object containing other relevant terms. If no specific terms are found, this object can be empty or omitted.'),
});
export type ExtractContractDetailsOutput = z.infer<typeof ExtractContractDetailsOutputSchema>;

export async function extractContractDetails(input: ExtractContractDetailsInput): Promise<ExtractContractDetailsOutput> {
  return extractContractDetailsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'extractContractDetailsPrompt',
  input: {schema: ExtractContractDetailsInputSchema},
  output: {schema: ExtractContractDetailsOutputSchema},
  prompt: `You are an expert contract analyst. Your task is to extract key details from the provided contract text.

  Specifically, extract the following information:
  - brand: The name of the brand or counterparty involved in the contract. If no brand name is explicitly mentioned, output "Unknown Brand".
  - amount: The payment amount specified in the contract (as a number). If no amount is specified, output 0.
  - dueDate: The payment due date in ISO 8601 format (YYYY-MM-DD). If no due date is specified, use the current date in YYYY-MM-DD format.
  - extractedTerms: An object containing other relevant terms. Focus on:
    - paymentMethod: The method of payment (e.g., "Bank Transfer", "PayPal").
    - deliverables: A list of key deliverables or services to be provided (e.g., ["1 Instagram Reel", "2 Story posts"]).
    - usageRights: A brief description of content usage rights.
    - terminationClauses: A brief summary of termination conditions.
    - lateFeePenalty: Information about any late fee or penalty.
    If specific terms are not clearly present, their respective fields in extractedTerms can be omitted or the extractedTerms object itself can be empty.

  Ensure that the extracted information is accurate and follows the specified format. Prioritize finding the brand, amount, and due date.

  Contract Text: {{{contractText}}}
  `,
});

const extractContractDetailsFlow = ai.defineFlow(
  {
    name: 'extractContractDetailsFlow',
    inputSchema: ExtractContractDetailsInputSchema,
    outputSchema: ExtractContractDetailsOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    // Ensure defaults if AI fails to provide them
    const result = output!;
    if (!result.brand) result.brand = "Unknown Brand";
    if (result.amount === undefined || result.amount === null) result.amount = 0;
    if (!result.dueDate) result.dueDate = new Date().toISOString().split('T')[0];
    if (!result.extractedTerms) result.extractedTerms = {};
    
    return result;
  }
);
