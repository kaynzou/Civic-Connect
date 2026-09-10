import { supabase } from "../supabaseClient";

export type WardChain = {
  country: string;
  state: string;
  district: string;
  subDistrict: string;
  village: string;
  ward: string;
  wardId: string;
};

/**
 * Resolves a GPS coordinate to its administrative chain via the
 * get_ward_from_coordinates() Postgres function (PostGIS point-in-polygon).
 * Never trust a client-computed ward — this always calls the backend.
 */
export async function getWardFromCoordinates(lat: number, lng: number): Promise<WardChain | null> {
  const { data, error } = await supabase.rpc("get_ward_from_coordinates", { p_lat: lat, p_lng: lng });
  if (error || !data?.length) return null;
  const row = data[0];
  return {
    country: row.country, state: row.state, district: row.district,
    subDistrict: row.sub_district, village: row.village, ward: row.ward, wardId: row.ward_id,
  };
}

/**
 * Geo-lock check for non-crime categories. The RESULT is advisory for UI
 * responsiveness only — the authoritative check happens again inside the
 * complaint insert RLS/trigger, so a modified client can't bypass it.
 */
export async function canReportHere(lat: number, lng: number): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabase.rpc("citizen_can_report_here", {
    p_user: user.id, p_lat: lat, p_lng: lng,
  });
  if (error) return false;
  return !!data;
}

/** Crime reports are exempt from ward-matching but still get a chain attached
 *  to the reported incident location (separate from the reporter's own GPS). */
export async function attachIncidentLocation(lat: number, lng: number): Promise<WardChain | null> {
  return getWardFromCoordinates(lat, lng);
}
