
'use server';
/**
 * @fileOverview Classifies a bank transaction as tax-deductible and suggests a category.
 *
 * - classifyTransaction - A function that handles transaction classification.
 * - ClassifyTransactionInput - The input type for the function.
 * - ClassifyTransactionOutput - The return type for the function.
 */

import { ai } from '@/ai/genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { z } from 'genkit';

const ClassifyTransactionInputSchema = z.object({
  description: z.string().describe('The raw description of the bank transaction.'),
});
export type ClassifyTransactionInput = z.infer<typeof ClassifyTransactionInputSchema>;

const transactionCategories = [ "Client Payment", "Software", "Travel", "Meals & Entertainment", "Office Supplies", "Marketing", "Other" ] as const;

const ClassifyTransactionOutputSchema = z.object({
  isTaxDeductible: z
    .boolean()
    .describe('Whether the transaction is a likely tax-deductible business expense for a content creator.'),
  category: z.enum(transactionCategories).describe('A suggested category for the expense.'),
});
export type ClassifyTransactionOutput = z.infer<typeof ClassifyTransactionOutputSchema>;

export async function classifyTransaction(input: ClassifyTransactionInput): Promise<ClassifyTransactionOutput> {
  return classifyTransactionFlow(input);
}

const prompt = ai.definePrompt({
  name: 'classifyTransactionPrompt',
  model: googleAI.model('gemini-2.0-flash'),
  input: { schema: ClassifyTransactionInputSchema },
  output: { schema: ClassifyTransactionOutputSchema },
  prompt: `You are an expert accountant specializing in finances for content creators.
  Based on the transaction description, determine if it's a likely tax-deductible business expense.
  Also, classify it into one of the following categories: ${transactionCategories.join(', ')}.

  For example:
  - "Adobe Creative Cloud" is a deductible "Software" expense.
  - "United Airlines Flight" is a deductible "Travel" expense if for business. Assume it is.
  - "Starbucks Client Mtg" is a deductible "Meals & Entertainment" expense.
  - "Payment from Nike, Inc." is income, not a deductible expense, and its category is "Client Payment".
  - "Zara" or "H&M" are usually personal clothing and not deductible unless it's a specific costume for a video. Be conservative and mark it as not deductible with category "Other".
  - "Whole Foods Market" is a personal grocery expense and not deductible, category "Other".

  Transaction Description:
  {{{description}}}
  `,
});

const classifyTransactionFlow = ai.defineFlow(
  {
    name: 'classifyTransactionFlow',
    inputSchema: ClassifyTransactionInputSchema,
    outputSchema: ClassifyTransactionOutputSchema,
  },
  async (input) => {
    const { output } = await prompt(input);
    return output!;
  }
);
