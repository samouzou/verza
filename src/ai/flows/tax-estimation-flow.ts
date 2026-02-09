
'use server';
/**
 * @fileOverview Provides a simplified tax estimation based on income and deductible expenses.
 * This is a placeholder and should be significantly enhanced for real-world use.
 *
 * - estimateTaxes - A function that provides a rough tax estimation.
 * - TaxEstimationInput - The input type for the estimateTaxes function.
 * - TaxEstimationOutput - The return type for the estimateTaxes function, matching src/types.
 */

import { ai } from '@/ai/genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { z, retry } from 'genkit';
import type { BankTransaction, TaxEstimation } from '@/types'; // Import from main types

// Define Zod schema for BankTransaction matching what's in src/types/index.ts
// This is for validating the input to the AI flow.
const BankTransactionSchema = z.object({
  id: z.string(),
  userId: z.string(),
  accountId: z.string(),
  date: z.string(),
  description: z.string(),
  amount: z.number(),
  currency: z.string(),
  category: z.string().optional(),
  isTaxDeductible: z.boolean().optional().default(false),
  isBrandSpend: z.boolean().optional().default(false),
  linkedReceiptId: z.string().optional().nullable(),
  createdAt: z.any(), // Simplified for Zod, actual type is Timestamp
  updatedAt: z.any().optional(), // Simplified for Zod
});

const TaxEstimationInputSchema = z.object({
  totalGrossIncome: z.number().min(0).describe('Total gross income for the period from all sources.'),
  transactions: z.array(BankTransactionSchema).describe('List of financial transactions, including expenses.'),
  filingStatus: z.enum(['single', 'married_jointly', 'head_of_household']).optional().default('single').describe('Tax filing status (e.g., single, married). Defaults to single.'),
  taxYear: z.number().int().min(2000).optional().default(new Date().getFullYear()).describe('The tax year for estimation.'),
});
export type TaxEstimationInput = z.infer<typeof TaxEstimationInputSchema>;

// TaxEstimationOutputSchema should match the TaxEstimation interface in src/types/index.ts
const TaxEstimationOutputSchema = z.object({
  estimatedTaxableIncome: z.number().describe('The calculated taxable income after deductions.'),
  estimatedTaxOwed: z.number().describe('A rough estimate of the total tax owed (federal, state, self-employment if applicable).'),
  suggestedSetAsidePercentage: z.number().min(0).max(100).describe('A suggested percentage of income to set aside for taxes.'),
  suggestedSetAsideAmount: z.number().describe('The suggested monetary amount to set aside based on current income and expenses.'),
  notes: z.array(z.string()).optional().describe('Important notes or assumptions made during the estimation.'),
  calculationDate: z.string().describe('The date the estimation was performed (ISO Date string).'),
});
export type TaxEstimationOutput = z.infer<typeof TaxEstimationOutputSchema>;


export async function estimateTaxes(input: TaxEstimationInput): Promise<TaxEstimationOutput> {
  return taxEstimationFlow(input);
}

const prompt = ai.definePrompt({
  name: 'taxEstimationPrompt',
  model: googleAI.model('gemini-2.0-flash'),
  input: { schema: TaxEstimationInputSchema },
  output: { schema: TaxEstimationOutputSchema },
  prompt: `
  You are a helpful AI assistant providing simplified tax estimations for a content creator.
  This is NOT financial advice. Make conservative estimates.

  User's Input:
  - Total Gross Income: {{{totalGrossIncome}}}
  - Filing Status: {{{filingStatus}}}
  - Tax Year: {{{taxYear}}}
  - Transactions (Expenses):
    {{#each transactions}}
      {{#if this.isTaxDeductible}}
      - Description: {{{this.description}}}, Amount: {{{this.amount}}} (Deductible)
      {{/if}}
    {{/each}}

  Task:
  1. Calculate total deductible expenses from the provided transactions (where isTaxDeductible is true and amount is negative).
  2. Calculate Estimated Taxable Income: Total Gross Income - Total Deductible Expenses.
  3. Estimate Tax Owed:
     - Assume a simplified progressive federal income tax (e.g., 10% on first $10k, 12% on next $30k, 22% on rest).
     - Assume a simplified state income tax (e.g., flat 5% if applicable, or skip if not specified).
     - Assume self-employment tax of 15.3% on 92.35% of net self-employment earnings (Estimated Taxable Income).
     - Sum these up for a rough total.
  4. Suggest a Set-Aside Percentage: Based on the (Estimated Tax Owed / Total Gross Income), rounded up. Aim for 15-40% range generally.
  5. Calculate Suggested Set-Aside Amount: Set-Aside Percentage * Total Gross Income.
  6. Provide notes, including disclaimers that this is a very rough estimate and a tax professional should be consulted. Mention the assumed tax rates.

  Output the results in the specified JSON format.
  The 'calculationDate' should be the current date in YYYY-MM-DD format.
  `,
});

const taxEstimationFlow = ai.defineFlow(
  {
    name: 'taxEstimationFlow',
    inputSchema: TaxEstimationInputSchema,
    outputSchema: TaxEstimationOutputSchema,
    retry: retry({
      backoff: {
        delay: '2s',
        maxDelay: '30s',
        multiplier: 2,
      },
      maxAttempts: 5,
      when: (e) => (e as any).status === 429,
    }),
  },
  async (input) => {
    const { output } = await prompt(input);
    
    // Ensure calculationDate is always set, even if AI misses it.
    const result = output!; // Assuming output will not be null
    if (!result.calculationDate) {
      result.calculationDate = new Date().toISOString().split('T')[0];
    }
     if (!result.notes) {
      result.notes = [];
    }
    result.notes.push("Disclaimer: This is a simplified AI estimation and not professional tax advice. Consult a qualified tax professional.");


    return result;
  }
);
