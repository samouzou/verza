"use client";

import { useState } from "react";
import { Check, Copy, Linkedin } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const XIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.727-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

export function PublicShareBar({
  url,
  title,
  className,
}: {
  url: string;
  title: string;
  className?: string;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const encodedUrl = encodeURIComponent(url);
  const encodedText = encodeURIComponent(title);
  const xHref = `https://x.com/intent/post?text=${encodedText}&url=${encodedUrl}`;
  const linkedInHref = `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      toast({ title: "Link copied" });
    } catch {
      toast({ title: "Could not copy", variant: "destructive" });
    }
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <p className="text-xs font-medium text-muted-foreground mr-1">Share</p>
      <Button asChild variant="outline" size="sm" className="h-8">
        <a href={xHref} target="_blank" rel="noopener noreferrer">
          <XIcon className="h-3.5 w-3.5" />
          <span className="ml-1.5">X</span>
        </a>
      </Button>
      <Button asChild variant="outline" size="sm" className="h-8">
        <a href={linkedInHref} target="_blank" rel="noopener noreferrer">
          <Linkedin className="h-3.5 w-3.5" />
          <span className="ml-1.5">LinkedIn</span>
        </a>
      </Button>
      <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => void copyLink()}>
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        <span className="ml-1.5">{copied ? "Copied" : "Copy link"}</span>
      </Button>
    </div>
  );
}
