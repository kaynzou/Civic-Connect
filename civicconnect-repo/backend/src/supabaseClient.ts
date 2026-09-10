import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";

// Never hardcode keys. EXPO_PUBLIC_SUPABASE_ANON_KEY is safe to ship (it's
// the anon/public key protected by RLS) — the service_role key must NEVER
// appear in app code; it's used only in seed/002_seed_users.ts and the
// scheduled escalation function, both of which run outside the client app.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// Secure, encrypted session storage on-device instead of AsyncStorage.
const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: ExpoSecureStoreAdapter as any,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
