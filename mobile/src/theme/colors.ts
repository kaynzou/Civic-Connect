export const lightTheme = {
  mode: "light" as const,
  bg1: "#eef1ff", bg2: "#e3e9ff", bg3: "#dceafe",
  glass: "rgba(255,255,255,0.42)", glassHi: "rgba(255,255,255,0.68)",
  border: "rgba(255,255,255,0.75)",
  rimTop: "rgba(255,255,255,0.75)", rimBottom: "rgba(35,42,90,0.06)",
  text: "#1c2036", text2: "#5c6280", text3: "#8a90ab",
  accent: "#5a4fe0", accent2: "#3f7bf0",
  success: "#12a454", warn: "#e08a1e", danger: "#e0435a", info: "#3f7bf0",
  chip: "rgba(255,255,255,0.38)",
};

export const darkTheme = {
  mode: "dark" as const,
  bg1: "#05060d", bg2: "#0a0d1c", bg3: "#0e1330",
  glass: "rgba(22,26,48,0.42)", glassHi: "rgba(28,32,58,0.68)",
  border: "rgba(255,255,255,0.13)",
  rimTop: "rgba(255,255,255,0.14)", rimBottom: "rgba(0,0,0,0.4)",
  text: "#eef0fb", text2: "#a7adce", text3: "#767ca0",
  accent: "#8b83ff", accent2: "#5b9dff",
  success: "#2fd47e", warn: "#f5a742", danger: "#ff6b7f", info: "#5b9dff",
  chip: "rgba(255,255,255,0.05)",
};

export type Theme = typeof lightTheme;

// React Native has no backdrop-filter — true glass blur comes from
// `expo-blur`'s <BlurView> (uses native UIVisualEffectView / RenderScript
// blur), layered under these semi-transparent surface colors + a 1px rim
// highlight border, which reproduces the "liquid glass" look from the
// prototype on-device. See src/components/GlassCard.tsx.
export const radius = { lg: 26, md: 18, sm: 12 };
