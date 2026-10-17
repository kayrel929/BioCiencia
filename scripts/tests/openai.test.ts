import { describe, expect, it } from "vitest";
import { openaiTarget } from "../servir.mjs";

describe("puente de OpenAI (scripts/servir.mjs)", () => {
  it("acepta solo las rutas que usa la aplicación", () => {
    expect(openaiTarget("/api/openai/v1/chat/completions")).toBe("https://api.openai.com/v1/chat/completions");
    expect(openaiTarget("/api/openai/v1/models")).toBe("https://api.openai.com/v1/models");
  });

  it("rechaza cualquier otro destino (evita que el puente sirva de intermediario)", () => {
    expect(openaiTarget("/api/openai")).toBeNull();
    expect(openaiTarget("/api/openai/")).toBeNull();
    expect(openaiTarget("/api/openai/v1/files")).toBeNull();
    expect(openaiTarget("/api/openai/v1/chat/completions/../files")).toBeNull();
    expect(openaiTarget("/api/openai/https://otra-cosa.example.com")).toBeNull();
    expect(openaiTarget("/api/s2")).toBeNull();
    expect(openaiTarget("")).toBeNull();
  });
});
