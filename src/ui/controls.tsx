import clsx from "clsx";
import { AlertTriangle, FileBox, Loader2, RotateCcw, Upload, X } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";

export const ACCEPT = ".stl,.3mf";

export function isModelFile(f: File) {
  return /\.(stl|3mf)$/i.test(f.name);
}

export function Dropzone({
  onFile,
  busy,
  title,
  hint,
}: {
  onFile: (f: File) => void;
  busy?: boolean;
  title: string;
  hint: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <button
      type="button"
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const f = [...e.dataTransfer.files].find(isModelFile);
        if (f) onFile(f);
      }}
      className={clsx(
        "group flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors",
        over ? "border-accent bg-accent/10" : "border-line hover:border-muted hover:bg-raised",
      )}
    >
      {busy ? (
        <Loader2 className="size-6 animate-spin text-accent" />
      ) : (
        <Upload className={clsx("size-6 transition-colors", over ? "text-accent" : "text-muted group-hover:text-fg")} />
      )}
      <span className="text-sm font-medium">{busy ? "Reading model…" : title}</span>
      <span className="text-xs text-muted">{hint}</span>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </button>
  );
}

export function FileRow({
  name,
  detail,
  onReplace,
  onRemove,
  busy,
}: {
  name: string;
  detail: ReactNode;
  onReplace: (f: File) => void;
  onRemove: () => void;
  busy?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-raised px-3 py-2.5">
      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-panel">
        {busy ? <Loader2 className="size-4 animate-spin text-accent" /> : <FileBox className="size-4 text-muted" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium" title={name}>
          {name}
        </div>
        <div className="text-xs leading-snug text-muted">{detail}</div>
      </div>
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-panel hover:text-fg"
      >
        Replace
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove"
        className="rounded-md p-1 text-muted hover:bg-panel hover:text-fg"
      >
        <X className="size-4" />
      </button>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onReplace(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export function CutControl({
  label,
  value,
  detected,
  max,
  onChange,
  onFocus,
  help,
}: {
  label: string;
  value: number;
  detected: number;
  max: number;
  onChange: (v: number) => void;
  onFocus?: () => void;
  help: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (v: number) => Math.min(max, Math.max(0.2, Math.round(v * 100) / 100));
  const changed = Math.abs(value - detected) > 1e-6;
  return (
    <div className="space-y-1.5" onFocus={onFocus} onPointerDown={onFocus}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-muted">
          {label}
        </label>
        <div className="flex items-center gap-1">
          {changed && (
            <button
              type="button"
              onClick={() => onChange(detected)}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted hover:bg-raised hover:text-fg"
              title={`Reset to the detected ${detected} mm`}
            >
              <RotateCcw className="size-3" /> {detected} mm
            </button>
          )}
          <div className="flex items-center rounded-md border border-line bg-raised focus-within:border-accent">
            <input
              type="number"
              inputMode="decimal"
              step={0.05}
              min={0.2}
              max={max}
              value={draft ?? value.toFixed(2)}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                if (draft !== null && Number.isFinite(parseFloat(draft))) onChange(clamp(parseFloat(draft)));
                setDraft(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="w-14 bg-transparent py-0.5 pl-2 text-right font-mono text-xs tabular-nums outline-none"
              aria-label={`${label} in millimetres`}
            />
            <span className="pr-2 pl-1 text-xs text-muted">mm</span>
          </div>
        </div>
      </div>
      <input
        id={id}
        type="range"
        min={0.2}
        max={max}
        step={0.05}
        value={value}
        onChange={(e) => onChange(clamp(parseFloat(e.target.value)))}
        className="w-full"
        style={{ ["--fill" as string]: `${((value - 0.2) / (max - 0.2)) * 100}%` }}
      />
      <p className="text-[11px] leading-snug text-muted">{help}</p>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
}: {
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-raised p-0.5" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={clsx(
            "rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
            size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
            value === o.value ? "bg-panel text-fg shadow-sm" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Notice({ tone, children }: { tone: "warn" | "error"; children: ReactNode }) {
  return (
    <div
      className={clsx(
        "flex gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed",
        tone === "error" ? "border-danger/40 bg-danger/10 text-danger" : "border-warn/30 bg-warn/10 text-warn",
      )}
      role={tone === "error" ? "alert" : undefined}
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

export function Step({
  n,
  title,
  subtitle,
  done,
  children,
  aside,
}: {
  n: number;
  title: string;
  subtitle: string;
  done?: boolean;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="space-y-3 border-b border-line px-5 py-5 last:border-b-0">
      <header className="flex items-start gap-3">
        <span
          className={clsx(
            "grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold",
            done ? "bg-accent text-accent-fg" : "bg-raised text-muted ring-1 ring-line",
          )}
        >
          {n}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm leading-6 font-semibold">{title}</h2>
          <p className="text-xs text-muted">{subtitle}</p>
        </div>
        {aside}
      </header>
      <div className="space-y-3 pl-9">{children}</div>
    </section>
  );
}
