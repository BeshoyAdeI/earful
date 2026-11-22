import { cn } from "../lib/format";

/** The Earful mark: rounded bars forming an E. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <g fill="currentColor">
        <rect x="10" y="10" width="7" height="28" rx="3.5" />
        <rect x="10" y="10" width="28" height="7" rx="3.5" />
        <rect x="10" y="20.5" width="21" height="7" rx="3.5" />
        <rect x="10" y="31" width="28" height="7" rx="3.5" />
      </g>
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <LogoMark className="size-7 text-accent-text" />
      <span className="text-[17px] font-semibold tracking-tight">earful</span>
    </span>
  );
}

/** The mark in motion: marks the track that is playing. */
export function Equalizer({ live, className }: { live: boolean; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("inline-flex h-3.5 items-end gap-[2px]", live && "eq-live", className)}>
      <span className="eq-bar h-full w-[3px] rounded-full bg-accent-text" />
      <span className="eq-bar h-full w-[3px] rounded-full bg-accent-text" />
      <span className="eq-bar h-full w-[3px] rounded-full bg-accent-text" />
    </span>
  );
}
