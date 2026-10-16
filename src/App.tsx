import clsx from "clsx";
import { Box, CheckCircle2, Download, Layers, Loader2, Lock, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BASE_PRESETS, type BasePresetId, type BinAnalysis } from "./geometry/gridfinity";
import { CutControl, Dropzone, FileRow, Notice, Segmented, Step, isModelFile } from "./ui/controls";
import { useColors } from "./ui/colors";
import { Viewer, type Footprint, type ViewDir, type ViewerScene } from "./ui/Viewer";
import { GeometryClient } from "./worker/client";
import type { DisplayMesh, DonorChoice, LoadedModel, SwapOutput } from "./worker/protocol";

const client = new GeometryClient();

interface Loaded {
  id: number;
  name: string;
  size: number;
  model: LoadedModel;
  cut: number;
}

type View = "target" | "donor" | "result";
type DonorMode = "preset" | "file";

let nextId = 1;

export default function App() {
  const colors = useColors();
  const [target, setTarget] = useState<Loaded | null>(null);
  const [targetBusy, setTargetBusy] = useState(false);
  const [targetError, setTargetError] = useState<string | null>(null);

  const [donorMode, setDonorMode] = useState<DonorMode>("preset");
  const [preset, setPreset] = useState<BasePresetId>("magnets");
  const [presetModel, setPresetModel] = useState<LoadedModel | null>(null);
  const [donor, setDonor] = useState<Loaded | null>(null);
  const [donorBusy, setDonorBusy] = useState(false);
  const [donorError, setDonorError] = useState<string | null>(null);

  const [result, setResult] = useState<SwapOutput | null>(null);
  const [swapBusy, setSwapBusy] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);

  const [view, setView] = useState<View>("target");
  const [viewDir, setViewDir] = useState<{ dir: ViewDir; nonce: number }>({ dir: "iso", nonce: 0 });
  const [format, setFormat] = useState<"stl" | "3mf">("3mf");
  const [downloading, setDownloading] = useState(false);
  /** Show the result as soon as it's ready, unless the user is adjusting a cut. */
  const focusResult = useRef(false);

  // ------------------------------------------------------------ loading

  const loadFile = useCallback(async (slot: "target" | "donor", file: File) => {
    const setBusy = slot === "target" ? setTargetBusy : setDonorBusy;
    const setError = slot === "target" ? setTargetError : setDonorError;
    setBusy(true);
    setError(null);
    try {
      const bytes = await file.arrayBuffer();
      const model = await client.call({ type: "load", slot, name: file.name, bytes });
      const loaded: Loaded = { id: nextId++, name: file.name, size: file.size, model, cut: model.analysis.baseHeight };
      focusResult.current = true;
      if (slot === "target") {
        setTarget(loaded);
        setView("target");
      } else {
        setDonor(loaded);
        setDonorMode("file");
        setView("donor");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const loadSample = useCallback(async () => {
    setTargetBusy(true);
    setTargetError(null);
    try {
      const model = await client.call({ type: "sample" });
      focusResult.current = true;
      setTarget({ id: nextId++, name: "sample-bin-2x1.stl", size: 0, model, cut: model.analysis.baseHeight });
      setPreset("plain");
      setDonorMode("preset");
      setView("target");
    } catch (e) {
      setTargetError(e instanceof Error ? e.message : String(e));
    } finally {
      setTargetBusy(false);
    }
  }, []);

  const clear = (slot: "target" | "donor") => {
    void client.call({ type: "clear", slot });
    if (slot === "target") {
      setTarget(null);
      setTargetError(null);
    } else {
      setDonor(null);
      setDonorError(null);
    }
  };

  useEffect(() => {
    let live = true;
    client.call({ type: "preset", preset }).then((m) => live && setPresetModel(m));
    return () => {
      live = false;
    };
  }, [preset]);

  // ------------------------------------------------------------ swapping

  const donorChoice: DonorChoice | null =
    donorMode === "preset" ? { preset } : donor ? { cut: donor.cut } : null;
  const swapKey =
    target && donorChoice ? `${target.id}:${target.cut}:${donorMode === "preset" ? preset : `${donor!.id}:${donor!.cut}`}` : null;

  // Run at most one swap at a time and always finish with the latest settings.
  const latest = useRef<{ key: string; targetCut: number; donor: DonorChoice } | null>(null);
  const running = useRef(false);
  const runSwaps = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setSwapBusy(true);
    while (latest.current) {
      const job = latest.current;
      try {
        const r = await client.call({ type: "swap", targetCut: job.targetCut, donor: job.donor });
        if (latest.current === job) {
          setResult(r);
          setSwapError(null);
          if (focusResult.current) {
            focusResult.current = false;
            setView("result");
          }
        }
      } catch (e) {
        if (latest.current === job) {
          setResult(null);
          setSwapError(e instanceof Error ? e.message : String(e));
        }
      }
      if (latest.current === job) latest.current = null;
    }
    running.current = false;
    setSwapBusy(false);
  }, []);

  useEffect(() => {
    if (!swapKey || !target || !donorChoice) {
      latest.current = null;
      setResult(null);
      setSwapError(null);
      return;
    }
    const t = setTimeout(() => {
      latest.current = { key: swapKey, targetCut: target.cut, donor: donorChoice };
      void runSwaps();
    }, 120);
    return () => clearTimeout(t);
    // swapKey captures everything that matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapKey]);

  // ------------------------------------------------------------ download

  const outName = useMemo(() => {
    if (!target) return "";
    const stem = (n: string) => n.replace(/\.(stl|3mf)$/i, "");
    const suffix = donorMode === "preset" ? `${preset}-base` : donor ? `${stem(donor.name)}-base` : "";
    return `${stem(target.name)}-${suffix}`;
  }, [target, donor, donorMode, preset]);

  const download = async () => {
    setDownloading(true);
    try {
      const bytes = await client.call({ type: "export", format, name: outName });
      const blob = new Blob([bytes as BlobPart], { type: format === "stl" ? "model/stl" : "model/3mf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${outName}.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setSwapError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
    }
  };

  // ------------------------------------------------------------ drag & drop anywhere

  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  useEffect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current++;
      setDragging(true);
    };
    const leave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);

  const dropOn = (slot: "target" | "donor") => (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = [...e.dataTransfer.files].filter(isModelFile);
    if (files.length === 0) return;
    if (files.length >= 2) {
      void loadFile("target", files[0]).then(() => loadFile("donor", files[1]));
    } else {
      void loadFile(slot, files[0]);
    }
  };

  // ------------------------------------------------------------ viewer scene

  const donorModel = donorMode === "preset" ? presetModel : donor?.model ?? null;
  const donorCut = donorMode === "preset" ? (presetModel?.analysis.baseHeight ?? 4.75) : (donor?.cut ?? 0);

  const resultBounds = useMemo(() => (result ? bounds(result.mesh) : null), [result]);

  const available: Record<View, boolean> = {
    target: !!target,
    donor: !!donorModel,
    result: !!result,
  };
  const activeView: View | null = available[view]
    ? view
    : available.result
      ? "result"
      : available.target
        ? "target"
        : null;

  let scene: ViewerScene | null = null;
  if (activeView === "target" && target) {
    scene = {
      kind: "input",
      mesh: target.model.mesh,
      footprint: footprintOf(target.model.analysis),
      cutZ: target.model.analysis.min[2] + target.cut,
      keep: "above",
      keepColor: colors.body,
    };
  } else if (activeView === "donor" && donorModel) {
    scene = {
      kind: "input",
      mesh: donorModel.mesh,
      footprint: footprintOf(donorModel.analysis),
      cutZ: donorModel.analysis.min[2] + donorCut,
      keep: "below",
      keepColor: colors.base,
    };
  } else if (activeView === "result" && result && target && resultBounds) {
    scene = {
      kind: "result",
      mesh: result.mesh,
      footprint: { ...footprintOf(target.model.analysis), ...resultBounds },
      bodyTriangles: result.bodyTriangles,
    };
  }
  const fitKey =
    activeView === "target"
      ? `t${target?.id}`
      : activeView === "donor"
        ? donorMode === "preset"
          ? "preset"
          : `d${donor?.id}`
        : `r${target?.id}`;

  const focusView = (v: View) => {
    focusResult.current = false;
    setView(v);
  };

  // ------------------------------------------------------------ render

  const ta = target?.model.analysis;
  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-line bg-panel md:h-full md:w-[400px] md:overflow-y-auto md:border-r">
        <header className="flex items-center gap-3 border-b border-line px-5 py-4">
          <Logo />
          <div className="min-w-0 flex-1">
            <h1 className="text-base leading-tight font-semibold tracking-tight">rsfinity</h1>
            <p className="text-xs text-muted">Swap the base of any Gridfinity bin</p>
          </div>
        </header>

        <Step n={1} title="Bin" subtitle="Its body is kept; its base is cut off." done={!!target}>
          {target && ta ? (
            <>
              <FileRow
                name={target.name}
                detail={describe(ta, target.size)}
                busy={targetBusy}
                onReplace={(f) => loadFile("target", f)}
                onRemove={() => clear("target")}
              />
              <CutControl
                label="Cut off the base below"
                value={target.cut}
                detected={ta.baseHeight}
                max={round2(Math.min(20, ta.max[2] - ta.min[2] - 0.5))}
                onChange={(v) => {
                  focusView("target");
                  setTarget({ ...target, cut: v });
                }}
                onFocus={() => focusView("target")}
                help={
                  ta.baseDetected
                    ? `Detected where the feet meet the body at ${ta.baseHeight} mm. Everything above the plane is kept.`
                    : "Everything above the plane is kept."
                }
              />
              {ta.warnings.map((w) => (
                <Notice key={w} tone="warn">
                  {w}
                </Notice>
              ))}
            </>
          ) : (
            <>
              <Dropzone
                busy={targetBusy}
                onFile={(f) => loadFile("target", f)}
                title="Drop a bin here or click to browse"
                hint="STL or 3MF, base facing down"
              />
              <button
                type="button"
                onClick={loadSample}
                className="flex items-center gap-1.5 text-xs text-muted hover:text-fg"
              >
                <Sparkles className="size-3.5" /> No file handy? Try a sample bin
              </button>
            </>
          )}
          {targetError && <Notice tone="error">{targetError}</Notice>}
        </Step>

        <Step
          n={2}
          title="New base"
          subtitle="Its feet are tiled under the bin."
          done={!!donorChoice}
          aside={
            <Segmented
              size="sm"
              value={donorMode}
              onChange={(m) => {
                focusResult.current = true;
                setDonorMode(m);
                setView("donor");
              }}
              options={[
                { value: "preset", label: "Built-in" },
                { value: "file", label: "From a bin" },
              ]}
            />
          }
        >
          {donorMode === "preset" ? (
            <div className="grid gap-2" role="radiogroup" aria-label="Built-in base">
              {BASE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={preset === p.id}
                  onClick={() => {
                    focusResult.current = true;
                    setPreset(p.id);
                  }}
                  className={clsx(
                    "flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                    preset === p.id ? "border-accent bg-accent/10" : "border-line hover:bg-raised",
                  )}
                >
                  <PresetIcon id={p.id} active={preset === p.id} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{p.name}</span>
                    <span className="block text-xs text-muted">{p.description}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : donor ? (
            <>
              <FileRow
                name={donor.name}
                detail={describe(donor.model.analysis, donor.size)}
                busy={donorBusy}
                onReplace={(f) => loadFile("donor", f)}
                onRemove={() => clear("donor")}
              />
              <CutControl
                label="Take the base below"
                value={donor.cut}
                detected={donor.model.analysis.baseHeight}
                max={round2(Math.min(20, donor.model.analysis.max[2] - donor.model.analysis.min[2]))}
                onChange={(v) => {
                  focusView("donor");
                  setDonor({ ...donor, cut: v });
                }}
                onFocus={() => focusView("donor")}
                help="Everything below the plane becomes the new base. Any size of bin works: its cells are reused, with edge cells kept on the edges."
              />
              {donor.model.analysis.warnings.map((w) => (
                <Notice key={w} tone="warn">
                  {w}
                </Notice>
              ))}
            </>
          ) : (
            <Dropzone
              busy={donorBusy}
              onFile={(f) => loadFile("donor", f)}
              title="Drop a bin with the base you want"
              hint="Any size works, even 1×1"
            />
          )}
          {donorMode === "file" && donorError && <Notice tone="error">{donorError}</Notice>}
        </Step>

        <Step n={3} title="Download" subtitle="A single watertight solid, ready to slice." done={!!result}>
          {result && target ? (
            <>
              <ul className="space-y-1 text-xs text-muted">
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className={clsx("size-3.5", result.pieces === 1 ? "text-ok" : "text-warn")} />
                  {result.pieces === 1 ? "One connected, watertight part" : `${result.pieces} separate parts`}
                </li>
                <li className="flex items-center gap-1.5">
                  <Layers className="size-3.5" />
                  {result.mesh.triangles.toLocaleString()} triangles
                  {resultBounds && <> · {round2(resultBounds.max[2] - resultBounds.min[2])} mm tall</>}
                </li>
                {result.voids > 0 && (
                  <li className="flex items-start gap-1.5">
                    <Box className="mt-px size-3.5 shrink-0" />
                    <span>
                      {result.voids} enclosed cavit{result.voids > 1 ? "ies" : "y"} from old holes above the cut,
                      sealed by the new base. Harmless; slicers print around them.
                    </span>
                  </li>
                )}
              </ul>
              {result.warnings.map((w) => (
                <Notice key={w} tone="warn">
                  {w}
                </Notice>
              ))}
              <div className="flex items-center gap-2">
                <Segmented
                  value={format}
                  onChange={setFormat}
                  options={[
                    { value: "3mf", label: "3MF" },
                    { value: "stl", label: "STL" },
                  ]}
                />
                <button
                  type="button"
                  onClick={download}
                  disabled={swapBusy || downloading}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition hover:brightness-110 disabled:opacity-60"
                >
                  {downloading || swapBusy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                  Download
                </button>
              </div>
              <p className="truncate text-[11px] text-muted" title={`${outName}.${format}`}>
                {outName}.{format}
              </p>
            </>
          ) : swapBusy ? (
            <p className="flex items-center gap-2 text-xs text-muted">
              <Loader2 className="size-3.5 animate-spin" /> Swapping the base…
            </p>
          ) : (
            <p className="text-xs text-muted">
              {!target ? "Add a bin to get started." : "Choose a new base to see the result."}
            </p>
          )}
          {swapError && <Notice tone="error">{swapError}</Notice>}
        </Step>

        <footer className="mt-auto flex items-center gap-1.5 px-5 py-4 text-[11px] text-muted">
          <Lock className="size-3" /> Everything runs in your browser. Files never leave your device.
        </footer>
      </aside>

      <main
        className="relative min-h-[65vh] flex-1 overflow-hidden md:min-h-0"
        onDragOver={(e) => e.preventDefault()}
        onDrop={dropOn(target ? "donor" : "target")}
      >
        {scene ? (
          <Viewer scene={scene} colors={colors} view={viewDir} fitKey={fitKey} />
        ) : (
          <EmptyState onSample={loadSample} busy={targetBusy} />
        )}

        {activeView && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-2 p-3">
            <div className="pointer-events-auto">
              <Segmented
                value={activeView}
                onChange={focusView}
                options={[
                  { value: "target", label: "Bin", disabled: !available.target },
                  { value: "donor", label: "New base", disabled: !available.donor },
                  {
                    value: "result",
                    label: (
                      <span className="flex items-center gap-1.5">
                        Result {swapBusy && <Loader2 className="size-3 animate-spin" />}
                      </span>
                    ),
                    disabled: !available.result,
                  },
                ]}
              />
            </div>
            <div className="pointer-events-auto">
              <Segmented
                size="sm"
                value={viewDir.dir}
                onChange={(dir) => setViewDir((v) => ({ dir, nonce: v.nonce + 1 }))}
                options={[
                  { value: "iso", label: "3D" },
                  { value: "front", label: "Front" },
                  { value: "bottom", label: "Below" },
                  { value: "top", label: "Top" },
                ]}
              />
            </div>
          </div>
        )}

        {scene && (
          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-3 rounded-lg bg-panel/85 px-3 py-2 text-xs backdrop-blur">
            {scene.kind === "result" ? (
              <>
                <Swatch color={colors.body} label="Bin body" />
                <Swatch color={colors.base} label="New base" />
              </>
            ) : (
              <>
                <Swatch color={scene.keepColor} label={scene.keep === "above" ? "Kept body" : "Base to use"} />
                <Swatch color={colors.ghost} label="Discarded" faded />
                <Swatch color={colors.plane} label="Cut plane" line />
              </>
            )}
          </div>
        )}

        {dragging && (
          <div className="absolute inset-0 z-10 grid grid-cols-1 gap-3 bg-bg/80 p-4 backdrop-blur-sm sm:grid-cols-2">
            <DropTarget label="Use as the bin" sub="Keeps its body" onDrop={dropOn("target")} />
            <DropTarget label="Use as the new base" sub="Takes its feet" onDrop={dropOn("donor")} />
          </div>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- helpers

function footprintOf(a: BinAnalysis): Footprint {
  return { min: a.min, max: a.max, center: a.center, unitsX: a.unitsX, unitsY: a.unitsY };
}

function bounds(mesh: DisplayMesh) {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      if (p[i + a] < min[a]) min[a] = p[i + a];
      if (p[i + a] > max[a]) max[a] = p[i + a];
    }
  }
  return { min, max };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function describe(a: BinAnalysis, size: number) {
  const units = `${a.unitsX} × ${a.unitsY} units${a.footPitch === 21 ? " (half-grid)" : ""}`;
  const h = `${round2(a.max[2] - a.min[2])} mm tall`;
  const parts = [units, h];
  if (size > 0) parts.push(size > 1e6 ? `${(size / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1e3))} kB`);
  return parts.join(" · ");
}

function Swatch({ color, label, faded, line }: { color: string; label: string; faded?: boolean; line?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-muted">
      <span
        className={clsx(line ? "h-0.5 w-3.5" : "size-2.5 rounded-sm", faded && "opacity-40")}
        style={{ background: color }}
      />
      {label}
    </span>
  );
}

function DropTarget({ label, sub, onDrop }: { label: string; sub: string; onDrop: (e: React.DragEvent) => void }) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.stopPropagation();
        setOver(false);
        onDrop(e);
      }}
      className={clsx(
        "grid place-items-center rounded-2xl border-2 border-dashed text-center transition-colors",
        over ? "border-accent bg-accent/10" : "border-line",
      )}
    >
      <div>
        <div className="text-lg font-semibold">{label}</div>
        <div className="text-sm text-muted">{sub}</div>
      </div>
    </div>
  );
}

function EmptyState({ onSample, busy }: { onSample: () => void; busy: boolean }) {
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="max-w-md text-center">
        <svg viewBox="0 0 220 120" className="mx-auto mb-6 w-64" aria-hidden>
          <g fill="none" strokeWidth="2" strokeLinejoin="round">
            <path d="M30 20h70v52H30z" stroke="var(--body)" fill="color-mix(in srgb, var(--body) 18%, transparent)" />
            <path d="M32 78h30l-3 12H35zM68 78h30l-3 12H71z" stroke="var(--muted)" strokeDasharray="4 3" />
            <path d="M120 20h70v52h-70z" stroke="var(--body)" fill="color-mix(in srgb, var(--body) 18%, transparent)" />
            <path d="M122 72h30l-3 12h-24zM158 72h30l-3 12h-24z" stroke="var(--accent)" fill="color-mix(in srgb, var(--accent) 30%, transparent)" />
            <path d="M104 46h12m-5-5 5 5-5 5" stroke="var(--muted)" />
          </g>
        </svg>
        <h2 className="text-lg font-semibold">Give any bin the base you want</h2>
        <p className="mt-2 text-sm text-muted">
          Drop a Gridfinity bin, then pick a built-in base (plain, magnets, screws) or take the base from another bin.
          You'll get one clean, watertight model back.
        </p>
        <button
          type="button"
          onClick={onSample}
          disabled={busy}
          className="mt-5 inline-flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-raised"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Try a sample bin
        </button>
      </div>
    </div>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
      <rect x="3" y="3" width="12" height="12" rx="3" fill="var(--accent)" />
      <rect x="17" y="3" width="12" height="12" rx="3" fill="var(--body)" />
      <rect x="3" y="17" width="12" height="12" rx="3" fill="var(--body)" />
      <rect x="17" y="17" width="12" height="12" rx="3" fill="var(--body)" />
    </svg>
  );
}

function PresetIcon({ id, active }: { id: BasePresetId; active: boolean }) {
  const stroke = active ? "var(--accent)" : "var(--muted)";
  return (
    <svg viewBox="0 0 36 36" className="size-9 shrink-0 rounded-lg bg-raised p-1" aria-hidden>
      <rect x="4" y="4" width="28" height="28" rx="5" fill="none" stroke={stroke} strokeWidth="1.5" />
      <rect x="8" y="8" width="20" height="20" rx="3" fill="none" stroke={stroke} strokeWidth="1" opacity="0.6" />
      {id !== "plain" &&
        [
          [10, 10],
          [26, 10],
          [10, 26],
          [26, 26],
        ].map(([x, y]) => (
          <g key={`${x}${y}`}>
            <circle cx={x} cy={y} r="3.2" fill={stroke} opacity="0.85" />
            {id === "magnets-screws" && <circle cx={x} cy={y} r="1.2" fill="var(--panel)" />}
          </g>
        ))}
    </svg>
  );
}
