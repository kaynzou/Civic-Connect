import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";

import LoginScreen from "../screens/LoginScreen";
import HomeScreen from "../screens/HomeScreen";
// Additional screens follow the same pattern as HomeScreen/LoginScreen —
// see backend/README.md's screen list (section 29 of the original spec)
// for the full set to build out: SignupScreen, CategoryScreen,
// RaiseComplaintScreen, ComplaintDetailsScreen, CommunityScreen,
// CommentsScreen, NotificationsScreen, ProfileScreen, GovLoginScreen,
// GovDashboardScreen, GovDetailScreen, EscalatedScreen, PrivacyScreen.
// Each one is a thin UI layer over a function already implemented in
// backend/src/services/ — see complaintService.ts, votingService.ts, etc.

export type RootStackParamList = {
  Login: undefined;
  GovLogin: undefined;
  CitizenTabs: undefined;
  GovDashboard: undefined;
  ComplaintDetails: { complaintId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator();

function CitizenTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Home" component={HomeScreen} />
      {/* <Tab.Screen name="Community" component={CommunityScreen} /> */}
      {/* <Tab.Screen name="Notifications" component={NotificationsScreen} /> */}
      {/* <Tab.Screen name="Profile" component={ProfileScreen} /> */}
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="CitizenTabs" component={CitizenTabs} />
        {/* <Stack.Screen name="GovLogin" component={GovLoginScreen} /> */}
        {/* <Stack.Screen name="GovDashboard" component={GovDashboardScreen} /> */}
        {/* <Stack.Screen name="ComplaintDetails" component={ComplaintDetailsScreen} /> */}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
