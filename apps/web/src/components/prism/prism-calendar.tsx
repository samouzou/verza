"use client";

import { addDays, format, isSameDay, isSameMonth, isToday } from "date-fns";
import { Flag, Plus } from "lucide-react";

import {
  PRISM_CHANNEL_META,
  PRISM_STATUS_META,
  type PrismPost,
} from "@/lib/prism/types";
import { cn } from "@/lib/utils";

export type CalendarMarker = { id: string; date: Date; label: string };

export const PRISM_DRAG_TYPE = "application/x-prism-post";

export function PostChip({
  post,
  pillarLabel,
  onOpen,
  compact,
}: {
  post: PrismPost;
  pillarLabel?: string;
  onOpen: (id: string) => void;
  compact?: boolean;
}) {
  const when = post.scheduledAt ? new Date(post.scheduledAt) : null;
  const draggable = post.status !== "posted";
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData(PRISM_DRAG_TYPE, post.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(post.id);
      }}
      className={cn(
        "group w-full rounded-md border bg-card px-1.5 py-1 text-left text-xs shadow-sm transition-colors hover:border-primary/50",
        draggable && "cursor-grab active:cursor-grabbing",
        post.status === "posted" && "opacity-70"
      )}
      title={post.title}
    >
      <div className="flex items-center gap-1">
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", PRISM_STATUS_META[post.status].dot)} />
        {when && <span className="shrink-0 tabular-nums text-muted-foreground">{format(when, "h:mmaaaaa")}</span>}
        <span className="truncate font-medium">{post.title}</span>
      </div>
      {!compact && (
        <div className="mt-1 flex flex-wrap items-center gap-0.5">
          {post.channels.map((ch) => (
            <span key={ch} className={cn("rounded border px-1 text-[10px] leading-4", PRISM_CHANNEL_META[ch].chip)}>
              {PRISM_CHANNEL_META[ch].label}
            </span>
          ))}
          {pillarLabel && <span className="truncate text-[10px] text-muted-foreground">· {pillarLabel}</span>}
        </div>
      )}
    </button>
  );
}

export function PrismCalendar({
  view,
  gridStart,
  anchor,
  posts,
  markers,
  pillarLabel,
  onOpen,
  onCreate,
  onDropPost,
  onShowDay,
}: {
  view: "month" | "week";
  gridStart: Date;
  anchor: Date;
  posts: PrismPost[];
  markers: CalendarMarker[];
  pillarLabel: (id: string) => string;
  onOpen: (id: string) => void;
  onCreate: (day: Date) => void;
  onDropPost: (postId: string, day: Date) => void;
  onShowDay: (day: Date) => void;
}) {
  const dayCount = view === "month" ? 42 : 7;
  const days = Array.from({ length: dayCount }, (_, i) => addDays(gridStart, i));
  const byDay = (day: Date) =>
    posts
      .filter((p) => p.scheduledAt && isSameDay(new Date(p.scheduledAt), day))
      .sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""));

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="grid grid-cols-7 border-b bg-muted/40">
        {days.slice(0, 7).map((d) => (
          <div key={d.toISOString()} className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            {format(d, view === "week" ? "EEE d" : "EEE")}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const items = byDay(day);
          const dayMarkers = markers.filter((m) => isSameDay(m.date, day));
          const outside = view === "month" && !isSameMonth(day, anchor);
          const visible = view === "month" ? items.slice(0, 3) : items;
          return (
            <div
              key={day.toISOString()}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes(PRISM_DRAG_TYPE)) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }
              }}
              onDrop={(e) => {
                const id = e.dataTransfer.getData(PRISM_DRAG_TYPE);
                if (id) onDropPost(id, day);
              }}
              onDoubleClick={() => onCreate(day)}
              className={cn(
                "group relative flex flex-col gap-1 border-b border-r p-1.5",
                view === "month" ? "min-h-[118px]" : "min-h-[420px]",
                outside && "bg-muted/20"
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-xs",
                    isToday(day) ? "bg-primary font-semibold text-primary-foreground" : outside ? "text-muted-foreground/60" : "text-muted-foreground"
                  )}
                >
                  {format(day, "d")}
                </span>
                <button
                  type="button"
                  onClick={() => onCreate(day)}
                  className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
                  aria-label={`New post on ${format(day, "MMM d")}`}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              {dayMarkers.map((m) => (
                <div key={m.id} className="flex items-center gap-1 truncate rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-800 dark:text-amber-300" title={m.label}>
                  <Flag className="h-2.5 w-2.5 shrink-0" />
                  <span className="truncate">{m.label}</span>
                </div>
              ))}
              {visible.map((p) => (
                <PostChip key={p.id} post={p} pillarLabel={view === "week" ? pillarLabel(p.pillar) : undefined} onOpen={onOpen} compact={view === "month"} />
              ))}
              {view === "month" && items.length > 3 && (
                <button type="button" onClick={() => onShowDay(day)} className="text-left text-[11px] text-muted-foreground hover:underline">
                  +{items.length - 3} more
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
