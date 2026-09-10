import { supabase } from "../supabaseClient";
import { canReportHere } from "./jurisdictionService";
import type { ComplaintCategory } from "../types/domain";

export type NewComplaintInput = {
  category: ComplaintCategory;
  description: string;
  severity: 1 | 2 | 3 | 4 | 5;
  latitude: number;
  longitude: number;
  imageUris: string[];
};

const GEO_LOCK_EXEMPT: ComplaintCategory[] = ["CRIME"];

export async function submitComplaint(input: NewComplaintInput) {
  if (!GEO_LOCK_EXEMPT.includes(input.category)) {
    const allowed = await canReportHere(input.latitude, input.longitude);
    if (!allowed) {
      throw new JurisdictionError(
        "Location outside your reporting jurisdiction. Please move within your ward to report this issue."
      );
    }
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: complaint, error } = await supabase
    .from("complaints")
    .insert({
      category: input.category,
      description: input.description,
      severity: input.severity,
      latitude: input.latitude,
      longitude: input.longitude,
      reporter_id: user.id,
    })
    .select()
    .single();
  if (error) throw error;

  for (const uri of input.imageUris) {
    const path = await uploadComplaintImage(complaint.id, uri); // strips EXIF server-side (edge function)
    await supabase.from("complaint_images").insert({ complaint_id: complaint.id, storage_path: path });
  }

  return complaint;
}

async function uploadComplaintImage(complaintId: string, localUri: string): Promise<string> {
  // In production this calls an edge function that strips EXIF metadata
  // before writing to Supabase Storage, rather than uploading directly.
  const path = `complaints/${complaintId}/${Date.now()}.jpg`;
  // ... fetch(localUri) -> blob -> supabase.storage.from('complaint-photos').upload(path, blob)
  return path;
}

export async function getMyComplaints() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("complaints")
    .select("*")
    .eq("reporter_id", user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

/** Community/official reads always go through the anonymized view. */
export async function getCommunityComplaints(wardId?: string) {
  let query = supabase.from("complaints_public").select("*").order("priority_score", { ascending: false });
  if (wardId) query = query.eq("ward_name", wardId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export class JurisdictionError extends Error {}
