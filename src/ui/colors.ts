import { useEffect, useState } from "react";

const DARK = {
  body: "#9db0c6",
  base: "#f5a524",
  ghost: "#f87171",
  cap: "#4a5566",
  grid: "#1f242c",
  gridSection: "#343b47",
  plane: "#f5a524",
};

const LIGHT = {
  body: "#8ea3bd",
  base: "#f0a020",
  ghost: "#e05252",
  cap: "#5b6779",
  grid: "#d5dae1",
  gridSection: "#b4bcc8",
  plane: "#e38f06",
};

/** Scene colours, following the system light/dark preference. */
export function useColors() {
  const query = "(prefers-color-scheme: light)";
  const [light, setLight] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setLight(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return light ? LIGHT : DARK;
}
