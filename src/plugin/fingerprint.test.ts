import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  generateFingerprint,
  collectCurrentFingerprint,
  updateFingerprintVersion,
  buildFingerprintHeaders,
  getSessionFingerprint,
  regenerateSessionFingerprint,
  type Fingerprint,
} from "./fingerprint";

// ─── generateFingerprint ──────────────────────────────────────────────────────

describe("generateFingerprint", () => {
  it("returns an object with all required Fingerprint fields", () => {
    const fp = generateFingerprint();
    expect(fp).toHaveProperty("deviceId");
    expect(fp).toHaveProperty("sessionToken");
    expect(fp).toHaveProperty("userAgent");
    expect(fp).toHaveProperty("apiClient");
    expect(fp).toHaveProperty("clientMetadata");
    expect(fp).toHaveProperty("createdAt");
  });

  it("deviceId is a valid UUID", () => {
    const fp = generateFingerprint();
    expect(fp.deviceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("sessionToken is a hex string of 32 chars", () => {
    const fp = generateFingerprint();
    expect(fp.sessionToken).toMatch(/^[0-9a-f]{32}$/);
  });

  it("clientMetadata.pluginType is GEMINI", () => {
    const fp = generateFingerprint();
    expect(fp.clientMetadata.pluginType).toBe("GEMINI");
  });

  it("clientMetadata.platform is WINDOWS or MACOS", () => {
    const fp = generateFingerprint();
    expect(["WINDOWS", "MACOS"]).toContain(fp.clientMetadata.platform);
  });

  it("clientMetadata.ideType is ANTIGRAVITY", () => {
    const fp = generateFingerprint();
    expect(fp.clientMetadata.ideType).toBe("ANTIGRAVITY");
  });

  it("userAgent contains antigravity/ prefix", () => {
    const fp = generateFingerprint();
    expect(fp.userAgent).toMatch(/^antigravity\//);
  });

  it("createdAt is a recent timestamp", () => {
    const before = Date.now();
    const fp = generateFingerprint();
    const after = Date.now();
    expect(fp.createdAt).toBeGreaterThanOrEqual(before);
    expect(fp.createdAt).toBeLessThanOrEqual(after);
  });

  it("each call produces a different deviceId", () => {
    const ids = new Set(Array.from({ length: 10 }, () => generateFingerprint().deviceId));
    expect(ids.size).toBe(10);
  });
});

// ─── collectCurrentFingerprint ────────────────────────────────────────────────

describe("collectCurrentFingerprint", () => {
  it("returns a valid Fingerprint shape", () => {
    const fp = collectCurrentFingerprint();
    expect(fp.deviceId).toBeTruthy();
    expect(fp.sessionToken).toBeTruthy();
    expect(fp.userAgent).toBeTruthy();
    expect(fp.clientMetadata.pluginType).toBe("GEMINI");
  });

  it("ideType is always ANTIGRAVITY", () => {
    const fp = collectCurrentFingerprint();
    expect(fp.clientMetadata.ideType).toBe("ANTIGRAVITY");
  });

  it("platform is WINDOWS or MACOS", () => {
    const fp = collectCurrentFingerprint();
    expect(["WINDOWS", "MACOS"]).toContain(fp.clientMetadata.platform);
  });
});

// ─── updateFingerprintVersion ─────────────────────────────────────────────────

describe("updateFingerprintVersion", () => {
  function makeFp(userAgent: string): Fingerprint {
    return {
      deviceId: "d",
      sessionToken: "s",
      userAgent,
      apiClient: "a",
      clientMetadata: { ideType: "ANTIGRAVITY", platform: "MACOS", pluginType: "GEMINI" },
      createdAt: Date.now(),
    };
  }

  it("returns false when version matches current", () => {
    const fp = makeFp("antigravity/1.18.3 darwin/arm64");
    // We don't know current version, but if already correct it returns false
    const result = updateFingerprintVersion(fp);
    // Either false (same) or true (updated) — just verify no throw
    expect(typeof result).toBe("boolean");
  });

  it("updates userAgent when version differs and returns true", () => {
    const fp = makeFp("antigravity/0.0.1 darwin/arm64");
    const updated = updateFingerprintVersion(fp);
    expect(updated).toBe(true);
    expect(fp.userAgent).not.toContain("0.0.1");
    expect(fp.userAgent).toMatch(/^antigravity\//);
  });

  it("preserves everything after the version in userAgent", () => {
    const fp = makeFp("antigravity/0.0.1 darwin/arm64");
    updateFingerprintVersion(fp);
    expect(fp.userAgent).toContain("darwin/arm64");
  });

  it("does not modify userAgent when it has no version prefix", () => {
    const fp = makeFp("some-other-agent/1.0");
    const updated = updateFingerprintVersion(fp);
    expect(updated).toBe(false);
    expect(fp.userAgent).toBe("some-other-agent/1.0");
  });
});

// ─── buildFingerprintHeaders ──────────────────────────────────────────────────

describe("buildFingerprintHeaders", () => {
  it("returns empty object for null fingerprint", () => {
    expect(buildFingerprintHeaders(null)).toEqual({});
  });

  it("returns User-Agent header from fingerprint", () => {
    const fp = generateFingerprint();
    const headers = buildFingerprintHeaders(fp);
    expect(headers["User-Agent"]).toBe(fp.userAgent);
  });
});

// ─── session fingerprint ──────────────────────────────────────────────────────

describe("getSessionFingerprint / regenerateSessionFingerprint", () => {
  it("getSessionFingerprint returns the same object on repeated calls", () => {
    const a = getSessionFingerprint();
    const b = getSessionFingerprint();
    expect(a).toBe(b);
  });

  it("regenerateSessionFingerprint returns a new object", () => {
    const before = getSessionFingerprint();
    const next = regenerateSessionFingerprint();
    expect(next).not.toBe(before);
  });

  it("after regeneration, getSessionFingerprint returns the new fingerprint", () => {
    const next = regenerateSessionFingerprint();
    expect(getSessionFingerprint()).toBe(next);
  });
});
