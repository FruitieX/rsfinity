"use client";

import { useCallback, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface FileUploadProps {
  onFileSelected: (file: File, data: Uint8Array) => void;
  accept?: string;
  disabled?: boolean;
}

export function FileUpload({
  onFileSelected,
  accept = ".stl,.3mf",
  disabled = false,
}: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);

      const extension = file.name.toLowerCase().split(".").pop();
      if (!["stl", "3mf"].includes(extension || "")) {
        setError("Please upload an STL or 3MF file");
        return;
      }

      try {
        const arrayBuffer = await file.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);
        onFileSelected(file, data);
      } catch {
        setError("Failed to read file");
      }
    },
    [onFileSelected]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <Card
      className={`border-2 border-dashed transition-colors ${
        isDragging
          ? "border-blue-500 bg-blue-500/10"
          : "border-slate-600 hover:border-slate-500"
      } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
      onDrop={disabled ? undefined : handleDrop}
      onDragOver={disabled ? undefined : handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <CardContent className="p-8">
        <label
          className={`flex flex-col items-center gap-4 ${
            disabled ? "cursor-not-allowed" : "cursor-pointer"
          }`}
        >
          <div className="w-16 h-16 rounded-full bg-slate-700 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-slate-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
          </div>

          <div className="text-center">
            <p className="text-lg font-medium text-slate-200">
              Drop your 3D model here
            </p>
            <p className="text-sm text-slate-400 mt-1">
              or click to browse files
            </p>
          </div>

          <div className="flex gap-2">
            <Badge variant="secondary">.STL</Badge>
            <Badge variant="secondary">.3MF</Badge>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <input
            type="file"
            accept={accept}
            onChange={handleInputChange}
            disabled={disabled}
            className="hidden"
          />
        </label>
      </CardContent>
    </Card>
  );
}
