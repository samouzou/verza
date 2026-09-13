import assert from "node:assert/strict";
import {estimateCampaignBudget} from "../src/lib/budget.js";
import {predictCampaignRoas} from "../src/lib/roas.js";

const budget = estimateCampaignBudget({
  id: "gig1",
  title: "Summer launch",
  status: "open",
  campaignType: "standard_sponsorship",
  ratePerCreator: 1000,
  creatorsNeeded: 10,
  videosPerCreator: 1,
  fundedAmount: 5000,
  acceptedCreatorIds: ["a", "b"],
});

assert.equal(budget.creatorCompensationUsd, 10_000);
assert.equal(budget.estimatedPlatformFeeUsd, 1500);
assert.equal(budget.remainingSlots, 8);
assert.equal(budget.remainingBudgetUsd, 8000);

const prediction = predictCampaignRoas({
  budget,
  leads: [
    {id: "l1", creatorName: "A", followerCountNumeric: 100_000, matchScore: 90},
    {id: "l2", creatorName: "B", followerCountNumeric: 50_000, matchScore: 80},
  ],
  hireCount: 2,
  averageOrderValueUsd: 40,
  conversionRate: 0.01,
  viewRate: 0.1,
});

assert.equal(prediction.spendUsd, 2000);
assert.equal(prediction.expectedViews, 15_000);
assert.equal(prediction.expectedConversions, 150);
assert.equal(prediction.expectedRevenueUsd, 6000);
assert.equal(prediction.predictedRoas, 3);

console.log("budget/roas unit checks passed");
