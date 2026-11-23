import { cn } from "../lib/format";

export function ProfileSegments<T extends string>({ label, value, options, onChange, labels }: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  labels: Record<T, string>;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1 rounded-[20px] bg-surface-1 p-1 ring-1 ring-line">
      {options.map((option) => (
        <button key={option} type="button" aria-pressed={value === option} onClick={() => onChange(option)}
          className={cn("min-h-9 flex-1 rounded-full px-2.5 py-1.5 text-sm font-medium transition-colors",
            value === option ? "bg-surface-4 text-fg shadow-[inset_0_1px_0_var(--highlight)]" : "text-fg-2 hover:text-fg")}>
          {labels[option]}
        </button>
      ))}
    </div>
  );
}
