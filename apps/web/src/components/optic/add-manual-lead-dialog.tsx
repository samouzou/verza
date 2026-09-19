"use client";

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Loader2, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { functions } from "@/lib/firebase";
import { OPTIC_PLATFORMS } from "@/lib/optic/platforms";
import type { OpticCampaignOption } from "@/lib/optic/types";

type AddManualLeadDialogProps = {
  campaigns: OpticCampaignOption[];
  campaignFilter?: string;
  disabled?: boolean;
};

type AddResult = {
  ok: true;
  leadId: string;
  profileUrl: string;
  matchScore: number;
  charged: boolean;
  overage?: boolean;
};

export function AddManualLeadDialog({
  campaigns,
  campaignFilter,
  disabled,
}: AddManualLeadDialogProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profileUrl, setProfileUrl] = useState("");
  const [creatorName, setCreatorName] = useState("");
  const [platform, setPlatform] = useState<string>("__auto__");
  const [followerCount, setFollowerCount] = useState("");
  const [niche, setNiche] = useState("");
  const [email, setEmail] = useState("");
  const [bio, setBio] = useState("");
  const [matchReason, setMatchReason] = useState("");
  const [campaignId, setCampaignId] = useState(() => {
    if (
      campaignFilter &&
      campaignFilter !== "__all__" &&
      campaignFilter !== "__pooled__"
    ) {
      return campaignFilter;
    }
    return "__none__";
  });

  const reset = () => {
    setProfileUrl("");
    setCreatorName("");
    setPlatform("__auto__");
    setFollowerCount("");
    setNiche("");
    setEmail("");
    setBio("");
    setMatchReason("");
    setCampaignId(
      campaignFilter &&
        campaignFilter !== "__all__" &&
        campaignFilter !== "__pooled__"
        ? campaignFilter
        : "__none__"
    );
  };

  const submit = async () => {
    const url = profileUrl.trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      toast({
        variant: "destructive",
        title: "Profile URL",
        description: "Paste a full https profile link.",
      });
      return;
    }
    setSaving(true);
    try {
      const callable = httpsCallable(functions, "addOpticManualLead");
      const payload: Record<string, unknown> = {
        profileUrl: url,
        creatorName: creatorName.trim() || null,
        followerCount: followerCount.trim() || null,
        niche: niche.trim() || null,
        email: email.trim() || null,
        bio: bio.trim() || null,
        matchReason: matchReason.trim() || null,
        campaignId: campaignId !== "__none__" ? campaignId : null,
      };
      if (platform !== "__auto__") payload.platform = platform;
      const res = await callable(payload);
      const data = res.data as AddResult;
      toast({
        title: "Creator added",
        description: `${creatorName.trim() || "Creator"} saved · ${data.matchScore}% match${
          data.charged ? " · 1 credit used" : data.overage ? " · overage" : ""
        }.`,
      });
      reset();
      setOpen(false);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Could not add this creator.";
      toast({
        variant: "destructive",
        title: "Vault",
        description: message,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          <UserPlus className="mr-1.5 h-3.5 w-3.5" />
          Add creator
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add creator to vault</DialogTitle>
          <DialogDescription>
            Save someone you found outside Optic scraping. Uses 1 Optic credit.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="manual-profile-url">Profile URL</Label>
            <Input
              id="manual-profile-url"
              value={profileUrl}
              onChange={(e) => setProfileUrl(e.target.value)}
              placeholder="https://…"
              disabled={saving}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="manual-name">Name</Label>
              <Input
                id="manual-name"
                value={creatorName}
                onChange={(e) => setCreatorName(e.target.value)}
                placeholder="Creator name"
                disabled={saving}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Platform</Label>
              <Select value={platform} onValueChange={setPlatform} disabled={saving}>
                <SelectTrigger>
                  <SelectValue placeholder="Detect from URL" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__auto__">Detect from URL</SelectItem>
                  {OPTIC_PLATFORMS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="manual-followers">Followers</Label>
              <Input
                id="manual-followers"
                value={followerCount}
                onChange={(e) => setFollowerCount(e.target.value)}
                placeholder="12.4K"
                disabled={saving}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-niche">Niche</Label>
              <Input
                id="manual-niche"
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                placeholder="Beauty, tech…"
                disabled={saving}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manual-email">Email (optional)</Label>
            <Input
              id="manual-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="creator@…"
              disabled={saving}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Attach campaign (optional)</Label>
            <Select value={campaignId} onValueChange={setCampaignId} disabled={saving}>
              <SelectTrigger>
                <SelectValue placeholder="No campaign" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No campaign</SelectItem>
                {campaigns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {(c.title || "Campaign").slice(0, 56)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manual-bio">Bio / notes (optional)</Label>
            <Textarea
              id="manual-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Short bio or why they’re a fit…"
              className="min-h-[72px]"
              disabled={saving}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manual-reason">Match note (optional)</Label>
            <Input
              id="manual-reason"
              value={matchReason}
              onChange={(e) => setMatchReason(e.target.value)}
              placeholder="Why they fit this brief"
              disabled={saving}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={saving}>
            {saving ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : null}
            Add to vault
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
