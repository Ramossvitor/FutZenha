import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { classificarRespostaResend, enviarEmail, esperaAposRajada } from "./email-envio";

describe("classificarRespostaResend", () => {
  it("2xx é sucesso", () => {
    expect(classificarRespostaResend(200, "")).toEqual({ ok: true });
    expect(classificarRespostaResend(201, "")).toEqual({ ok: true });
  });

  // O 429 se divide pelo `name` do corpo (ver docs de erros do Resend): rajada
  // de requisições/segundo é passageira e retryável; cota diária/mensal é
  // terminal — o admin resolve no WhatsApp e amanhã volta.
  it("429 de rajada é rajada", () => {
    expect(classificarRespostaResend(429, '{"name":"rate_limit_exceeded"}')).toEqual({
      ok: false,
      motivo: "rajada",
    });
  });

  it("429 de cota diária ou mensal é limite", () => {
    for (const name of ["daily_quota_exceeded", "monthly_quota_exceeded"]) {
      expect(classificarRespostaResend(429, JSON.stringify({ name }))).toEqual({
        ok: false,
        motivo: "limite",
      });
    }
  });

  // Corpo ilegível assume o caso terminal: deixar de retentar uma rajada custa
  // um reenvio manual; martelar uma cota estourada não ajuda ninguém.
  it("429 com corpo ilegível é limite", () => {
    for (const corpo of ["", "não é json", '{"sem":"name"}', '{"name":42}']) {
      expect(classificarRespostaResend(429, corpo)).toEqual({ ok: false, motivo: "limite" });
    }
  });

  it("demais 4xx são recusa de configuração ou payload", () => {
    for (const status of [400, 401, 403, 422]) {
      expect(classificarRespostaResend(status, "")).toEqual({ ok: false, motivo: "recusado" });
    }
  });

  it("5xx é indisponibilidade do Resend", () => {
    for (const status of [500, 502, 503]) {
      expect(classificarRespostaResend(status, "")).toEqual({ ok: false, motivo: "indisponivel" });
    }
  });

  // Os interiores acima passariam com qualquer comparação frouxa. Estas são as
  // bordas: um `<= 300` no lugar do `< 300` transformaria um redirect em
  // "enviado", e um `>= 499` engoliria o primeiro 5xx como recusa de payload.
  it("as bordas de cada faixa caem do lado certo", () => {
    expect(classificarRespostaResend(299, "")).toEqual({ ok: true });
    expect(classificarRespostaResend(400, "")).toEqual({ ok: false, motivo: "recusado" });
    expect(classificarRespostaResend(499, "")).toEqual({ ok: false, motivo: "recusado" });
    expect(classificarRespostaResend(500, "")).toEqual({ ok: false, motivo: "indisponivel" });
  });

  // O fetch já segue redirect sozinho, então 3xx aqui é o endpoint ter mudado de
  // lugar. Fica junto do 5xx de propósito — nada que o admin resolva.
  it("3xx é tratado como indisponibilidade, não como sucesso", () => {
    for (const status of [301, 302, 307]) {
      expect(classificarRespostaResend(status, "")).toEqual({ ok: false, motivo: "indisponivel" });
    }
  });
});

// O jitter é aleatório por design, então cada caso confere a faixa [base,
// base + 250], não um valor exato.
describe("esperaAposRajada", () => {
  it("retry-after presente manda na espera", () => {
    const espera = esperaAposRajada(1, 1);
    expect(espera).toBeGreaterThanOrEqual(1000);
    expect(espera).toBeLessThanOrEqual(1250);
  });

  // Um retry-after alto é sinal de cota, não de rajada — não vale prender a
  // request esperando por ele.
  it("retry-after alto é capado em 5s", () => {
    const espera = esperaAposRajada(1, 60);
    expect(espera).toBeGreaterThanOrEqual(5000);
    expect(espera).toBeLessThanOrEqual(5250);
  });

  it("retry-after zero espera só o jitter", () => {
    const espera = esperaAposRajada(1, 0);
    expect(espera).toBeGreaterThanOrEqual(0);
    expect(espera).toBeLessThanOrEqual(250);
  });

  it("sem retry-after o degrau cresce com a tentativa", () => {
    const primeira = esperaAposRajada(1, null);
    expect(primeira).toBeGreaterThanOrEqual(1000);
    expect(primeira).toBeLessThanOrEqual(1250);
    const segunda = esperaAposRajada(2, null);
    expect(segunda).toBeGreaterThanOrEqual(2000);
    expect(segunda).toBeLessThanOrEqual(2250);
  });
});

const KEY_FAKE = "re_test_fake";

const msg = {
  para: "fulano@example.com",
  assunto: "Convite para a pelada",
  html: "<p>oi</p>",
  texto: "oi",
};

/** Só `status`, `headers` e `text()` — é tudo que enviarEmail lê da resposta. */
function respostaResend(status: number, corpo = "", headers: Record<string, string> = {}) {
  return { status, headers: new Headers(headers), text: () => Promise.resolve(corpo) };
}

const RAJADA = '{"name":"rate_limit_exceeded"}';

describe("enviarEmail", () => {
  let consoleError: MockInstance;

  beforeEach(() => {
    // As falhas abaixo logam de propósito — silenciar aqui mantém a saída do
    // teste limpa e deixa o spy conferir o que foi parar no log.
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("RESEND_API_KEY", KEY_FAKE);
    vi.stubEnv("EMAIL_FROM", "");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sem key devolve nao-configurado sem tocar a rede", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(enviarEmail(msg)).resolves.toEqual({ ok: false, motivo: "nao-configurado" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posta para o Resend com `to` em array, remetente default e a key no Authorization", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaResend(200));
    vi.stubGlobal("fetch", fetchMock);
    await expect(enviarEmail(msg)).resolves.toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${KEY_FAKE}`);
    const corpo = JSON.parse(init.body);
    expect(corpo.to).toEqual(["fulano@example.com"]);
    expect(corpo.from).toBe("FutZenha <convite@futzenha.com.br>");
    expect(corpo.subject).toBe("Convite para a pelada");
    expect(corpo.html).toBe("<p>oi</p>");
    expect(corpo.text).toBe("oi");
  });

  // A env var existe para testar antes da verificação do domínio terminar
  // (onboarding@resend.dev) ou trocar o nome exibido.
  it("EMAIL_FROM setada sobrepõe o remetente default", async () => {
    vi.stubEnv("EMAIL_FROM", "FutZenha Teste <onboarding@example.com>");
    const fetchMock = vi.fn().mockResolvedValue(respostaResend(200));
    vi.stubGlobal("fetch", fetchMock);
    await enviarEmail(msg);
    const corpo = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(corpo.from).toBe("FutZenha Teste <onboarding@example.com>");
  });

  // O contrato nunca-lança: falha de email não pode derrubar a action — o
  // convite já está criado e o link segue entregável no WhatsApp.
  it("falha de rede devolve indisponivel em vez de lançar", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(enviarEmail(msg)).resolves.toEqual({ ok: false, motivo: "indisponivel" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // O invariante do retry: timeout NUNCA dispara nova tentativa. Se disparasse,
  // cada tentativa renasceria com timeout zerado e a espera total escaparia do
  // teto — só a resposta rápida de 429 de rajada repete o laço.
  it("timeout do AbortSignal devolve indisponivel na hora, sem retentar", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(enviarEmail(msg)).resolves.toEqual({ ok: false, motivo: "indisponivel" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rajada seguida de sucesso retenta e devolve ok", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respostaResend(429, RAJADA, { "retry-after": "1" }))
      .mockResolvedValueOnce(respostaResend(200));
    vi.stubGlobal("fetch", fetchMock);

    const envio = enviarEmail(msg);
    await vi.runAllTimersAsync();
    await expect(envio).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a espera entre tentativas respeita o retry-after", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respostaResend(429, RAJADA, { "retry-after": "1" }))
      .mockResolvedValueOnce(respostaResend(200));
    vi.stubGlobal("fetch", fetchMock);

    const envio = enviarEmail(msg);
    // Antes do retry-after vencer (1s + jitter de até 250ms), nada de 2º POST.
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(251);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(envio).resolves.toEqual({ ok: true });
  });

  it("rajada persistente esgota as tentativas e devolve rajada", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(respostaResend(429, RAJADA, { "retry-after": "0" }));
    vi.stubGlobal("fetch", fetchMock);

    const envio = enviarEmail(msg);
    await vi.runAllTimersAsync();
    await expect(envio).resolves.toEqual({ ok: false, motivo: "rajada" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("429 de cota não retenta e devolve limite", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(respostaResend(429, '{"name":"daily_quota_exceeded"}'));
    vi.stubGlobal("fetch", fetchMock);
    await expect(enviarEmail(msg)).resolves.toEqual({ ok: false, motivo: "limite" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("5xx não retenta", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaResend(500));
    vi.stubGlobal("fetch", fetchMock);
    await expect(enviarEmail(msg)).resolves.toEqual({ ok: false, motivo: "indisponivel" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // O corpo da resposta é diagnóstico, não decisão: um text() que falha
  // (conexão que caiu no meio) não pode trocar o motivo nem virar exceção.
  it("resposta de erro com text() quebrado mantém o motivo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 400,
        headers: new Headers(),
        text: () => Promise.reject(new Error("stream interrompido")),
      }),
    );
    await expect(enviarEmail(msg)).resolves.toEqual({ ok: false, motivo: "recusado" });
  });

  it("a key não vaza no log de recusa", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(respostaResend(401, '{"message":"API key is invalid"}')),
    );
    await enviarEmail(msg);
    expect(consoleError).toHaveBeenCalled();
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(KEY_FAKE);
  });
});
