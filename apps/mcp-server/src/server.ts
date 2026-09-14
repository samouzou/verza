import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import type {Firestore} from "firebase-admin/firestore";
import type {VerzaMcpConfig} from "./config.js";
import {requireGeminiApiKey, requireWebApiKey} from "./config.js";
import type {VerzaActor} from "./context.js";
import {estimateCampaignBudget} from "./lib/budget.js";
import {VerzaCallableClient} from "./lib/callable.js";
import {createCampaignViaCallables} from "./lib/createCampaign.js";
import {CAMPAIGN_PLATFORMS, CAMPAIGN_TYPES, draftCampaignFromUrl} from "./lib/draft.js";
import {buildRoasInsightSnapshot, saveRoasInsightOnGig} from "./lib/insights.js";
import {
  LAUNCH_BRIEF_DEFAULTS,
  buildCampaignLaunchBrief,
} from "./lib/launchBrief.js";
import {predictCampaignRoas} from "./lib/roas.js";
import {
  beginGmailConnectFromMcp,
  createGmailDraftsForLeads,
  getGmailStatus,
  markLeadsContacted,
  sendGmailForLead,
  updateLeadOutreachDraft,
} from "./lib/gmailOutreach.js";
import {toolError, toolText} from "./lib/serialize.js";
import {
  AGENT_PREFERRED_PLATFORMS,
  cancelDiscovery,
  completeAgentMission,
  getCampaign,
  getJob,
  getLead,
  listCampaigns,
  listJobs,
  listLeads,
  prepareAgentMission,
  startDiscovery,
  submitAgentLead,
} from "./services/verza.js";

export type ServerDeps = {
  db: Firestore;
  getActor: () => Promise<VerzaActor>;
  config: VerzaMcpConfig;
};

export function createVerzaMcpServer(deps: ServerDeps): McpServer {
  const server = new McpServer({
    name: "verza",
    version: "0.1.0",
  });

  const getCallable = () =>
    new VerzaCallableClient({
      projectId: deps.config.projectId,
      webApiKey: requireWebApiKey(deps.config),
      region: deps.config.functionsRegion,
    });

  const withActor = async <T>(fn: (actor: VerzaActor) => Promise<T>) => {
    try {
      const actor = await deps.getActor();
      const result = await fn(actor);
      return toolText(result);
    } catch (err) {
      return toolError(err);
    }
  };

  server.tool(
    "verza_whoami",
    "Show which Verza brand workspace you’re helping right now — account, brand name, and remaining Optic credits.",
    {},
    async () =>
      withActor(async (actor) => ({
        uid: actor.uid,
        email: actor.email,
        displayName: actor.displayName,
        role: actor.role,
        agencyId: actor.agencyId,
        agencyName: actor.agencyName,
        opticCreditsBalance: actor.opticCreditsBalance,
        opticPlan: actor.opticPlan,
        opticSubscriptionActive: actor.opticSubscriptionActive,
        note: "You’re working in this user’s primary brand workspace. Use optic_gmail_status before drafting outreach in Gmail.",
      }))
  );

  server.tool(
    "optic_list_campaigns",
    "List this brand’s Verza campaigns you can recruit creators for. By default, only open and in-progress campaigns.",
    {
      activeOnly: z
        .boolean()
        .optional()
        .describe("If true (default), only open or in-progress campaigns. Set false to include recent closed ones too."),
      limit: z.number().int().min(1).max(50).optional(),
    },
    async ({activeOnly, limit}) =>
      withActor(async (actor) => {
        const campaigns = await listCampaigns(deps.db, actor, {
          activeOnly: activeOnly !== false,
          limit,
        });
        return {agencyId: actor.agencyId, count: campaigns.length, campaigns};
      })
  );

  server.tool(
    "optic_get_campaign",
    "Get details for one campaign — pay, open slots, platforms, and affiliate settings.",
    {
      campaignId: z.string().min(1).describe("Campaign id"),
    },
    async ({campaignId}) =>
      withActor(async (actor) => {
        const campaign = await getCampaign(deps.db, actor, campaignId);
        if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
        return campaign;
      })
  );

  server.tool(
    "optic_start_discovery",
    "Start Verza’s automatic creator discovery for a platform (best for YouTube, TikTok, and similar). For Instagram, LinkedIn, or X, prefer optic_prepare_agent_mission so you can search alongside the brand.",
    {
      platform: z
        .enum([
          "youtube",
          "instagram",
          "tiktok",
          "facebook",
          "twitch",
          "linkedin",
          "twitter",
        ])
        .describe("Where to look for creators"),
      objectives: z
        .string()
        .min(1)
        .max(4000)
        .describe("What kind of creators fit — goals, audience, tone, must-haves"),
      maxProfiles: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("How many creators to save this round (default 10)"),
      campaignId: z
        .string()
        .optional()
        .describe("Optional campaign to attach pay and vault results to"),
      audienceTier: z
        .enum(["any", "nano", "micro", "mid", "macro"])
        .optional()
        .describe("Follower size band (default: any, 100+)"),
    },
    async (args) =>
      withActor(async (actor) => {
        const started = await startDiscovery(deps.db, actor, args);
        const preferAgent = AGENT_PREFERRED_PLATFORMS.has(args.platform);
        return {
          ...started,
          note: preferAgent
            ? "Discovery is queued. For Instagram, LinkedIn, or X, assisted search (optic_prepare_agent_mission) is usually a better fit."
            : "Check progress with optic_get_job, then review creators in the vault with optic_list_leads.",
        };
      })
  );

  server.tool(
    "optic_prepare_agent_mission",
    "Start an assisted creator search: you find creators (especially on Instagram, LinkedIn, or X) and save the best matches to the brand’s Optic vault.",
    {
      platform: z
        .enum([
          "youtube",
          "instagram",
          "tiktok",
          "facebook",
          "twitch",
          "linkedin",
          "twitter",
        ])
        .describe("Platform you’ll search"),
      objectives: z
        .string()
        .min(1)
        .max(4000)
        .describe("What kind of creators fit — goals, audience, tone, must-haves"),
      maxProfiles: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max creators to save this round (default 10)"),
      campaignId: z
        .string()
        .optional()
        .describe("Optional campaign to attach pay and vault results to"),
      audienceTier: z
        .enum(["any", "nano", "micro", "mid", "macro"])
        .optional()
        .describe("Follower size band (default: any, 100+)"),
    },
    async (args) =>
      withActor(async (actor) => prepareAgentMission(deps.db, actor, args))
  );

  server.tool(
    "optic_submit_agent_lead",
    "Save one creator you found into the Optic vault. Uses 1 Optic credit when accepted. Repeat until you hit the batch size or finish the search.",
    {
      jobId: z.string().min(1),
      profileUrl: z.string().min(1).describe("Full profile link (https)"),
      creatorName: z.string().optional(),
      followerCount: z
        .string()
        .optional()
        .describe("Followers as shown on the profile (e.g. 12.4K)"),
      postCount: z.string().optional(),
      niche: z.string().optional(),
      bio: z.string().optional(),
      email: z.string().optional(),
      externalUrl: z.string().optional().describe("Website or link in bio"),
      matchReason: z.string().optional().describe("Short note on why they fit"),
      briefFitScore: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .describe("Your fit score from 0–100 (default 70)"),
      draftEmail: z
        .string()
        .optional()
        .describe(
          "REQUIRED HTML when email is known: 2–4 <p> blocks with optional <strong>/<em>/<a href>. Example: <p>Hi …</p><p>I'm with <strong>Brand</strong> on Verza…</p>. Never plain text. Do not use HTML for DMs."
        ),
      draftEmailSubject: z.string().optional(),
      draftDm: z
        .string()
        .optional()
        .describe("Plain-text platform DM. Do not wrap this in HTML."),
    },
    async (args) =>
      withActor(async (actor) => submitAgentLead(deps.db, actor, args))
  );

  server.tool(
    "optic_complete_agent_mission",
    "Mark the assisted creator search as finished once you’ve saved the creators you want.",
    {
      jobId: z.string().min(1),
    },
    async ({jobId}) =>
      withActor(async (actor) => completeAgentMission(deps.db, actor, jobId))
  );

  server.tool(
    "optic_list_jobs",
    "List recent creator-discovery searches for this brand.",
    {
      limit: z.number().int().min(1).max(40).optional(),
      campaignId: z.string().optional(),
    },
    async ({limit, campaignId}) =>
      withActor(async (actor) => {
        const jobs = await listJobs(deps.db, actor, {limit, campaignId});
        return {count: jobs.length, jobs};
      })
  );

  server.tool(
    "optic_get_job",
    "Check status and progress for one creator-discovery search.",
    {
      jobId: z.string().min(1),
    },
    async ({jobId}) =>
      withActor(async (actor) => {
        const job = await getJob(deps.db, actor, jobId);
        if (!job) throw new Error(`Job ${jobId} not found`);
        return job;
      })
  );

  server.tool(
    "optic_cancel_job",
    "Cancel a creator-discovery search that’s still running or waiting.",
    {
      jobId: z.string().min(1),
    },
    async ({jobId}) =>
      withActor(async (actor) => cancelDiscovery(deps.db, actor, jobId))
  );

  server.tool(
    "optic_list_leads",
    "List creators in the Optic vault — optionally for one campaign, and optionally by match score. Best matches first.",
    {
      campaignId: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      minMatchScore: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .describe("Only include creators at or above this match score"),
      hasEmail: z.boolean().optional().describe("Only creators with or without an email"),
      contacted: z
        .boolean()
        .optional()
        .describe("Only creators already marked contacted (true) or not yet contacted (false)"),
    },
    async (args) =>
      withActor(async (actor) => {
        const leads = await listLeads(deps.db, actor, args);
        return {count: leads.length, leads};
      })
  );

  server.tool(
    "optic_get_lead",
    "Get the full vault profile for one creator, including outreach drafts and why they matched.",
    {
      leadId: z.string().min(1),
    },
    async ({leadId}) =>
      withActor(async (actor) => {
        const lead = await getLead(deps.db, actor, leadId);
        if (!lead) throw new Error(`Lead ${leadId} not found`);
        return lead;
      })
  );

  server.tool(
    "optic_gmail_status",
    "Check whether the brand user behind this MCP key has Gmail connected for Optic outreach.",
    {},
    async () =>
      withActor(async (actor) => getGmailStatus(deps.db, actor, deps.config.appBaseUrl))
  );

  server.tool(
    "optic_gmail_connect",
    "Start Gmail connect for Optic outreach. Returns the Optic app URL (required — OAuth finishes in the browser). Does not complete OAuth or store tokens from this chat.",
    {},
    async () =>
      withActor(async (actor) =>
        beginGmailConnectFromMcp(deps.db, actor, getCallable(), deps.config.appBaseUrl)
      )
  );

  server.tool(
    "optic_create_gmail_draft",
    "Create a Gmail draft (HTML body) from a vault lead’s outreach copy. Does not send. Gmail must already be connected. Review in Gmail → Drafts, then send.",
    {
      leadId: z.string().min(1).optional().describe("Vault lead id"),
      leadIds: z
        .array(z.string().min(1))
        .max(25)
        .optional()
        .describe("Batch of vault lead ids (max 25)"),
      draftEmail: z
        .string()
        .optional()
        .describe(
          "Optional HTML body override for a single lead (plain text is converted). Ignored for batches."
        ),
      draftEmailSubject: z
        .string()
        .optional()
        .describe("Optional subject override for a single lead. Ignored for batches."),
    },
    async ({leadId, leadIds, draftEmail, draftEmailSubject}) =>
      withActor(async (actor) => {
        const ids = [
          ...(leadId ? [leadId] : []),
          ...(Array.isArray(leadIds) ? leadIds : []),
        ];
        const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
        if (unique.length === 0) {
          throw new Error("Provide leadId or leadIds.");
        }
        const client = getCallable();
        const hasOverride =
          typeof draftEmail === "string" || typeof draftEmailSubject === "string";
        if (hasOverride && unique.length !== 1) {
          throw new Error("draftEmail / draftEmailSubject can only be set for a single lead.");
        }
        if (hasOverride) {
          await updateLeadOutreachDraft(client, actor, {
            leadId: unique[0],
            draftEmail,
            draftEmailSubject,
          });
        }
        return createGmailDraftsForLeads(client, actor, unique, deps.config.appBaseUrl);
      })
  );

  server.tool(
    "optic_send_gmail",
    "Send the vault lead’s outreach email from the connected Gmail account. This actually sends — require explicit brand approval and confirm=true. Prefer optic_create_gmail_draft so they review in Gmail first.",
    {
      leadId: z.string().min(1),
      confirm: z
        .boolean()
        .describe("Must be true after the brand approves sending. Prevents accidental sends."),
    },
    async ({leadId, confirm}) =>
      withActor(async (actor) => {
        if (confirm !== true) {
          throw new Error(
            "Hold on — only send after the brand approves (set confirm to true). Prefer creating a Gmail draft instead."
          );
        }
        return sendGmailForLead(getCallable(), actor, leadId);
      })
  );

  server.tool(
    "optic_mark_lead_contacted",
    "Mark vault lead(s) as contacted (or not) after outreach. Use when they sent from Gmail drafts themselves.",
    {
      leadId: z.string().min(1).optional(),
      leadIds: z.array(z.string().min(1)).max(50).optional(),
      contacted: z
        .boolean()
        .describe("True after outreach was sent; false to clear the contacted flag"),
    },
    async ({leadId, leadIds, contacted}) =>
      withActor(async (actor) => {
        const ids = [
          ...(leadId ? [leadId] : []),
          ...(Array.isArray(leadIds) ? leadIds : []),
        ];
        return markLeadsContacted(getCallable(), actor, ids, contacted);
      })
  );

  server.tool(
    "campaign_estimate_budget",
    "Estimate campaign budget: creator pay, fees, open slots, and any affiliate bonuses.",
    {
      campaignId: z.string().min(1),
    },
    async ({campaignId}) =>
      withActor(async (actor) => {
        const campaign = await getCampaign(deps.db, actor, campaignId);
        if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
        return estimateCampaignBudget(campaign);
      })
  );

  server.tool(
    "campaign_launch_brief",
    "Build a brand-friendly campaign report: budget, predicted return, and clear next steps. Also saves the estimate to the Optic vault. Use right after launching a campaign, and again after more creators are found.",
    {
      campaignId: z.string().min(1),
      averageOrderValueUsd: z
        .number()
        .positive()
        .optional()
        .describe(
          `Typical order value in USD (default $${LAUNCH_BRIEF_DEFAULTS.averageOrderValueUsd})`
        ),
      conversionRate: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe(
          `Share of viewers who buy (e.g. 0.005 = 0.5%; default ${LAUNCH_BRIEF_DEFAULTS.conversionRate})`
        ),
      viewRate: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe(
          `Share of followers who see the post (default ${LAUNCH_BRIEF_DEFAULTS.viewRate})`
        ),
      hireCount: z.number().int().min(1).max(100).optional(),
      engagementRate: z.number().min(0).max(1).optional(),
      minMatchScore: z.number().min(0).max(100).optional(),
      persist: z
        .boolean()
        .optional()
        .describe("Also save this estimate on the campaign for the vault (default true)"),
    },
    async (args) =>
      withActor(async (actor) =>
        buildCampaignLaunchBrief(deps.db, actor, {
          campaignId: args.campaignId,
          averageOrderValueUsd: args.averageOrderValueUsd,
          conversionRate: args.conversionRate,
          viewRate: args.viewRate,
          hireCount: args.hireCount,
          engagementRate: args.engagementRate,
          minMatchScore: args.minMatchScore,
          persist: args.persist,
          appBaseUrl: deps.config.appBaseUrl,
        })
      )
  );

  server.tool(
    "campaign_predict_roas",
    "Estimate predicted return for a campaign from creator pay and vault reach. This is a forecast, not past results. Also saves the estimate to the vault. Prefer campaign_launch_brief after launch for the full report.",
    {
      campaignId: z.string().min(1),
      averageOrderValueUsd: z
        .number()
        .positive()
        .describe("Typical order value / revenue per purchase in USD"),
      conversionRate: z
        .number()
        .min(0)
        .max(1)
        .describe("Share of estimated views that become a purchase (e.g. 0.005 = 0.5%)"),
      viewRate: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Share of followers who see the content (default 0.08)"),
      hireCount: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("How many creators to model (default = campaign creator count)"),
      engagementRate: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Optional engagement rate for context only"),
      minMatchScore: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .describe("Only use vault creators at or above this match score"),
    },
    async ({
      campaignId,
      averageOrderValueUsd,
      conversionRate,
      viewRate,
      hireCount,
      engagementRate,
      minMatchScore,
    }) =>
      withActor(async (actor) => {
        const campaign = await getCampaign(deps.db, actor, campaignId);
        if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
        const budget = estimateCampaignBudget(campaign);
        const leads = await listLeads(deps.db, actor, {
          campaignId,
          limit: 50,
          minMatchScore: minMatchScore ?? null,
        });
        const prediction = predictCampaignRoas({
          budget,
          leads,
          hireCount,
          averageOrderValueUsd,
          conversionRate,
          viewRate: viewRate ?? 0.08,
          engagementRate,
        });
        const snapshot = buildRoasInsightSnapshot(prediction, budget, "mcp");
        await saveRoasInsightOnGig(deps.db, campaignId, snapshot);
        return {
          budget,
          prediction,
          savedToVault: true,
          note: "This estimate is also on the campaign’s Optic vault report.",
        };
      })
  );

  server.tool(
    "campaign_draft_from_url",
    "Draft a creator campaign from a product or brand page. Builds a title, brief, platforms, and pay suggestion — does not launch or charge. Review with the brand, then launch when they approve.",
    {
      productUrl: z.string().min(1).describe("Product or brand page URL"),
      userNotes: z
        .string()
        .optional()
        .describe("Extra notes from the brand (audience, offer, must-says, budget)"),
      campaignType: z.enum(CAMPAIGN_TYPES).optional(),
      platforms: z
        .array(z.enum(CAMPAIGN_PLATFORMS))
        .optional()
        .describe("Prefer these platforms; otherwise we’ll choose"),
      ratePerCreator: z.number().min(0).optional(),
      creatorsNeeded: z.number().int().min(0).max(100).optional(),
      videosPerCreator: z.number().int().min(1).max(5).optional(),
    },
    async (args) =>
      withActor(async (actor) => {
        const draft = await draftCampaignFromUrl({
          productUrl: args.productUrl,
          geminiApiKey: requireGeminiApiKey(deps.config),
          actor,
          userNotes: args.userNotes,
          campaignType: args.campaignType,
          platforms: args.platforms,
          ratePerCreator: args.ratePerCreator,
          creatorsNeeded: args.creatorsNeeded,
          videosPerCreator: args.videosPerCreator,
        });
        return {
          draft,
          hint: "Show the draft to the brand. When they approve, launch it with campaign_create (confirm set to true).",
        };
      })
  );

  server.tool(
    "campaign_create",
    "Launch an approved campaign draft. Paid campaigns return a checkout link to fund creator pay; free / cause / barter campaigns go live right away. Returns a brand-friendly launch report with budget and predicted return.",
    {
      confirm: z
        .boolean()
        .describe("Must be true after the brand approves — prevents accidental launches"),
      title: z.string().min(1),
      description: z
        .string()
        .min(1)
        .describe("Campaign brief (plain text or HTML from the draft)"),
      platforms: z.array(z.enum(CAMPAIGN_PLATFORMS)).min(1),
      campaignType: z.enum(CAMPAIGN_TYPES),
      ratePerCreator: z.number().min(0),
      creatorsNeeded: z.number().int().min(0).max(100),
      videosPerCreator: z.number().int().min(1).max(5).default(1),
      usageRights: z.enum(["none", "30_days", "1_year", "perpetuity"]).optional(),
      allowWhitelisting: z.boolean().optional(),
      requireVerzaScore: z.boolean().optional(),
      verzaScoreThreshold: z.number().int().min(1).max(100).optional(),
      deliverablesDueDate: z.string().optional().describe("Due date as YYYY-MM-DD"),
      enableAffiliateFromUrl: z
        .string()
        .optional()
        .describe("If set, adds a simple click-based affiliate bonus to this URL"),
      averageOrderValueUsd: z
        .number()
        .positive()
        .optional()
        .describe("Optional typical order value for the launch report"),
      conversionRate: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Optional conversion rate for the launch report"),
    },
    async (args) =>
      withActor(async (actor) => {
        if (args.confirm !== true) {
          throw new Error(
            "Hold on — only launch after the brand approves the draft (set confirm to true)."
          );
        }
        const created = await createCampaignViaCallables(
          getCallable(),
          actor,
          {
            title: args.title,
            description: args.description,
            platforms: args.platforms,
            campaignType: args.campaignType,
            ratePerCreator: args.ratePerCreator,
            creatorsNeeded: args.creatorsNeeded,
            videosPerCreator: args.videosPerCreator,
            usageRights: args.usageRights,
            allowWhitelisting: args.allowWhitelisting,
            requireVerzaScore: args.requireVerzaScore,
            verzaScoreThreshold: args.verzaScoreThreshold,
            deliverablesDueDate: args.deliverablesDueDate,
            enableAffiliateFromUrl: args.enableAffiliateFromUrl,
          },
          deps.config.appBaseUrl
        );

        if (!created.gigId) {
          return created;
        }

        const launchBrief = await buildCampaignLaunchBrief(deps.db, actor, {
          campaignId: created.gigId,
          averageOrderValueUsd: args.averageOrderValueUsd,
          conversionRate: args.conversionRate,
          campaignUrl: created.campaignUrl,
          fundingUrl: created.fundingUrl,
          createMode: created.mode,
          appBaseUrl: deps.config.appBaseUrl,
        });

        return {
          ...created,
          // Keep raw Stripe URL out of the brand-facing surface; fundingUrl is safe to share.
          checkoutUrl: undefined,
          launchBrief,
          howToPresent: [
            "Show launchBrief as a simple report card: predicted return, hire spend, expected revenue, and creator budget.",
            "If funding is needed, give the brand fundingUrl only (a Verza link). Never paste raw checkout.stripe.com links — chat truncates them and Stripe rejects the payment.",
            "Walk through nextActions in order, in plain language.",
          ].join(" "),
        };
      })
  );

  return server;
}
