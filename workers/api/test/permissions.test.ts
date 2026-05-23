/**
 * 권한 결정 헬퍼 단위 테스트.
 * CLAUDE.md 시나리오 9, 10 (코치 RLS, 가맹점주 RLS) 를 함수 레벨에서 검증.
 */
import { describe, it, expect } from "vitest";
import {
  canAccessBranch,
  canAccessMember,
  canRemoteOpenDoor,
  canIssueEmergencyPin,
  isHqRole,
  isBranchAdminRole,
  isStaffRole,
  type CallerProfile,
} from "../src/lib/permissions";

const hqAdmin: CallerProfile = { id: "u-hq", role: "hq_admin", branch_id: null };
const superAdmin: CallerProfile = { id: "u-sa", role: "super_admin", branch_id: null };
const ownerB1: CallerProfile = { id: "u-ow1", role: "branch_owner", branch_id: "b1" };
const managerB1: CallerProfile = { id: "u-mg1", role: "branch_manager", branch_id: "b1" };
const coachB1: CallerProfile = { id: "u-c1", role: "coach", branch_id: "b1" };
const memberUser: CallerProfile = { id: "u-m", role: "member", branch_id: "b1" };

describe("role classifier", () => {
  it("isHqRole", () => {
    expect(isHqRole("super_admin")).toBe(true);
    expect(isHqRole("hq_admin")).toBe(true);
    expect(isHqRole("branch_owner")).toBe(false);
    expect(isHqRole("coach")).toBe(false);
  });

  it("isBranchAdminRole", () => {
    expect(isBranchAdminRole("branch_owner")).toBe(true);
    expect(isBranchAdminRole("branch_manager")).toBe(true);
    expect(isBranchAdminRole("hq_admin")).toBe(false);
    expect(isBranchAdminRole("coach")).toBe(false);
  });

  it("isStaffRole 는 회원 제외", () => {
    expect(isStaffRole("coach")).toBe(true);
    expect(isStaffRole("hq_admin")).toBe(true);
    expect(isStaffRole("branch_owner")).toBe(true);
    expect(isStaffRole("member")).toBe(false);
  });
});

describe("canAccessBranch", () => {
  it("HQ 는 모든 지점 접근", () => {
    expect(canAccessBranch(hqAdmin, "b1")).toBe(true);
    expect(canAccessBranch(hqAdmin, "b2")).toBe(true);
    expect(canAccessBranch(superAdmin, "b99")).toBe(true);
  });

  it("가맹점주는 자기 지점만 (시나리오 10)", () => {
    expect(canAccessBranch(ownerB1, "b1")).toBe(true);
    expect(canAccessBranch(ownerB1, "b2")).toBe(false);
  });

  it("지점 관리자도 동일", () => {
    expect(canAccessBranch(managerB1, "b1")).toBe(true);
    expect(canAccessBranch(managerB1, "b2")).toBe(false);
  });

  it("코치는 자기 지점만", () => {
    expect(canAccessBranch(coachB1, "b1")).toBe(true);
    expect(canAccessBranch(coachB1, "b2")).toBe(false);
  });
});

describe("canAccessMember (시나리오 9: 코치는 담당 회원만)", () => {
  const memberOfB1AssignedToCoach1 = { branch_id: "b1", assigned_coach_id: "u-c1" };
  const memberOfB1AssignedToCoach2 = { branch_id: "b1", assigned_coach_id: "u-c2" };
  const memberOfB2AssignedToCoach1 = { branch_id: "b2", assigned_coach_id: "u-c1" };
  const memberOfB1Unassigned = { branch_id: "b1", assigned_coach_id: null };

  it("HQ 는 어떤 회원이든 OK", () => {
    expect(canAccessMember(hqAdmin, memberOfB1AssignedToCoach1)).toBe(true);
    expect(canAccessMember(hqAdmin, memberOfB1Unassigned)).toBe(true);
  });

  it("가맹점주는 자기 지점 회원 전부", () => {
    expect(canAccessMember(ownerB1, memberOfB1AssignedToCoach1)).toBe(true);
    expect(canAccessMember(ownerB1, memberOfB1Unassigned)).toBe(true);
    expect(canAccessMember(ownerB1, memberOfB2AssignedToCoach1)).toBe(false);
  });

  it("코치는 본인이 담당인 회원만", () => {
    expect(canAccessMember(coachB1, memberOfB1AssignedToCoach1)).toBe(true);
    expect(canAccessMember(coachB1, memberOfB1AssignedToCoach2)).toBe(false);
    expect(canAccessMember(coachB1, memberOfB1Unassigned)).toBe(false);
  });

  it("코치는 다른 지점 회원은 접근 불가 (담당이어도)", () => {
    expect(canAccessMember(coachB1, memberOfB2AssignedToCoach1)).toBe(false);
  });

  it("회원 본인은 이 함수로 접근 못함 (별도 흐름)", () => {
    expect(canAccessMember(memberUser, memberOfB1AssignedToCoach1)).toBe(false);
  });
});

describe("canRemoteOpenDoor", () => {
  it("HQ 는 모든 단말기", () => {
    expect(canRemoteOpenDoor(hqAdmin, "b1")).toBe(true);
    expect(canRemoteOpenDoor(hqAdmin, "b2")).toBe(true);
  });

  it("가맹점주는 자기 지점 단말기만", () => {
    expect(canRemoteOpenDoor(ownerB1, "b1")).toBe(true);
    expect(canRemoteOpenDoor(ownerB1, "b2")).toBe(false);
  });

  it("코치/회원은 불가", () => {
    expect(canRemoteOpenDoor(coachB1, "b1")).toBe(false);
    expect(canRemoteOpenDoor(memberUser, "b1")).toBe(false);
  });
});

describe("canIssueEmergencyPin", () => {
  it("HQ 는 모든 지점", () => {
    expect(canIssueEmergencyPin(hqAdmin, "b1")).toBe(true);
    expect(canIssueEmergencyPin(hqAdmin, "b2")).toBe(true);
  });

  it("가맹점주는 자기 지점만", () => {
    expect(canIssueEmergencyPin(ownerB1, "b1")).toBe(true);
    expect(canIssueEmergencyPin(ownerB1, "b2")).toBe(false);
  });

  it("코치는 불가", () => {
    expect(canIssueEmergencyPin(coachB1, "b1")).toBe(false);
  });
});
