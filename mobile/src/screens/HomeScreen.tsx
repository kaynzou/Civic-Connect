import React, { useCallback, useEffect, useState } from "react";
import { View, Text, FlatList, RefreshControl, ActivityIndicator } from "react-native";
import { getMyComplaints } from "@backend/services/complaintService";
import { useAppTheme } from "../context/ThemeContext";
import { GlassCard } from "../components/GlassCard";
import type { Complaint } from "@backend/types/domain";

export default function HomeScreen() {
  const { theme } = useAppTheme();
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getMyComplaints();
      setComplaints(data as unknown as Complaint[]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg1, paddingTop: 60, paddingHorizontal: 20 }}>
      <Text style={{ fontSize: 20, fontWeight: "800", color: theme.text, marginBottom: 2 }}>Welcome back!</Text>
      <Text style={{ fontSize: 13.5, color: theme.text2, marginBottom: 16 }}>
        Here are the concerns you've raised.
      </Text>

      <FlatList
        data={complaints}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        ListEmptyComponent={
          <GlassCard>
            <Text style={{ fontWeight: "800", color: theme.text, textAlign: "center" }}>No complaints yet.</Text>
            <Text style={{ color: theme.text2, fontSize: 13, textAlign: "center", marginTop: 6 }}>
              Your first report could help improve your community.
            </Text>
          </GlassCard>
        }
        renderItem={({ item }) => (
          <GlassCard tight style={{ marginBottom: 10 }}>
            <Text style={{ fontWeight: "700", color: theme.text, fontSize: 14.5 }}>{item.description.slice(0, 60)}</Text>
            <Text style={{ color: theme.text3, fontSize: 12, marginTop: 4 }}>
              #{item.displayId} · {item.status}
            </Text>
          </GlassCard>
        )}
      />
    </View>
  );
}
