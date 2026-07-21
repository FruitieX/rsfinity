"use client";

import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface CutPlaneControlProps {
  cutHeight: number;
  minZ: number;
  maxZ: number;
  suggestedHeight: number;
  gridX: number;
  gridY: number;
  onChange: (height: number) => void;
  onGridChange: (x: number, y: number) => void;
  disabled?: boolean;
}

export function CutPlaneControl({
  cutHeight,
  minZ,
  maxZ,
  suggestedHeight,
  gridX,
  gridY,
  onChange,
  onGridChange,
  disabled = false,
}: CutPlaneControlProps) {
  const range = maxZ - minZ;

  return (
    <Card className="border-slate-700 bg-slate-800">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center justify-between">
          Cut Plane Settings
          <Button
            variant="outline"
            size="sm"
            onClick={() => onChange(suggestedHeight)}
            disabled={disabled}
          >
            Auto-detect
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <label className="text-sm text-slate-400 mb-2 block">
            Cut Height (Z)
          </label>
          <Slider
            value={[cutHeight]}
            min={minZ}
            max={Math.min(minZ + range * 0.5, maxZ)}
            step={0.1}
            onValueChange={([value]) => onChange(value)}
            disabled={disabled}
            className="my-4"
          />
          <div className="flex justify-between text-xs text-slate-500">
            <span>{minZ.toFixed(1)}mm</span>
            <Badge variant="secondary">{cutHeight.toFixed(2)}mm</Badge>
            <span>{maxZ.toFixed(1)}mm</span>
          </div>
        </div>

        <div>
          <label className="text-sm text-slate-400 mb-2 block">
            Grid Dimensions (detected)
          </label>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500">X:</label>
              <input
                type="number"
                min={1}
                max={10}
                value={gridX}
                onChange={(e) =>
                  onGridChange(parseInt(e.target.value) || 1, gridY)
                }
                disabled={disabled}
                className="w-16 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm text-slate-200"
              />
            </div>
            <span className="text-slate-500">×</span>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500">Y:</label>
              <input
                type="number"
                min={1}
                max={10}
                value={gridY}
                onChange={(e) =>
                  onGridChange(gridX, parseInt(e.target.value) || 1)
                }
                disabled={disabled}
                className="w-16 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm text-slate-200"
              />
            </div>
            <Badge variant="outline">
              {gridX}×{gridY} unit{gridX * gridY > 1 ? "s" : ""}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
