import React from "react";
import { View, StyleSheet, ViewProps } from "react-native";
import { BlurView } from "expo-blur";
import { useAppTheme } from "../context/ThemeContext";
import { radius } from "../theme/colors";

type Props = ViewProps & { tight?: boolean; radiusSize?: keyof typeof radius };

/**
 * The liquid-glass building block used everywhere in the app — mirrors
 * .glass-card in the HTML prototype: a blurred, saturated backdrop, a
 * translucent tinted surface on top, and a 1px rim-light border to sell the
 * "thickness" of glass. BlurView gives the real native blur; the tinted
 * View + rim border reproduce the sheen/rim treatment CSS did with
 * backdrop-filter + inset box-shadow.
 */
export function GlassCard({ tight, radiusSize = "lg", style, children, ...rest }: Props) {
  const { theme } = useAppTheme();
  const r = radius[radiusSize];
  return (
    <View style={[{ borderRadius: r, overflow: "hidden" }, style]} {...rest}>
      <BlurView intensity={40} tint={theme.mode} style={StyleSheet.absoluteFill} />
      <View
        style={{
          backgroundColor: theme.glass,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: r,
          padding: tight ? 14 : 18,
          shadowColor: "#141537",
          shadowOpacity: theme.mode === "dark" ? 0.5 : 0.16,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 10 },
          elevation: 6,
        }}
      >
        {children}
      </View>
    </View>
  );
}
