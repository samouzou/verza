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
import {predictCampaignRoas} from "./lib/roas.js";
import {toolError, toolText} from "./lib/serialize.js";
import {
  cancelDiscovery,
  getCampaign,
  getJob,
  getLead,
  listCampaigns,
  listJobs,
  listLeads,
  startDiscovery,
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
    "Show which Verza user + agency this MCP is acting as (from your MCP API key or login). Agency is always the signed-in user's primary brand workspace.",
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
        note: "Agency comes from this user's primaryAgencyId — not a shared env brand.",
      }))
  );

  server.tool(
    "optic_list_campaigns",
    "List Verza campaigns (gigs) for the brand that Optic can recruit against. Defaults to open/in-progress only.",
    {
      activeOnly: z
        .boolean()
        .optional()
        .describe("If true (default), only open/in-progress campaigns. Set false for all recent gigs."),
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
    "Get a single Verza campaign/gig by id, including pay, slots, and affiliate settings.",
    {
      campaignId: z.string().min(1).describe("Gig / campaign document id"),
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
    "Start an Optic creator-discovery mission (same as the /optic New mission UI). Uses Optic credits. Prefer scoping campaignId so drafts include pay + vault attribution.",
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
        .describe("Platform to scout"),
      objectives: z
        .string()
        .min(1)
        .max(4000)
        .describe("Campaign objectives / brief for creator fit"),
      maxProfiles: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Creators to save this batch (default 10)"),
      campaignId: z
        .string()
        .optional()
        .describe("Optional Verza gig id to scope pay + vault leads"),
      audienceTier: z
        .enum(["any", "nano", "micro", "mid", "macro"])
        .optional()
        .describe("Audience size band (default any = 100+)"),
    },
    async (args) =>
      withActor(async (actor) => {
        const started = await startDiscovery(deps.db, actor, args);
        return {
          ...started,
          note: "Poll optic_get_job until status is completed/failed/cancelled, then optic_list_leads.",
        };
      })
  );

  server.tool(
    "optic_list_jobs",
    "List recent Optic discovery missions for this brand.",
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
    "Get status, progress, and recent logs for an Optic discovery job.",
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
    "Request cancellation of an in-flight Optic discovery mission.",
    {
      jobId: z.string().min(1),
    },
    async ({jobId}) =>
      withActor(async (actor) => cancelDiscovery(deps.db, actor, jobId))
  );

  server.tool(
    "optic_list_leads",
    "List Optic vault leads (discovered creators), optionally filtered by campaign and match score. Sorted by matchScore desc.",
    {
      campaignId: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      minMatchScore: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .describe("Only leads with matchScore >= this value"),
      hasEmail: z.boolean().optional().describe("Filter to leads with/without email"),
    },
    async (args) =>
      withActor(async (actor) => {
        const leads = await listLeads(deps.db, actor, args);
        return {count: leads.length, leads};
      })
  );

  server.tool(
    "optic_get_lead",
    "Get full Optic vault lead including outreach drafts and match breakdown.",
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
    "campaign_estimate_budget",
    "Estimate campaign cash budget from a Verza gig: creator compensation (rate × creators), platform fee illustration, remaining slots, and affiliate layer.",
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
    "campaign_predict_roas",
    "Predict ROAS for a campaign using hire spend + Optic vault lead reach (followers × viewRate × conversionRate × AOV). Heuristic model — not measured ROAS. Run Optic discovery first for better estimates.",
    {
      campaignId: z.string().min(1),
      averageOrderValueUsd: z
        .number()
        .positive()
        .describe("Brand average order value / revenue per conversion in USD"),
      conversionRate: z
        .number()
        .min(0)
        .max(1)
        .describe("Fraction of estimated views that convert (e.g. 0.005 = 0.5%)"),
      viewRate: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Views as a fraction of followers (default 0.08)"),
      hireCount: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Creators to hire for the model (default = campaign creatorsNeeded)"),
      engagementRate: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Optional narrative engagement rate; not used in revenue math"),
      minMatchScore: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .describe("Only use vault leads at/above this match score"),
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
        return {budget, prediction};
      })
  );

  server.tool(
    "campaign_draft_from_url",
    "Draft a Verza creator campaign from a product or brand URL. Scrapes the page, generates title/brief/platforms/pay suggestions. Does NOT launch or charge — review then call campaign_create.",
    {
      productUrl: z.string().min(1).describe("Product or brand page URL"),
      userNotes: z
        .string()
        .optional()
        .describe("Extra brief from the brand (audience, offer, must-say lines, budget hints)"),
      campaignType: z.enum(CAMPAIGN_TYPES).optional(),
      platforms: z
        .array(z.enum(CAMPAIGN_PLATFORMS))
        .optional()
        .describe("Force platforms; otherwise model chooses"),
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
          hint: "Show the draft to the brand. If they approve, call campaign_create with the draft fields and confirm=true.",
        };
      })
  );

  server.tool(
    "campaign_create",
    "Launch a Verza campaign from an approved draft. Requires confirm=true. Paid campaigns return a Stripe checkoutUrl to fund escrow; $0/cause/barter go live immediately. Prefer fields from campaign_draft_from_url.",
    {
      confirm: z
        .boolean()
        .describe("Must be true to create — prevents accidental launches"),
      title: z.string().min(1),
      description: z
        .string()
        .min(1)
        .describe("Campaign brief HTML or plain text (use draft.descriptionHtml when available)"),
      platforms: z.array(z.enum(CAMPAIGN_PLATFORMS)).min(1),
      campaignType: z.enum(CAMPAIGN_TYPES),
      ratePerCreator: z.number().min(0),
      creatorsNeeded: z.number().int().min(0).max(100),
      videosPerCreator: z.number().int().min(1).max(5).default(1),
      usageRights: z.enum(["none", "30_days", "1_year", "perpetuity"]).optional(),
      allowWhitelisting: z.boolean().optional(),
      requireVerzaScore: z.boolean().optional(),
      verzaScoreThreshold: z.number().int().min(1).max(100).optional(),
      deliverablesDueDate: z.string().optional().describe("ISO date YYYY-MM-DD"),
      enableAffiliateFromUrl: z
        .string()
        .optional()
        .describe("If set, enables a simple CPC affiliate layer to this destination URL"),
    },
    async (args) =>
      withActor(async (actor) => {
        if (args.confirm !== true) {
          throw new Error(
            "Refusing to create: set confirm=true after the brand approves the draft."
          );
        }
        return createCampaignViaCallables(
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
      })
  );

  return server;
}
