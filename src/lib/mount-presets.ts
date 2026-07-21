export interface MountPreset {
  id: string;
  name: string;
  description: string;
  defaultCutHeight: number;
  previewImage?: string;
  style: string; // Used for WASM mount generation
}

export const MOUNT_PRESETS: MountPreset[] = [
  {
    id: "gridfinity-original",
    name: "Gridfinity Original",
    description: "Standard Gridfinity base with magnet holes and screw mounts",
    defaultCutHeight: 4.75,
    style: "original",
  },
  {
    id: "gridfinity-refined",
    name: "Gridfinity Refined",
    description: "Improved tolerances and snap-fit design by Zack Freedman",
    defaultCutHeight: 4.5,
    style: "refined",
  },
  {
    id: "gridfinity-lite",
    name: "Gridfinity Lite",
    description: "Minimal baseplate interface, no magnets, faster to print",
    defaultCutHeight: 2.6,
    style: "lite",
  },
  {
    id: "clickfinity",
    name: "Clickfinity",
    description: "Click-lock mechanism for tool-free removal",
    defaultCutHeight: 5.0,
    style: "clickfinity",
  },
];
