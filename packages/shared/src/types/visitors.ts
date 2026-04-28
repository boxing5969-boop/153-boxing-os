export type VisitPurpose = "consultation" | "tour" | "trial" | "registration";
export type VisitorRequestStatus = "requested" | "approved" | "denied" | "completed";

export interface VisitorRequest {
  id: string;
  branch_id: string;
  name: string;
  phone: string;
  purpose: VisitPurpose;
  status: VisitorRequestStatus;
  approved_by: string | null;
  visit_at: string | null;
  created_at: string;
}
