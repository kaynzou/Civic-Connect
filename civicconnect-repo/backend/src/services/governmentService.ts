import { supabase } from "../supabaseClient";

export type SortMode = "priority" | "upvoted" | "oldest" | "severity" | "recent" | "escalated" | "unverified";

/**
 * RLS already restricts which rows come back for the caller's role +
 * jurisdiction (see complaints_ward_councillor_select, etc. in
 * migrations/002_rls_policies.sql) — this service just adds sorting/filtering
 * on top of whatever the database already scoped correctly. It must NOT
 * attempt to filter by jurisdiction itself; that would imply the client is
 * trusted to self-scope, which it never is.
 */
export async function getDashboardComplaints(sort: SortMode) {
  let query = supabase.from("complaints").select("*");
  switch (sort) {
    case "priority": query = query.order("priority_score", { ascending: false }); break;
    case "upvoted": query = query.order("upvote_count", { ascending: false }); break;
    case "oldest": query = query.order("created_at", { ascending: true }); break;
    case "severity": query = query.order("severity", { ascending: false }); break;
    case "recent": query = query.order("created_at", { ascending: false }); break;
    case "escalated": query = query.eq("status", "ESCALATED"); break;
    case "unverified": query = query.eq("verification_status", "UNVERIFIED"); break;
  }
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function updateComplaintStatus(complaintId: string, status: string, note?: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: roleRow } = await supabase.from("roles").select("role").eq("user_id", user.id).single();

  const { data: previous } = await supabase.from("complaints").select("status").eq("id", complaintId).single();

  const { error } = await supabase
    .from("complaints")
    .update({ status, resolved_at: status === "RESOLVED" ? new Date().toISOString() : null })
    .eq("id", complaintId);
  if (error) throw error; // fails closed if RLS denies the jurisdiction match

  await supabase.from("complaint_status_history").insert({
    complaint_id: complaintId, previous_status: previous?.status, new_status: status,
    changed_by: user.id, changed_by_role: roleRow?.role, note,
  });

  const { data: complaint } = await supabase.from("complaints").select("reporter_id, display_id").eq("id", complaintId).single();
  if (complaint) {
    await supabase.from("notifications").insert({
      user_id: complaint.reporter_id, complaint_id: complaintId,
      message: `Your complaint #${complaint.display_id} status changed to "${status}".`,
    });
  }
}

export async function getDashboardKpis() {
  const { data, error } = await supabase.from("complaints").select("status, priority_score");
  if (error) throw error;
  return {
    total: data.length,
    pending: data.filter(c => c.status === "PENDING").length,
    inProgress: data.filter(c => c.status === "IN_PROGRESS").length,
    resolved: data.filter(c => c.status === "RESOLVED").length,
    escalated: data.filter(c => c.status === "ESCALATED").length,
    highPriority: data.filter(c => c.priority_score >= 110).length,
  };
}
