import assert from "node:assert/strict";
import {estimateCampaignBudget} from "../src/lib/budget.js";

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

const pool = estimateCampaignBudget({
  id: "gig2",
  title: "Pool launch",
  status: "open",
  campaignType: "standard_sponsorship",
  ratePerCreator: 0,
  creatorsNeeded: 0,
  videosPerCreator: 1,
  budgetMode: "pool",
  campaignBudget: 1150,
});

assert.equal(pool.creatorCompensationUsd, 1150);
assert.equal(pool.estimatedCreatorNetUsd, 1000);
assert.equal(pool.estimatedPlatformFeeUsd, 150);
assert.equal(pool.remainingSlots, -1);

console.log("budget unit checks passed");
