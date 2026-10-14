import { describe, expect, it } from "vitest";
import { canonical, generateKeyPair, keyPairMatches, signText, verifyText } from "../src/crypto.ts";
import { encodeResearcherCode, decodeResearcherCode } from "../src/events.ts";

describe("firmas Ed25519 (Web Crypto nativa)", () => {
  it("firma y verifica; rechaza texto alterado y llave equivocada", async () => {
    const a = await generateKeyPair();
    const b = await generateKeyPair();
    expect(a.publicKey).toMatch(/^[0-9a-f]{64}$/);
    const sig = await signText("hola", a.secretKey);
    expect(sig).toMatch(/^[0-9a-f]{128}$/);
    expect(await verifyText("hola", sig, a.publicKey)).toBe(true);
    expect(await verifyText("hola!", sig, a.publicKey)).toBe(false);
    expect(await verifyText("hola", sig, b.publicKey)).toBe(false);
    expect(await verifyText("hola", "zz", a.publicKey)).toBe(false);
    expect(await keyPairMatches(a)).toBe(true);
    expect(await keyPairMatches({ publicKey: b.publicKey, secretKey: a.secretKey })).toBe(false);
  });

  it("JSON canónico no depende del orden de las claves", () => {
    expect(canonical({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: "ñ" } })).toBe(canonical({ a: { c: "ñ", d: [1, { x: 1, y: 2 }] }, b: 1 }));
    expect(canonical({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it("código de investigador con nombre acentuado ida y vuelta", () => {
    const c = { id: "01KP0000000000000000000000", name: "Iván Petatán-Sagahón", key: "a".repeat(64) };
    expect(decodeResearcherCode(encodeResearcherCode(c))).toEqual(c);
    expect(() => decodeResearcherCode("BC1-abc")).toThrow(/dañado/);
  });
});
