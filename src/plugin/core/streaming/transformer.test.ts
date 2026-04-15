import { describe, expect, it, vi } from "vitest";
import {
  transformStreamingPayload,
  deduplicateThinkingText,
  cacheThinkingSignaturesFromResponse,
} from "./transformer";
import { createSignatureStore } from "../../stores/signature-store";
import { createThoughtBuffer } from "./transformer";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeBuffer() {
  return createThoughtBuffer();
}

function geminiResponse(parts: unknown[]) {
  return {
    candidates: [{ content: { role: "model", parts } }],
  };
}

function thinkingPart(text: string) {
  return { thought: true, text };
}

function textPart(text: string) {
  return { text };
}

// ─── transformStreamingPayload ────────────────────────────────────────────────

describe("transformStreamingPayload", () => {
  it("passes non-data lines unchanged", () => {
    const input = "event: message\nid: 1";
    expect(transformStreamingPayload(input)).toBe(input);
  });

  it("passes empty data line unchanged", () => {
    expect(transformStreamingPayload("data: ")).toBe("data: ");
  });

  it("passes invalid JSON data line unchanged", () => {
    expect(transformStreamingPayload("data: {not json}")).toBe("data: {not json}");
  });

  it("passes data line without response field unchanged", () => {
    const line = `data: ${JSON.stringify({ candidates: [] })}`;
    expect(transformStreamingPayload(line)).toBe(line);
  });

  it("calls transformThinkingParts on response field when present", () => {
    const inner = { type: "thinking", text: "reasoning" };
    const payload = { response: inner };
    const transform = vi.fn().mockReturnValue({ type: "redacted_thinking" });
    const result = transformStreamingPayload(`data: ${JSON.stringify(payload)}`, transform);
    expect(transform).toHaveBeenCalledWith(inner);
    expect(result).toContain("redacted_thinking");
  });

  it("handles multi-line payloads, transforming only data lines", () => {
    const dataLine = `data: ${JSON.stringify({ response: { text: "hi" } })}`;
    const input = `event: ping\n${dataLine}`;
    const transform = vi.fn().mockImplementation((r) => r);
    transformStreamingPayload(input, transform);
    expect(transform).toHaveBeenCalledTimes(1);
  });
});

// ─── deduplicateThinkingText (Gemini format) ──────────────────────────────────

describe("deduplicateThinkingText — Gemini candidates format", () => {
  it("returns non-object input unchanged", () => {
    const buf = makeBuffer();
    expect(deduplicateThinkingText(null, buf)).toBeNull();
    expect(deduplicateThinkingText("string", buf)).toBe("string");
  });

  it("passes through response with no candidates", () => {
    const buf = makeBuffer();
    const resp = { usageMetadata: { totalTokenCount: 10 } };
    expect(deduplicateThinkingText(resp, buf)).toEqual(resp);
  });

  it("passes non-thinking parts through unchanged", () => {
    const buf = makeBuffer();
    const resp = geminiResponse([textPart("hello")]);
    const result = deduplicateThinkingText(resp, buf) as typeof resp;
    expect(result.candidates[0].content.parts).toEqual([textPart("hello")]);
  });

  it("emits full thinking text on first occurrence", () => {
    const buf = makeBuffer();
    const resp = geminiResponse([thinkingPart("first thought")]);
    const result = deduplicateThinkingText(resp, buf) as any;
    const part = result.candidates[0].content.parts[0];
    expect(part.text).toBe("first thought");
  });

  it("emits only the delta on subsequent call with extended text", () => {
    const buf = makeBuffer();
    const resp1 = geminiResponse([thinkingPart("alpha")]);
    deduplicateThinkingText(resp1, buf);

    const resp2 = geminiResponse([thinkingPart("alphabeta")]);
    const result = deduplicateThinkingText(resp2, buf) as any;
    const part = result.candidates[0].content.parts[0];
    expect(part.text).toBe("beta");
  });

  it("filters out null parts (no-delta thinking)", () => {
    const buf = makeBuffer();
    const resp1 = geminiResponse([thinkingPart("same text"), textPart("hi")]);
    deduplicateThinkingText(resp1, buf);

    const resp2 = geminiResponse([thinkingPart("same text"), textPart("world")]);
    const result = deduplicateThinkingText(resp2, buf) as any;
    const parts = result.candidates[0].content.parts;
    expect(parts.some((p: any) => p.thought === true)).toBe(false);
  });

  it("deduplicates by hash when displayedThinkingHashes is provided", () => {
    const buf = makeBuffer();
    const seen = new Set<string>();
    const resp = geminiResponse([thinkingPart("duplicate")]);

    deduplicateThinkingText(resp, buf, seen);
    const result2 = deduplicateThinkingText(resp, buf, seen) as any;
    const parts = result2.candidates[0].content.parts;
    expect(parts.some((p: any) => p.thought === true)).toBe(false);
  });
});

// ─── cacheThinkingSignaturesFromResponse ──────────────────────────────────────

describe("cacheThinkingSignaturesFromResponse — Gemini format", () => {
  it("no-ops on non-object input", () => {
    const store = createSignatureStore();
    const buf = makeBuffer();
    expect(() =>
      cacheThinkingSignaturesFromResponse(null, "key", store, buf),
    ).not.toThrow();
  });

  it("accumulates thinking text in thoughtBuffer", () => {
    const store = createSignatureStore();
    const buf = makeBuffer();
    const resp = geminiResponse([thinkingPart("text chunk")]);
    cacheThinkingSignaturesFromResponse(resp, "sess-1", store, buf);
    expect(buf.get(0)).toBe("text chunk");
  });

  it("calls onCacheSignature when thoughtSignature is present", () => {
    const store = createSignatureStore();
    const buf = makeBuffer();
    const onSig = vi.fn();

    const resp = geminiResponse([
      thinkingPart("reasoning text"),
      { thoughtSignature: "sig-xyz" },
    ]);
    cacheThinkingSignaturesFromResponse(resp, "sess-1", store, buf, onSig);
    expect(onSig).toHaveBeenCalledWith("sess-1", "reasoning text", "sig-xyz");
  });

  it("stores signed thinking in signatureStore", () => {
    const store = createSignatureStore();
    const buf = makeBuffer();

    const resp = geminiResponse([
      thinkingPart("thoughts"),
      { thoughtSignature: "sig-abc" },
    ]);
    cacheThinkingSignaturesFromResponse(resp, "my-session", store, buf);
    const stored = store.get("my-session");
    expect(stored).toEqual({ text: "thoughts", signature: "sig-abc" });
  });

  it("does not call onCacheSignature when no thinking text was accumulated", () => {
    const store = createSignatureStore();
    const buf = makeBuffer();
    const onSig = vi.fn();

    const resp = geminiResponse([{ thoughtSignature: "sig" }]);
    cacheThinkingSignaturesFromResponse(resp, "sess", store, buf, onSig);
    expect(onSig).not.toHaveBeenCalled();
  });
});
