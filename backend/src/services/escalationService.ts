import { supabase } from "../supabaseClient";

/**
 * Escalation records are written exclusively by run_escalation_check()
 * (functions/escalation.sql), running on a schedule under the service role.
 * The client never writes to complaint_escalations — this module is
 * read-only by design, matching the "immutable audit trail" requirement.
 */
export async function getEscalationHistory(complaintId: string) {
  const { data, error } = await supabase
    .from("complaint_escalations")
    .select("*")
    .eq("complaint_id", complaintId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function getEscalatedComplaintsForRole() {
  // RLS on `complaints` already scopes rows to the caller's jurisdiction;
  // this just adds the escalated filter.
  const { data, error } = await supabase
    .from("complaints")
    .select("*")
    .eq("status", "ESCALATED")
    .order("escalated_at", { ascending: false });
  if (error) throw error;
  return data;
}
