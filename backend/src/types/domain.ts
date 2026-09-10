export type ComplaintCategory =
  | "CRIME" | "COMMUNITY" | "INFRASTRUCTURE" | "ENVIRONMENT" | "WATER"
  | "ELECTRICITY" | "ROADS" | "STREET_LIGHTS" | "SANITATION" | "GARBAGE"
  | "DRAINAGE" | "PUBLIC_SAFETY" | "TRAFFIC" | "OTHER";

export type ComplaintStatus =
  | "PENDING" | "VERIFIED" | "ASSIGNED" | "IN_PROGRESS" | "RESOLVED" | "REJECTED" | "ESCALATED";

export type VerificationStatus = "UNVERIFIED" | "VERIFYING" | "VERIFIED" | "REJECTED";

export type AppRole =
  | "CITIZEN" | "WARD_COUNCILLOR" | "VILLAGE_HEAD" | "TEHSILDAR_SDM"
  | "DM_COLLECTOR" | "CM" | "PM_CENTRAL_ADMIN" | "AUDIT_ADMIN";

export interface Complaint {
  id: string;
  displayId: string;
  category: ComplaintCategory;
  description: string;
  severity: 1 | 2 | 3 | 4 | 5;
  approximateLocation: string;
  wardName: string;
  districtName: string;
  stateName: string;
  reporterDisplayName: "Anonymous Citizen"; // always this literal to client code
  status: ComplaintStatus;
  verificationStatus: VerificationStatus;
  communityVerified: boolean;
  governmentVerified: boolean;
  upvoteCount: number;
  priorityScore: number;
  assignedAuthorityRole: AppRole | null;
  isCrime: boolean;
  createdAt: string;
  resolvedAt: string | null;
  escalatedAt: string | null;
}
