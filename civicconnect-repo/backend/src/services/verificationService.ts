import { supabase } from "../supabaseClient";

export type VerificationResult = "VERIFIED" | "REJECTED";

/**
 * Only an authenticated government official whose role+jurisdiction matches
 * the complaint can call this (enforced by complaints_official_update RLS
 * policy). Community verification (citizen corroboration via comments/votes)
 * is tracked separately in complaints.community_verified.
 */
export async function officialVerify(complaintId: string, result: VerificationResult, note?: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: roleRow } = await supabase.from("roles").select("role").eq("user_id", user.id).single();
  if (!roleRow || roleRow.role === "CITIZEN") throw new Error("Only government officials can verify complaints.");

  await supabase.from("complaint_verifications").insert({
    complaint_id: complaintId, verified_by: user.id, verifier_role: roleRow.role, result, note,
  });

  await supabase
    .from("complaints")
    .update({
      verification_status: result,
      government_verified: result === "VERIFIED",
      status: result === "VERIFIED" ? "VERIFIED" : "REJECTED",
    })
    .eq("id", complaintId);

  await notifyReporterOfVerification(complaintId, result);
}

async function notifyReporterOfVerification(complaintId: string, result: VerificationResult) {
  const { data: complaint } = await supabase.from("complaints").select("reporter_id, display_id").eq("id", complaintId).single();
  if (!complaint) return;
  const message = result === "VERIFIED"
    ? `Your complaint #${complaint.display_id} has been verified.`
    : `Your complaint #${complaint.display_id} was not verified. You can add more information and resubmit.`;
  await supabase.from("notifications").insert({ user_id: complaint.reporter_id, complaint_id: complaintId, message });
}

export async function markCommunityVerified(complaintId: string) {
  // Called once a configurable number of distinct citizens corroborate an
  // issue (e.g. via upvotes + comments) — kept separate from official
  // verification so the UI can show both signals independently.
  await supabase.from("complaints").update({ community_verified: true }).eq("id", complaintId);
}
