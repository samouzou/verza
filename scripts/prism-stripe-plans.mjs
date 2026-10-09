#!/usr/bin/env node
/**
 * Creates the Prism self-serve plans in a Stripe account and retires the 2026 $199 Launch prices.
 * Safe to re-run: products are found by metadata, prices by lookup key.
 *
 *   STRIPE_SECRET_KEY=sk_... node scripts/prism-stripe-plans.mjs [--dry-run]
 *
 * Functions find plan prices by lookup key (prism_{starter|launch|pro}_{monthly|yearly}), so no price-id
 * params are needed. Retired prices keep working for existing subscriptions, which Prism treats as Pro.
 */

const PLANS = [
  { tier: "starter", name: "Prism Starter", monthly: 2900, yearly: 29000 },
  { tier: "launch", name: "Prism Launch", monthly: 7900, yearly: 79000 },
  { tier: "pro", name: "Prism Pro", monthly: 14900, yearly: 149000 },
];

const dryRun = process.argv.includes("--dry-run");
const key = process.env.STRIPE_SECRET_KEY?.trim();
if (!key) {
  console.error("Set STRIPE_SECRET_KEY.");
  process.exit(1);
}

function form(obj, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    const name = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach((item) => out.append(`${name}[]`, String(item)));
    else if (typeof v === "object") form(v, name, out);
    else out.append(name, String(v));
  }
  return out;
}

async function stripe(method, path, params) {
  const qs = method === "GET" && params ? `?${form(params)}` : "";
  const res = await fetch(`https://api.stripe.com/v1${path}${qs}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: method === "GET" || !params ? undefined : form(params),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${data.error?.message ?? res.status}`);
  return data;
}

async function write(label, method, path, params) {
  if (dryRun) {
    console.log(`[dry run] ${label}`);
    return { id: "(dry run)" };
  }
  const obj = await stripe(method, path, params);
  console.log(`${label}: ${obj.id}`);
  return obj;
}

async function ensureProduct(plan) {
  const byTier = await stripe("GET", "/products/search", { query: `metadata['prismTier']:'${plan.tier}' AND active:'true'` });
  if (byTier.data[0]) return byTier.data[0].id;
  const byName = await stripe("GET", "/products/search", { query: `name:'${plan.name}' AND active:'true'` });
  const existing = byName.data.find((p) => p.metadata?.productType === "prism");
  if (existing) {
    await write(`Tag ${plan.name} product`, "POST", `/products/${existing.id}`, { metadata: { prismTier: plan.tier } });
    return existing.id;
  }
  const created = await write(`Create ${plan.name} product`, "POST", "/products", {
    name: plan.name,
    description: `Prism social media workspace — ${plan.name.replace("Prism ", "")} plan`,
    metadata: { productType: "prism", prismTier: plan.tier },
  });
  return created.id;
}

async function ensurePrice(plan, productId, interval) {
  const lookupKey = `prism_${plan.tier}_${interval === "year" ? "yearly" : "monthly"}`;
  const amount = interval === "year" ? plan.yearly : plan.monthly;
  const { data } = await stripe("GET", "/prices", { lookup_keys: [lookupKey], active: true, limit: 1 });
  const current = data[0];
  if (current && current.unit_amount === amount && current.currency === "usd" && current.recurring?.interval === interval) {
    console.log(`${lookupKey}: ${current.id} ($${amount / 100}) already set`);
    return;
  }
  await write(`Create ${lookupKey} ($${amount / 100}/${interval})`, "POST", "/prices", {
    product: productId,
    currency: "usd",
    unit_amount: amount,
    recurring: { interval },
    lookup_key: lookupKey,
    transfer_lookup_key: true,
    nickname: `${plan.name} ${interval === "year" ? "yearly (2 months free)" : "monthly"}`,
    metadata: { prismPlanId: lookupKey },
  });
}

async function retireLegacyLaunch() {
  for (const interval of ["monthly", "yearly"]) {
    const planId = `prism_launch_${interval}`;
    const { data } = await stripe("GET", "/prices/search", { query: `metadata['prismPlanId']:'${planId}' AND active:'true'` });
    for (const price of data) {
      if (price.lookup_key === planId) continue;
      await write(
        `Retire $${price.unit_amount / 100} Launch ${interval} price ${price.id} (existing subscriptions get Pro)`,
        "POST",
        `/prices/${price.id}`,
        {
          active: false,
          nickname: `Prism Launch ${interval} $${price.unit_amount / 100} (retired, grandfathered as Pro)`,
          metadata: { prismPlanId: `prism_pro_${interval}` },
        }
      );
    }
  }
}

const account = await stripe("GET", "/account");
console.log(`Stripe account ${account.id} (${key.startsWith("sk_live") || key.startsWith("rk_live") ? "live" : "test"})${dryRun ? ", dry run" : ""}`);
await retireLegacyLaunch();
for (const plan of PLANS) {
  const productId = await ensureProduct(plan);
  await ensurePrice(plan, productId, "month");
  await ensurePrice(plan, productId, "year");
}
console.log("Done.");
