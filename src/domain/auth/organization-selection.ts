export interface LoginMembershipOption {
  organizationId: string;
  organization: { name: string };
}

export type LoginOrganizationDecision =
  | { kind: "REJECTED" }
  | { kind: "SELECTION_REQUIRED"; organizations: Array<{ id: string; name: string }> }
  | { kind: "SELECTED"; membership: LoginMembershipOption };

export function decideLoginOrganization(
  memberships: LoginMembershipOption[],
  requestedOrganizationId: string,
): LoginOrganizationDecision {
  if (memberships.length === 0) return { kind: "REJECTED" };
  if (!requestedOrganizationId && memberships.length > 1) {
    return {
      kind: "SELECTION_REQUIRED",
      organizations: memberships.map((membership) => ({ id: membership.organizationId, name: membership.organization.name })),
    };
  }
  const selected = requestedOrganizationId
    ? memberships.find((membership) => membership.organizationId === requestedOrganizationId)
    : memberships[0];
  return selected ? { kind: "SELECTED", membership: selected } : { kind: "REJECTED" };
}
