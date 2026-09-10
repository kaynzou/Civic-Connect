/**
 * Seeds demo/development accounts through Supabase Auth admin API.
 * Credentials come from environment variables — never hardcoded here.
 * Run with: `npx ts-node seed/002_seed_users.ts` (dev/staging only).
 */
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!; // server-side only, never shipped to the app
const admin = createClient(supabaseUrl, serviceRoleKey);

const WARD_42 = "00000000-0000-0000-0000-000000000050";

type SeedAccount = {
  email: string;
  password: string;
  role:
    | "CITIZEN"
    | "WARD_COUNCILLOR"
    | "VILLAGE_HEAD"
    | "TEHSILDAR_SDM"
    | "DM_COLLECTOR"
    | "CM"
    | "PM_CENTRAL_ADMIN";
  fullName: string;
};

// Pull demo credentials from env (see .env.example) — fall back to
// generated random passwords if not provided, and print them once so they
// are never committed to source.
function demoAccounts(): SeedAccount[] {
  const pw = (key: string) => process.env[key] || cryptoRandom();
  return [
    { email: "citizen.demo@civicconnect.dev", password: pw("DEMO_CITIZEN_PASSWORD"), role: "CITIZEN", fullName: "Demo Citizen" },
    { email: "ward.demo@civicconnect.dev", password: pw("DEMO_WARD_PASSWORD"), role: "WARD_COUNCILLOR", fullName: "Demo Ward Councillor" },
    { email: "village.demo@civicconnect.dev", password: pw("DEMO_VILLAGE_PASSWORD"), role: "VILLAGE_HEAD", fullName: "Demo Village Head" },
    { email: "sdm.demo@civicconnect.dev", password: pw("DEMO_SDM_PASSWORD"), role: "TEHSILDAR_SDM", fullName: "Demo SDM" },
    { email: "dm.demo@civicconnect.dev", password: pw("DEMO_DM_PASSWORD"), role: "DM_COLLECTOR", fullName: "Demo DM" },
    { email: "cm.demo@civicconnect.dev", password: pw("DEMO_CM_PASSWORD"), role: "CM", fullName: "Demo CM Office" },
    { email: "pm.demo@civicconnect.dev", password: pw("DEMO_PM_PASSWORD"), role: "PM_CENTRAL_ADMIN", fullName: "Demo Central Admin" },
  ];
}

function cryptoRandom() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function main() {
  for (const acct of demoAccounts()) {
    const { data, error } = await admin.auth.admin.createUser({
      email: acct.email,
      password: acct.password,
      email_confirm: true,
    });
    if (error) {
      console.error(`Failed to create ${acct.email}:`, error.message);
      continue;
    }
    const userId = data.user!.id;

    await admin.from("user_identity").insert({
      user_id: userId,
      full_name: acct.fullName,
      username: acct.email.split("@")[0],
      email: acct.email,
    });

    await admin.from("roles").insert({
      user_id: userId,
      role: acct.role,
      ward_id: acct.role === "WARD_COUNCILLOR" ? WARD_42 : null,
      is_government_issued: acct.role !== "CITIZEN",
      issued_by: acct.role !== "CITIZEN" ? "CivicConnect Dev Seed" : null,
    });

    if (acct.role === "CITIZEN") {
      await admin.from("citizen_home_ward").insert({ user_id: userId, ward_id: WARD_42 });
    }

    console.log(`Seeded ${acct.role}: ${acct.email}`);
  }
  console.log("\nDone. These are development-only accounts — rotate or delete before any production deployment.");
}

main();
