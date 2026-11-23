import { useT } from "../i18n";
import { cn } from "../lib/format";
import { useProfile } from "../stores/profile";

export function useProfileName(): string {
  const t = useT();
  return useProfile((s) => s.name) || t.profile.listener;
}

export function ProfileAvatar({ name, className }: { name: string; className?: string }) {
  const t = useT();
  const initial = new Intl.Segmenter(t.locale).segment(name)[Symbol.iterator]().next().value?.segment;
  return (
    <span aria-hidden="true" className={cn("grid shrink-0 place-items-center rounded-full bg-accent font-semibold text-accent-ink", className)}>
      {initial?.toLocaleUpperCase(t.locale)}
    </span>
  );
}
