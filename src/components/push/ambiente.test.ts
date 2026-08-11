import { afterEach, describe, expect, it, vi } from "vitest";
import { ehIOS, emStandalone, gravarSnooze, snoozeVigente } from "./ambiente";

// Estas funções decidem se o convite de instalar e o pré-prompt de push
// aparecem. Erra a aritmética ou inverte o fail-closed do catch e o resultado é
// silencioso nos dois sentidos: ou o convite some para sempre, ou volta a cada
// navegação. Os dois consumidores são .tsx, fora da cobertura — é aqui ou
// em lugar nenhum.

const CHAVE = "futzenha:teste:snooze";
const DIA_MS = 24 * 60 * 60 * 1000;

function localStorageFake(inicial: Record<string, string> = {}) {
  const dados = new Map(Object.entries(inicial));
  return {
    getItem: (k: string) => dados.get(k) ?? null,
    setItem: (k: string, v: string) => void dados.set(k, v),
    removeItem: (k: string) => void dados.delete(k),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("snoozeVigente", () => {
  it("sem marca nenhuma, não está em snooze — Number(null) é 0, não NaN", () => {
    vi.stubGlobal("localStorage", localStorageFake());
    expect(snoozeVigente(CHAVE, 14)).toBe(false);
  });

  it("marca ilegível ou zerada não segura o convite", () => {
    vi.stubGlobal("localStorage", localStorageFake({ [CHAVE]: "lixo" }));
    expect(snoozeVigente(CHAVE, 14)).toBe(false);
    vi.stubGlobal("localStorage", localStorageFake({ [CHAVE]: "0" }));
    expect(snoozeVigente(CHAVE, 14)).toBe(false);
  });

  it("dentro da janela segura; fora dela, o convite volta", () => {
    vi.useFakeTimers();
    const agora = new Date("2026-08-10T12:00:00Z");
    vi.setSystemTime(agora);
    const dispensadoEm = agora.getTime() - 10 * DIA_MS;
    vi.stubGlobal("localStorage", localStorageFake({ [CHAVE]: String(dispensadoEm) }));

    expect(snoozeVigente(CHAVE, 14)).toBe(true);
    expect(snoozeVigente(CHAVE, 5)).toBe(false);
  });

  it("na virada exata do prazo o snooze já expirou (< e não <=)", () => {
    vi.useFakeTimers();
    const agora = new Date("2026-08-10T12:00:00Z");
    vi.setSystemTime(agora);
    vi.stubGlobal(
      "localStorage",
      localStorageFake({ [CHAVE]: String(agora.getTime() - 14 * DIA_MS) }),
    );
    expect(snoozeVigente(CHAVE, 14)).toBe(false);
  });

  // Fail-closed de propósito: sem storage não há como lembrar a dispensa, e
  // insistir a cada navegação é pior do que ficar quieto.
  it("storage indisponível vale como 'em snooze'", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
    });
    expect(snoozeVigente(CHAVE, 14)).toBe(true);
  });
});

describe("gravarSnooze", () => {
  it("o que grava é o que snoozeVigente lê de volta", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T12:00:00Z"));
    vi.stubGlobal("localStorage", localStorageFake());

    expect(snoozeVigente(CHAVE, 30)).toBe(false);
    gravarSnooze(CHAVE);
    expect(snoozeVigente(CHAVE, 30)).toBe(true);
  });

  it("storage que recusa escrita não derruba a página", () => {
    vi.stubGlobal("localStorage", {
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    expect(() => gravarSnooze(CHAVE)).not.toThrow();
  });
});

describe("ehIOS", () => {
  it.each([
    ["iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", true],
    ["iPad", "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)", true],
    ["Android", "Mozilla/5.0 (Linux; Android 14; Pixel 8)", false],
    ["desktop", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", false],
  ])("%s", (_nome, userAgent, esperado) => {
    vi.stubGlobal("navigator", { userAgent });
    expect(ehIOS()).toBe(esperado);
  });
});

describe("emStandalone", () => {
  it("reconhece pelo display-mode", () => {
    vi.stubGlobal("window", { matchMedia: (q: string) => ({ matches: q.includes("standalone") }) });
    vi.stubGlobal("navigator", {});
    expect(emStandalone()).toBe(true);
  });

  // O caminho legado do Safari: em algumas versões de iOS é ele quem responde.
  it("reconhece pelo navigator.standalone do Safari", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    vi.stubGlobal("navigator", { standalone: true });
    expect(emStandalone()).toBe(true);
  });

  it("no browser comum, é falso pelos dois caminhos", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    vi.stubGlobal("navigator", { standalone: false });
    expect(emStandalone()).toBe(false);
  });
});
