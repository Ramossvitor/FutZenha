import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { suporteDoBrowser, urlBase64ToUint8Array } from "./use-push";

// As duas funções puras do hook. Ambas falham em silêncio quando quebram:
// urlBase64ToUint8Array errado derruba o subscribe de TODO device e o catch do
// ativar() transforma isso no mesmo banner de "não deu para ativar" de uma queda
// de rede; suporteDoBrowser errado esconde (ou mostra) a UI inteira. O E2E só
// consegue provar o lado negativo — sem chave, nada aparece.

beforeEach(() => {
  // A função chama window.atob; no node ele existe como global solto.
  vi.stubGlobal("window", { atob: (s: string) => Buffer.from(s, "base64").toString("binary") });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("urlBase64ToUint8Array", () => {
  // Um caso por resto de padding: é exatamente o que o `=`.repeat() calcula.
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 65])("bate com o Buffer para %i bytes", (tamanho) => {
    const bytes = Buffer.from(Array.from({ length: tamanho }, (_, i) => (i * 37) % 256));
    const base64url = bytes.toString("base64url");
    expect(Buffer.from(urlBase64ToUint8Array(base64url))).toEqual(bytes);
  });

  it("traduz os dois caracteres do alfabeto url-safe (- e _)", () => {
    // 0xFB 0xEF produz '-' e '_' em base64url e '+' e '/' em base64 comum.
    const bytes = Buffer.from([0xfb, 0xef, 0xbe]);
    const base64url = bytes.toString("base64url");
    expect(base64url).toMatch(/[-_]/);
    expect(Buffer.from(urlBase64ToUint8Array(base64url))).toEqual(bytes);
  });

  it("devolve um Uint8Array sobre ArrayBuffer — o que o applicationServerKey aceita", () => {
    const saida = urlBase64ToUint8Array(Buffer.from([1, 2, 3]).toString("base64url"));
    expect(saida).toBeInstanceOf(Uint8Array);
    expect(saida.buffer).toBeInstanceOf(ArrayBuffer);
  });
});

describe("suporteDoBrowser", () => {
  const apisCompletas = () => {
    vi.stubGlobal("navigator", { serviceWorker: {} });
    vi.stubGlobal("window", { PushManager: class {}, Notification: class {}, atob: () => "" });
  };

  it("com a chave pública e as três APIs, tem suporte", () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "publica-fake");
    apisCompletas();
    expect(suporteDoBrowser()).toBe(true);
  });

  // O kill switch do cliente: sem a chave no build, nenhuma UI de push aparece.
  it("sem a chave pública, não tem suporte nem com todas as APIs", () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "");
    apisCompletas();
    expect(suporteDoBrowser()).toBe(false);
  });

  it("falta de qualquer uma das três APIs derruba o suporte", () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "publica-fake");

    vi.stubGlobal("navigator", {});
    vi.stubGlobal("window", { PushManager: class {}, Notification: class {} });
    expect(suporteDoBrowser()).toBe(false);

    // iOS no Safari fora do app instalado cai exatamente aqui: sem PushManager.
    vi.stubGlobal("navigator", { serviceWorker: {} });
    vi.stubGlobal("window", { Notification: class {} });
    expect(suporteDoBrowser()).toBe(false);

    vi.stubGlobal("window", { PushManager: class {} });
    expect(suporteDoBrowser()).toBe(false);
  });
});
