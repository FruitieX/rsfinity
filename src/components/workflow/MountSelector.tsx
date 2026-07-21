"use client";

import { useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { MOUNT_PRESETS, type MountPreset } from "@/lib/mount-presets";

export interface CustomMount {
  id: string;
  name: string;
  meshData: Float32Array;
  cutHeight: number;
}

interface MountSelectorProps {
  selectedMount: MountPreset | null;
  customMount: CustomMount | null;
  onSelect: (mount: MountPreset) => void;
  onCustomMountLoad: (mount: CustomMount) => void;
  disabled?: boolean;
}

export function MountSelector({
  selectedMount,
  customMount,
  onSelect,
  onCustomMountLoad,
  disabled = false,
}: MountSelectorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCustomUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const { parseStl, parseThreeMf } = await import("@/lib/wasm-api");
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    let meshData: Float32Array;
    const ext = file.name.toLowerCase().split(".").pop();

    if (ext === "3mf") {
      meshData = parseThreeMf(bytes);
    } else {
      meshData = parseStl(bytes);
    }

    if (meshData.length === 0) {
      alert("Failed to parse mount file - no triangles found");
      return;
    }

    const custom: CustomMount = {
      id: `custom-${Date.now()}`,
      name: file.name.replace(/\.(stl|3mf)$/i, ""),
      meshData,
      cutHeight: 5.0,
    };

    onCustomMountLoad(custom);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const isCustomSelected = customMount !== null && selectedMount === null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {MOUNT_PRESETS.map((preset) => (
          <Card
            key={preset.id}
            className={cn(
              "cursor-pointer transition-all bg-slate-800",
              selectedMount?.id === preset.id
                ? "border-blue-500 bg-blue-500/10"
                : "border-slate-700 hover:border-slate-600",
              disabled && "opacity-50 cursor-not-allowed"
            )}
            onClick={() => !disabled && onSelect(preset)}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-medium text-slate-200">{preset.name}</h3>
                  <p className="text-sm text-slate-400 mt-1">
                    {preset.description}
                  </p>
                </div>
                {selectedMount?.id === preset.id && (
                  <Badge className="bg-blue-500 shrink-0">Selected</Badge>
                )}
              </div>
              <div className="mt-2">
                <Badge variant="outline" className="text-xs">
                  Cut height: {preset.defaultCutHeight}mm
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}

        {customMount && (
          <Card
            className={cn(
              "cursor-pointer transition-all bg-slate-800",
              isCustomSelected
                ? "border-purple-500 bg-purple-500/10"
                : "border-slate-700 hover:border-slate-600",
              disabled && "opacity-50 cursor-not-allowed"
            )}
            onClick={() => {
              if (!disabled && customMount) {
                onCustomMountLoad(customMount);
              }
            }}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-medium text-slate-200">
                    {customMount.name}
                  </h3>
                  <p className="text-sm text-slate-400 mt-1">Custom upload</p>
                </div>
                {isCustomSelected && (
                  <Badge className="bg-purple-500 shrink-0">Selected</Badge>
                )}
              </div>
              <div className="mt-2">
                <Badge variant="outline" className="text-xs text-purple-400">
                  {(customMount.meshData.length / 9).toLocaleString()} triangles
                </Badge>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".stl,.3mf"
          className="hidden"
          onChange={handleCustomUpload}
          disabled={disabled}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="gap-2"
        >
          <Upload className="h-4 w-4" />
          Upload Custom Mount
        </Button>
        <span className="text-xs text-slate-500">STL or 3MF</span>
      </div>
    </div>
  );
}
