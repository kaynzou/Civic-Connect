import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ImageBackground, ActivityIndicator } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { supabase } from "@backend/supabaseClient";
import { useAppTheme } from "../context/ThemeContext";
import { GlassCard } from "../components/GlassCard";

export default function LoginScreen() {
  const { theme } = useAppTheme();
  const navigation = useNavigation<any>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleLogin() {
    setLoading(true);
    setErrorMsg(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    navigation.reset({ index: 0, routes: [{ name: "CitizenTabs" }] });
  }

  async function handleGoogleLogin() {
    // Supabase OAuth requires a redirect scheme configured in app.json
    // ("scheme": "civicconnect") and matching provider config in the
    // Supabase dashboard — see https://supabase.com/docs/guides/auth/social-login/auth-google
    await supabase.auth.signInWithOAuth({ provider: "google" });
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg1, justifyContent: "center", padding: 20 }}>
      <View style={{ alignItems: "center", marginBottom: 28 }}>
        <Text style={{ fontSize: 40, marginBottom: 10 }}>🏛️</Text>
        <Text style={{ fontSize: 22, fontWeight: "800", color: theme.text }}>Welcome to CivicConnect</Text>
        <Text style={{ fontSize: 13, color: theme.text2, marginTop: 4 }}>
          Sign in to report and track civic issues
        </Text>
      </View>

      <GlassCard>
        <TouchableOpacity
          onPress={handleGoogleLogin}
          style={{
            backgroundColor: theme.chip, borderWidth: 1, borderColor: theme.border,
            borderRadius: 16, padding: 15, alignItems: "center", marginBottom: 16,
          }}
        >
          <Text style={{ color: theme.text, fontWeight: "700" }}>🔵 Continue with Google</Text>
        </TouchableOpacity>

        <TextInput
          placeholder="Email"
          placeholderTextColor={theme.text3}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          style={{
            backgroundColor: theme.chip, borderWidth: 1, borderColor: theme.border,
            borderRadius: 14, padding: 13, color: theme.text, marginBottom: 12,
          }}
        />
        <TextInput
          placeholder="Password"
          placeholderTextColor={theme.text3}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          style={{
            backgroundColor: theme.chip, borderWidth: 1, borderColor: theme.border,
            borderRadius: 14, padding: 13, color: theme.text, marginBottom: 16,
          }}
        />

        {errorMsg ? <Text style={{ color: theme.danger, fontSize: 12.5, marginBottom: 10 }}>{errorMsg}</Text> : null}

        <TouchableOpacity
          onPress={handleLogin}
          disabled={loading || !email || !password}
          style={{ backgroundColor: theme.accent, borderRadius: 16, padding: 15, alignItems: "center", opacity: loading ? 0.7 : 1 }}
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "800" }}>Log In</Text>}
        </TouchableOpacity>
      </GlassCard>
    </View>
  );
}
