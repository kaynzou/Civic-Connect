import { supabase } from "../supabaseClient";

/**
 * One citizen = one vote per complaint. The composite primary key
 * (complaint_id, user_id) on complaint_votes makes a duplicate insert fail
 * at the database level even if this check is bypassed client-side.
 */
export async function upvoteComplaint(complaintId: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { error } = await supabase.from("complaint_votes").insert({ complaint_id: complaintId, user_id: user.id });
  if (error && error.code === "23505") throw new Error("You've already upvoted this complaint.");
  if (error) throw error;
  // upvote_count and priority_score are recomputed by trg_recompute_priority_on_vote
}

export async function removeUpvote(complaintId: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { error } = await supabase
    .from("complaint_votes")
    .delete()
    .eq("complaint_id", complaintId)
    .eq("user_id", user.id);
  if (error) throw error;
}

export async function hasVoted(complaintId: string): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from("complaint_votes")
    .select("complaint_id")
    .eq("complaint_id", complaintId)
    .eq("user_id", user.id)
    .maybeSingle();
  return !!data;
}
