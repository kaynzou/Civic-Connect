import { supabase } from "../supabaseClient";

export type ConstructionProjectType = "LOCAL_WARD" | "MAJOR_INFRASTRUCTURE";
export type ConstructionStatus = "Planned" | "Upcoming" | "Under Construction" | "Delayed" | "Completed" | "Cancelled";

export type NewConstructionProjectInput = {
  name: string;
  projectType: ConstructionProjectType;
  authorityWardId?: string;
  geometryGeoJson: any;
  startDate: string;
  estimatedEndDate: string;
  officialSla: string;
  status?: ConstructionStatus;
  description: string;
  alternativeRoute?: string;
};

export async function createConstructionProject(input: NewConstructionProjectInput) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: roleRow } = await supabase
    .from("roles")
    .select("role, ward_id")
    .eq("user_id", user.id)
    .single();

  if (!roleRow) throw new Error("Unauthorized: Role not found");

  if (input.projectType === "LOCAL_WARD") {
    if (roleRow.role === "WARD_COUNCILLOR" && roleRow.ward_id !== input.authorityWardId) {
      throw new Error("Forbidden: Ward Councilor can only create projects in their assigned ward");
    }
  }

  const { data, error } = await supabase
    .from("construction_projects")
    .insert({
      name: input.name,
      project_type: input.projectType,
      authority_id: user.id,
      authority_role: roleRow.role,
      authority_ward_id: input.authorityWardId || roleRow.ward_id,
      geometry: input.geometryGeoJson,
      start_date: input.startDate,
      estimated_end_date: input.estimatedEndDate,
      official_sla: input.officialSla,
      status: input.status || "Under Construction",
      description: input.description,
      alternative_route: input.alternativeRoute,
      visibility_scope: input.projectType === "MAJOR_INFRASTRUCTURE" ? "PUBLIC_CITY" : "WARD",
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getActiveConstructionProjects(userWardId?: string) {
  let query = supabase
    .from("construction_projects")
    .select("*")
    .neq("status", "Completed")
    .order("created_at", { ascending: false });

  const { data, error } = await query;
  if (error) throw error;
  return data;
}
