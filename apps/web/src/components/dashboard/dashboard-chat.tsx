"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { httpsCallable } from "firebase/functions";
import { ArrowUp, Plus } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { functions } from "@/lib/firebase";
import {
  interpretDashboardChat,
  opticLaunchLine,
  type DashboardChatCampaign,
  type DashboardChatStats,
} from "@/lib/dashboard-chat-intents";
import { OPTIC_ACTIVE_JOB_STORAGE_KEY, OPTIC_CAMPAIGN_STORAGE_KEY } from "@/lib/optic/types";
import { cn } from "@/lib/utils";

type Message = {
  id: string;
  role: "user" | "verza";
  text: string;
  href?: string;
  hrefLabel?: string;
};

const BRAND_PROMPTS = [
  "Find creators for a campaign",
  "How are we doing?",
  "Open Prism",
];

const CREATOR_PROMPTS = [
  "Open Prism",
  "What's at risk?",
  "Open insights",
];

type Starter = {
  name: string;
  detail: string;
  href?: string;
  optic?: boolean;
};

const BRAND_STARTERS: Starter[] = [
  { name: "Optic", detail: "Find creators for a campaign", optic: true },
  { name: "Prism", detail: "Plan the content calendar", href: "/prism" },
  { name: "Campaigns", detail: "Post a campaign", href: "/campaigns/post" },
  { name: "Agency", detail: "Roster, team, and tracking", href: "/agency" },
];

const CREATOR_STARTERS: Starter[] = [
  { name: "Prism", detail: "Plan the content calendar", href: "/prism" },
  { name: "Insights", detail: "See how your accounts are doing", href: "/insights" },
  { name: "Reelwright", detail: "Cut a reel", href: "/ai-studio" },
  { name: "YouTube Writer", detail: "Draft a script", href: "/youtube-writer" },
  { name: "Brand Research", detail: "Study a brand", href: "/brand-research" },
  { name: "Store", detail: "Your storefront", href: "/store" },
];

function nextId(): string {
  return Math.random().toString(36).slice(2, 10);
}

const CHAT_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const CHAT_MAX_MESSAGES = 80;

type StoredChat = {
  savedAt: number;
  messages: Message[];
  awaitingCampaign: boolean;
  focused: boolean;
};

function chatStorageKey(uid: string): string {
  return `verza.dashboard.chat.v1.${uid}`;
}

function readStoredChat(uid: string): StoredChat | null {
  try {
    const raw = window.localStorage.getItem(chatStorageKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredChat;
    if (!parsed || typeof parsed.savedAt !== "number" || Date.now() - parsed.savedAt > CHAT_TTL_MS) {
      window.localStorage.removeItem(chatStorageKey(uid));
      return null;
    }
    if (!Array.isArray(parsed.messages)) return null;
    const messages = parsed.messages
      .filter(
        (message): message is Message =>
          !!message &&
          (message.role === "user" || message.role === "verza") &&
          typeof message.text === "string" &&
          message.text.trim().length > 0
      )
      .slice(-CHAT_MAX_MESSAGES)
      .map((message) => ({
        id: typeof message.id === "string" ? message.id : nextId(),
        role: message.role,
        text: message.text.slice(0, 2000),
      }));
    return {
      savedAt: parsed.savedAt,
      messages,
      awaitingCampaign: parsed.awaitingCampaign === true,
      focused: parsed.focused !== false,
    };
  } catch {
    return null;
  }
}

function writeStoredChat(uid: string, chat: StoredChat) {
  try {
    window.localStorage.setItem(
      chatStorageKey(uid),
      JSON.stringify({
        ...chat,
        messages: chat.messages.slice(-CHAT_MAX_MESSAGES),
      })
    );
  } catch {
    // A full or blocked store should not stop the chat.
  }
}

export function DashboardChat({
  stats,
  campaigns,
  onFocusedChange,
}: {
  stats: DashboardChatStats;
  campaigns: DashboardChatCampaign[];
  onFocusedChange?: (focused: boolean) => void;
}) {
  const { user } = useAuth();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(true);
  const setMode = (next: boolean) => {
    setFocused(next);
    onFocusedChange?.(next);
  };
  const [awaitingCampaign, setAwaitingCampaign] = useState(false);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const [loadedUid, setLoadedUid] = useState<string | null>(null);

  const isBrandTeam =
    user?.role === "agency_owner" ||
    user?.role === "agency_admin" ||
    user?.role === "agency_member" ||
    user?.isBrandAccount === true;

  const prompts = isBrandTeam ? BRAND_PROMPTS : CREATOR_PROMPTS;
  const starters = isBrandTeam ? BRAND_STARTERS : CREATOR_STARTERS;
  const started = messages.length > 0;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const uid = user?.uid;
    if (!uid) return;
    const stored = readStoredChat(uid);
    setMessages(stored?.messages ?? []);
    setAwaitingCampaign(stored?.awaitingCampaign ?? false);
    if (stored && stored.messages.length > 0) setMode(stored.focused);
    setLoadedUid(uid);
    // Restore once per signed-in account. setMode is only used for that restore.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  useEffect(() => {
    const uid = user?.uid;
    if (!uid || loadedUid !== uid) return;
    writeStoredChat(uid, {
      savedAt: Date.now(),
      messages,
      awaitingCampaign,
      focused,
    });
  }, [user?.uid, loadedUid, messages, awaitingCampaign, focused]);

  useEffect(() => {
    const node = threadRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const pushVerza = (text: string, href?: string, hrefLabel?: string) => {
    setMessages((prev) => [...prev, { id: nextId(), role: "verza", text, href, hrefLabel }]);
  };

  const launchOptic = async (
    platform: "youtube" | "instagram" | "tiktok" | "facebook" | "twitch" | "linkedin" | "twitter",
    objectives: string,
    maxProfiles: number,
    audienceTier: "any" | "nano" | "micro" | "mid" | "macro",
    campaignId: string,
    campaignTitle: string
  ) => {
    setBusy(true);
    try {
      const enqueue = httpsCallable(functions, "enqueueOpticDiscoveryJob");
      const res = await enqueue({
        platform,
        objectives,
        maxProfiles,
        campaignId,
        smsNotify: false,
        useBrowserExtension: false,
        audienceTier,
      });
      const data = res.data as { jobId?: string };
      if (!data?.jobId) throw new Error("Optic did not return a mission.");
      sessionStorage.setItem(OPTIC_ACTIVE_JOB_STORAGE_KEY, data.jobId);
      sessionStorage.setItem(OPTIC_CAMPAIGN_STORAGE_KEY, campaignId);
      pushVerza(opticLaunchLine(platform, campaignTitle, maxProfiles));
      router.push("/optic");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Optic did not start.";
      pushVerza(message);
    } finally {
      setBusy(false);
    }
  };

  const submit = (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    setDraft("");
    setMode(true);
    setMessages((prev) => [...prev, { id: nextId(), role: "user", text }]);
    const result = interpretDashboardChat(text, stats, isBrandTeam, awaitingCampaign, campaigns);
    if (result.kind === "reveal") {
      setMode(false);
      setAwaitingCampaign(false);
      return;
    }
    if (result.kind === "focus") {
      setMode(true);
      setAwaitingCampaign(false);
      return;
    }
    if (result.kind === "optic") {
      setAwaitingCampaign(false);
      void launchOptic(
        result.platform,
        result.objectives,
        result.maxProfiles,
        result.audienceTier,
        result.campaignId,
        result.campaignTitle
      );
      return;
    }
    if (result.awaitCampaign !== undefined) setAwaitingCampaign(result.awaitCampaign);
    if (result.href && result.text.startsWith("Opening")) {
      router.push(result.href);
      return;
    }
    pushVerza(result.text);
  };

  const pickStarter = (starter: Starter) => {
    setMenuOpen(false);
    if (starter.optic) {
      setMode(true);
      const result = interpretDashboardChat("find creators", stats, isBrandTeam, false, campaigns);
      if (result.kind === "say") {
        setAwaitingCampaign(result.awaitCampaign === true);
        pushVerza(result.text);
      }
      inputRef.current?.focus();
      return;
    }
    if (starter.href) router.push(starter.href);
  };

  const composer = (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setMenuOpen(false);
        submit(draft);
      }}
      className={cn(
        "group relative flex h-[4.25rem] items-center rounded-full border-2 border-[#1f8f68] bg-[#0B100E] pl-2 pr-2 text-white transition-[border-color,box-shadow] duration-300",
        "focus-within:border-[#16C088]",
        focused && started
          ? "shadow-none"
          : "shadow-[0_10px_28px_-8px_rgba(0,0,0,0.45),0_2px_8px_rgba(0,0,0,0.16)]"
      )}
    >
      <div ref={menuRef} className="relative">
        <button
          type="button"
          aria-label="Products"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          className="grid size-11 place-items-center rounded-full text-white/55 transition-colors hover:bg-white/10 hover:text-white"
        >
          <Plus className={cn("size-4 transition-transform duration-200", menuOpen && "rotate-45")} strokeWidth={2} />
        </button>
        {menuOpen && (
          <div className="absolute bottom-[calc(100%+0.75rem)] left-0 z-10 w-64 overflow-hidden rounded-2xl border border-white/10 bg-[#0B100E] py-1.5 shadow-[0_16px_40px_-16px_rgba(0,0,0,0.55)]">
            {starters.map((starter) => (
              <button
                key={starter.name}
                type="button"
                onClick={() => pickStarter(starter)}
                className="flex w-full flex-col items-start px-4 py-2.5 text-left transition-colors hover:bg-white/[0.06]"
              >
                <span className="text-[14px] font-medium tracking-[-0.01em] text-white">{starter.name}</span>
                <span className="text-[12px] text-white/50">{starter.detail}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <label htmlFor="dashboard-chat" className="sr-only">
        Message Verza
      </label>
      <input
        id="dashboard-chat"
        ref={inputRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        disabled={busy}
        placeholder={
          !focused
            ? "Ask me anything..."
            : awaitingCampaign
              ? "Which campaign?"
              : "Find creators, open Prism, ask about the numbers"
        }
        autoComplete="off"
        className="h-full min-w-0 flex-1 bg-transparent text-[17px] font-medium tracking-[-0.02em] text-white outline-none placeholder:font-normal placeholder:text-white/40"
      />
      <button
        type="submit"
        aria-label="Send"
        disabled={!draft.trim() || busy}
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-full bg-white text-[#0B100E] transition-all duration-200",
          draft.trim() ? "scale-100 opacity-100" : "pointer-events-none scale-90 opacity-0"
        )}
      >
        <ArrowUp className="size-4" strokeWidth={2.25} />
      </button>
    </form>
  );

  const transcript = (
    <div ref={threadRef} className="max-h-[min(46vh,24rem)] space-y-4 overflow-y-auto px-1">
      {messages.map((message) =>
        message.role === "verza" ? (
          <div key={message.id} className="flex items-start gap-3">
            <Image src="/verza-icon.svg" alt="" width={22} height={16} className="mt-1 h-4 w-[1.35rem] shrink-0" />
            <p className="whitespace-pre-line text-[15px] leading-6 tracking-[-0.011em] text-white">{message.text}</p>
          </div>
        ) : (
          <p key={message.id} className="pl-8 text-right text-[15px] leading-6 tracking-[-0.011em] text-white/60">
            {message.text}
          </p>
        )
      )}
      {busy && (
        <div className="flex items-start gap-3">
          <Image src="/verza-icon.svg" alt="" width={22} height={16} className="mt-1 h-4 w-[1.35rem] shrink-0 opacity-60" />
          <p className="text-[15px] leading-6 text-white/45">Starting Optic…</p>
        </div>
      )}
    </div>
  );

  return (
    <>
      {focused && (
        <button
          type="button"
          onClick={() => setMode(false)}
          className="pointer-events-auto fixed right-6 top-20 z-40 text-[12px] tracking-wide text-muted-foreground/70 transition-colors hover:text-foreground md:right-10 md:top-8"
        >
          Show numbers
        </button>
      )}

      {focused && started && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-5 pb-6 md:pb-8">
          <div className="pointer-events-auto w-full max-w-[36rem] rounded-[1.75rem] bg-[#0B100E] p-3 pt-5 text-white shadow-[0_24px_70px_-24px_rgba(0,0,0,0.55)]">
            {transcript}
            <div className="mt-4">{composer}</div>
          </div>
        </div>
      )}

      {focused && !started && (
        <div className="pointer-events-none absolute inset-0 z-20">
          <div className="sticky top-0 flex h-dvh flex-col justify-center px-5">
            <div className="pointer-events-auto mx-auto w-full max-w-[40rem]">
              <h2 className="mb-8 text-center text-[2.6rem] font-medium leading-none tracking-[-0.045em] text-foreground md:text-[3.25rem]">
                What should we do?
              </h2>
              {composer}
              <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
                {prompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => submit(prompt)}
                    className="text-[13px] text-muted-foreground/80 transition-colors hover:text-foreground"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {!focused && (
        <div className="pointer-events-auto fixed bottom-6 left-1/2 z-30 w-[min(40rem,calc(100vw-2.5rem))] -translate-x-1/2">
          {composer}
        </div>
      )}
    </>
  );
}
