import { describe, expect, it } from "vitest";
import { configurationChecks, releaseDecision, safeReleaseIdentity, productionTrafficBlocked, ONBOARDING_STEPS } from "./local-readiness";
import { contextualHelp, manualModules, roleGuidance, onboardingGuide } from "./manual";
import { OPERATIONAL_AREAS } from "@/domain/workspace/areas";
const local = { NODE_ENV: "test", DATABASE_URL: "postgresql://localhost/rede_intelligence_test", SESSION_SECRET: "s".repeat(40), INTEGRATION_SECRET_KEY: "k".repeat(40) };
describe("9Q.2A local release contract", () => {
  it("passes local checks without asserting production", () => { expect(releaseDecision(configurationChecks(local))).toMatchObject({ localReady: true, productionReady: false }); expect(releaseDecision([]).localReady).toBe(false); });
  it.each(["SESSION_SECRET", "INTEGRATION_SECRET_KEY"])("fails closed for missing %s", key => { expect(releaseDecision(configurationChecks({ ...local, [key]: "" })).localReady).toBe(false); });
  it.each(["postgresql://remote.invalid/db", "https://localhost/db", "bad-token-value"])("refuses nonlocal or invalid database without exposure", DATABASE_URL => { const result = configurationChecks({ ...local, DATABASE_URL }); expect(result.find(row => row.code === "LOCAL_DATABASE")?.ok).toBe(false); expect(JSON.stringify(result)).not.toContain(DATABASE_URL); });
  it.each(["STORAGE_PROVIDER", "KMS_PROVIDER", "SECRET_PROVIDER", "MALWARE_SCANNER_PROVIDER"])("does not accept external %s as local evidence", key => { expect(releaseDecision(configurationChecks({ ...local, [key]: "external" })).localReady).toBe(false); });
  it("blocks production even with a claimed approval flag", () => { expect(productionTrafficBlocked({ ...local, NODE_ENV: "production", REAL_VERIFIED: "true" })).toBe(true); expect(productionTrafficBlocked(local)).toBe(false); });
  it("only publishes hash-shaped identity", () => { expect(safeReleaseIdentity({ REDE_RELEASE_SHA: "password=hidden", REDE_BUILD_ID: "https://secret.invalid" })).toEqual({ commit: null, build: null }); expect(safeReleaseIdentity({ REDE_RELEASE_SHA: "a".repeat(40), REDE_BUILD_ID: "b".repeat(64) }).commit).toHaveLength(40); });
  it("covers operational modules and safe contextual navigation", () => { for (const area of OPERATIONAL_AREAS) expect(contextualHelp(area.path)?.steps.length).toBeGreaterThan(0); expect(contextualHelp("/financeiro/obrigacao")?.path).toBe("/financeiro"); expect(contextualHelp("https://external.invalid")).toBeUndefined(); expect(new Set(manualModules.map(row => row.id)).size).toBe(manualModules.length); });
  it("documents five roles and ten onboarding steps", () => { expect(Object.keys(roleGuidance)).toHaveLength(5); expect(ONBOARDING_STEPS).toHaveLength(10); expect(onboardingGuide).toHaveLength(10); });
});
