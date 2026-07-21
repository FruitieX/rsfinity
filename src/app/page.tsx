"use client";

import { useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { FileUpload } from "@/components/upload/FileUpload";
import { MountSelector, type CustomMount } from "@/components/workflow/MountSelector";
import { CutPlaneControl } from "@/components/workflow/CutPlaneControl";
import {
  initWasm,
  processFile,
  analyzeMesh,
  swapMountGenerated,
  swapMountFromTriangles,
  debug3mf,
  type ProcessedMesh,
  type MeshAnalysis,
} from "@/lib/wasm-api";
import { type MountPreset } from "@/lib/mount-presets";

const MeshViewer = dynamic(
  () =>
    import("@/components/viewer/MeshViewer").then((mod) => mod.MeshViewer),
  { ssr: false }
);

type WorkflowStep = "upload" | "configure" | "preview";

export default function Home() {
  const [wasmReady, setWasmReady] = useState(false);
  const [step, setStep] = useState<WorkflowStep>("upload");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // File state
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileData, setFileData] = useState<Uint8Array | null>(null);
  const [originalMesh, setOriginalMesh] = useState<ProcessedMesh | null>(null);
  const [analysis, setAnalysis] = useState<MeshAnalysis | null>(null);

  // Configuration state
  const [cutHeight, setCutHeight] = useState(5);
  const [gridX, setGridX] = useState(1);
  const [gridY, setGridY] = useState(1);
  const [selectedMount, setSelectedMount] = useState<MountPreset | null>(null);
  const [customMount, setCustomMount] = useState<CustomMount | null>(null);

  // Preview state
  const [previewMesh, setPreviewMesh] = useState<ProcessedMesh | null>(null);

  // Initialize WASM
  useEffect(() => {
    initWasm().then(() => setWasmReady(true));
  }, []);

  // Handle file upload
  const handleFileSelected = useCallback(
    async (file: File, data: Uint8Array) => {
      setError(null);
      setIsProcessing(true);

      try {
        // Debug 3MF files
        if (file.name.toLowerCase().endsWith(".3mf")) {
          const debugInfo = await debug3mf(data);
          console.log("3MF Debug Info:", debugInfo);
        }

        const mesh = await processFile(data, file.name);
        const meshAnalysis = await analyzeMesh(data, file.name);

        setFileName(file.name);
        setFileData(data);
        setOriginalMesh(mesh);
        setAnalysis(meshAnalysis);
        setCutHeight(meshAnalysis.suggestedCutHeight);
        setGridX(meshAnalysis.gridX);
        setGridY(meshAnalysis.gridY);
        setPreviewMesh(null);
        setSelectedMount(null);
        setStep("configure");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to process file");
      } finally {
        setIsProcessing(false);
      }
    },
    []
  );

  // Handle mount selection - auto-generate preview
  const handleMountSelect = useCallback(async (mount: MountPreset) => {
    setSelectedMount(mount);
    setCustomMount(null);
    
    // Auto-generate preview when mount is selected
    if (!fileData || !fileName) return;
    
    setIsProcessing(true);
    setError(null);
    
    try {
      const result = await swapMountGenerated(
        fileData,
        fileName,
        mount.style,
        cutHeight,
        gridX,
        gridY
      );
      setPreviewMesh(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate preview");
    } finally {
      setIsProcessing(false);
    }
  }, [fileData, fileName, cutHeight, gridX, gridY]);

  // Handle custom mount upload
  const handleCustomMountLoad = useCallback(async (mount: CustomMount) => {
    setCustomMount(mount);
    setSelectedMount(null);
    
    if (!fileData || !fileName) return;
    
    setIsProcessing(true);
    setError(null);
    
    try {
      const result = await swapMountFromTriangles(
        fileData,
        fileName,
        mount.meshData,
        cutHeight,
        gridX,
        gridY
      );
      setPreviewMesh(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate preview");
    } finally {
      setIsProcessing(false);
    }
  }, [fileData, fileName, cutHeight, gridX, gridY]);

  // Regenerate preview when cut height or grid changes (if mount is selected)
  useEffect(() => {
    if ((!selectedMount && !customMount) || !fileData || !fileName) return;
    
    const regenerate = async () => {
      setIsProcessing(true);
      try {
        let result: ProcessedMesh;
        if (selectedMount) {
          result = await swapMountGenerated(
            fileData,
            fileName,
            selectedMount.style,
            cutHeight,
            gridX,
            gridY
          );
        } else if (customMount) {
          result = await swapMountFromTriangles(
            fileData,
            fileName,
            customMount.meshData,
            cutHeight,
            gridX,
            gridY
          );
        } else {
          return;
        }
        setPreviewMesh(result);
      } catch (e) {
        console.error("Failed to regenerate preview:", e);
      } finally {
        setIsProcessing(false);
      }
    };
    
    // Debounce regeneration
    const timeout = setTimeout(regenerate, 300);
    return () => clearTimeout(timeout);
  }, [selectedMount, customMount, fileData, fileName, cutHeight, gridX, gridY]);

  // Generate preview - now just navigates to preview step since preview is auto-generated
  const handleGeneratePreview = useCallback(() => {
    if (!previewMesh) return;
    setStep("preview");
  }, [previewMesh]);

  // Export STL
  const handleExport = useCallback(async () => {
    if (!previewMesh) return;

    try {
      const { exportStl } = await import("@/lib/wasm-api");
      const stlData = await exportStl(previewMesh);

      const blob = new Blob([new Uint8Array(stlData)], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName
        ? fileName.replace(/\.[^.]+$/, "_remounted.stl")
        : "remounted.stl";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to export STL");
    }
  }, [previewMesh, fileName]);

  // Reset workflow
  const handleReset = useCallback(() => {
    setFileName(null);
    setFileData(null);
    setOriginalMesh(null);
    setAnalysis(null);
    setPreviewMesh(null);
    setSelectedMount(null);
    setCustomMount(null);
    setCutHeight(5);
    setGridX(1);
    setGridY(1);
    setStep("upload");
    setError(null);
  }, []);

  if (!wasmReady) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Gridfinity Mount Swapper</h1>
            <p className="text-sm text-slate-400">
              Swap the base mount on any gridfinity-compatible 3D model
            </p>
          </div>
          {fileName && (
            <Button variant="outline" onClick={handleReset}>
              Start Over
            </Button>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto p-6">
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left panel - 3D Viewer */}
          <Card className="border-slate-800 bg-slate-900/50 lg:row-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                3D Preview
                {(previewMesh || originalMesh) && (
                  <Badge variant="secondary">
                    {(step === "configure" && previewMesh ? previewMesh : originalMesh)?.triangleCount.toLocaleString()} triangles
                  </Badge>
                )}
                {step === "configure" && previewMesh && (
                  <Badge variant="default" className="bg-green-600">
                    Live Preview
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="aspect-square w-full">
                <MeshViewer
                  originalMesh={step === "configure" && previewMesh ? null : originalMesh}
                  previewMesh={step === "configure" ? previewMesh : (step === "preview" ? previewMesh : null)}
                  cutPlaneZ={cutHeight}
                  showCutPlane={step === "configure" && !previewMesh}
                  showOriginal={step === "configure" && !previewMesh}
                  showPreview={step === "preview" || (step === "configure" && !!previewMesh)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Right panel - Workflow */}
          <Card className="border-slate-800 bg-slate-900/50">
            <CardContent className="p-6">
              <Tabs value={step} className="space-y-6">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="upload" disabled={isProcessing} onClick={() => !isProcessing && setStep("upload")}>
                    1. Upload
                  </TabsTrigger>
                  <TabsTrigger
                    value="configure"
                    disabled={!originalMesh || isProcessing}
                    onClick={() => originalMesh && !isProcessing && setStep("configure")}
                  >
                    2. Configure
                  </TabsTrigger>
                  <TabsTrigger
                    value="preview"
                    disabled={!previewMesh || isProcessing}
                    onClick={() => previewMesh && !isProcessing && setStep("preview")}
                  >
                    3. Export
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="upload" className="space-y-4">
                  <FileUpload
                    onFileSelected={handleFileSelected}
                    disabled={isProcessing}
                  />
                </TabsContent>

                <TabsContent value="configure" className="space-y-6">
                  {analysis && (
                    <>
                      <div className="grid grid-cols-3 gap-4 text-center">
                        <div className="p-3 bg-slate-800 rounded-lg">
                          <div className="text-2xl font-bold">
                            {analysis.width.toFixed(0)}
                          </div>
                          <div className="text-xs text-slate-400">
                            Width (mm)
                          </div>
                        </div>
                        <div className="p-3 bg-slate-800 rounded-lg">
                          <div className="text-2xl font-bold">
                            {analysis.depth.toFixed(0)}
                          </div>
                          <div className="text-xs text-slate-400">
                            Depth (mm)
                          </div>
                        </div>
                        <div className="p-3 bg-slate-800 rounded-lg">
                          <div className="text-2xl font-bold">
                            {analysis.height.toFixed(0)}
                          </div>
                          <div className="text-xs text-slate-400">
                            Height (mm)
                          </div>
                        </div>
                      </div>

                      <Separator className="bg-slate-700" />

                      <CutPlaneControl
                        cutHeight={cutHeight}
                        minZ={analysis.minZ}
                        maxZ={analysis.maxZ}
                        suggestedHeight={analysis.suggestedCutHeight}
                        gridX={gridX}
                        gridY={gridY}
                        onChange={setCutHeight}
                        onGridChange={(x, y) => {
                          setGridX(x);
                          setGridY(y);
                        }}
                        disabled={isProcessing}
                      />

                      <Separator className="bg-slate-700" />

                      <div>
                        <h3 className="text-sm font-medium mb-3">
                          Select Replacement Mount
                        </h3>
                        <MountSelector
                          selectedMount={selectedMount}
                          customMount={customMount}
                          onSelect={handleMountSelect}
                          onCustomMountLoad={handleCustomMountLoad}
                          disabled={isProcessing}
                        />
                      </div>

                      <div className="flex gap-3">
                        <Button
                          variant="outline"
                          onClick={() => setStep("upload")}
                          disabled={isProcessing}
                        >
                          Back
                        </Button>
                        <Button
                          className="flex-1"
                          size="lg"
                          onClick={handleGeneratePreview}
                          disabled={!previewMesh || isProcessing}
                        >
                          {isProcessing ? "Generating..." : "Continue to Export"}
                        </Button>
                      </div>
                    </>
                  )}
                </TabsContent>

                <TabsContent value="preview" className="space-y-6">
                  <div className="text-center space-y-4">
                    <div className="w-16 h-16 mx-auto rounded-full bg-green-500/20 flex items-center justify-center">
                      <svg
                        className="w-8 h-8 text-green-500"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-lg font-medium">
                        Mount Swap Complete!
                      </h3>
                      <p className="text-sm text-slate-400 mt-1">
                        Your model is ready to download with the new{" "}
                        {selectedMount?.name ?? customMount?.name ?? "custom"} base.
                      </p>
                    </div>
                  </div>

                  {previewMesh && (
                    <div className="grid grid-cols-2 gap-4 text-center">
                      <div className="p-3 bg-slate-800 rounded-lg">
                        <div className="text-xl font-bold">
                          {previewMesh.triangleCount.toLocaleString()}
                        </div>
                        <div className="text-xs text-slate-400">Triangles</div>
                      </div>
                      <div className="p-3 bg-slate-800 rounded-lg">
                        <div className="text-xl font-bold">
                          {gridX}×{gridY}
                        </div>
                        <div className="text-xs text-slate-400">Grid Size</div>
                      </div>
                    </div>
                  )}

                  <div className="space-y-3">
                    <Button
                      className="w-full"
                      size="lg"
                      onClick={handleExport}
                    >
                      Download STL
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => setStep("configure")}
                    >
                      Back to Configure
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {/* Info card */}
          <Card className="border-slate-800 bg-slate-900/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">How It Works</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-slate-400 space-y-3">
              <p>
                <strong className="text-slate-200">1. Upload</strong> your
                gridfinity-compatible STL or 3MF file.
              </p>
              <p>
                <strong className="text-slate-200">2. Adjust</strong> the cut
                plane to separate the bin from its base mount. The app
                auto-detects grid dimensions.
              </p>
              <p>
                <strong className="text-slate-200">3. Select</strong> your
                desired mount system (Original, Refined, Clickfinity, etc.)
              </p>
              <p>
                <strong className="text-slate-200">4. Download</strong> the
                remounted model, ready to print!
              </p>
              <Separator className="bg-slate-700 my-4" />
              <p className="text-xs">
                All processing happens in your browser. Your files never leave
                your device.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

