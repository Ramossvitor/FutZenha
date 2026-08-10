import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { classificarStatusResend, enviarEmail } from "./email-envio";

describe("classificarStatusResend", () => {
  it("2xx é sucesso", () => {
    expect(classificarStatusResend(200)).toEqual({ ok: true });
    expect(classificarStatusResend(201)).toEqual({ ok: true });
  });

  // O mesmo 429 cobre o rate limit por segundo e a cota diária do free tier —
  // o admin resolve os dois do mesmo jeito (WhatsApp), então é um motivo só.
  it("429 é limite", () => {
    expect(classificarStatusResend(429)).toEqual({ ok: false, motivo: "limite" });
  });

  it("demais 4xx são recusa de configuração ou payload", () => {
    for (const status of [400, 401, 403, 422]) {
      expect(classificarStatusResend(status)).toEqual({ ok: false, motivo: "recusado" });
    }
  });

  it("5xx é indisponibilidade do Resend", () => {
    for (const status of [500, 502, 503]) {
      expect(classificarStatusResend(status)).toEqual({ ok: false, motivo: "indisponivel" });
    }
  });

  // Os interiores acima passariam com qualquer comparação frouxa. Estas são as
  // bordas: um `<= 300` no lugar do `< 300` transformaria um redirect em
  // "enviado", e um `>= 499` engoliria o primeiro 5xx como recusa de payload.
  it("as bordas de cada faixa caem do lado certo", () => {
    expect(classificarStatusResend(299)).toEqual({ ok: true });
    expect(classificarStatusResend(400)).toEqual({ ok: false, motivo: "recusado" });
    expect(classificarStatusResend(499)).toEqual({ ok: false, motivo: "recusado" });
    expect(classificarStatusResend(500)).toEqual({ ok: false, motivo: "indisponivel" });
  });

  // O fetch já segue redirect sozinho, então 3xx aqui é o endpoint ter mudado de
  // lugar. Fica junto do 5xx de propósito — nada que o admin resolva.
  it("3xx é tratado como indisponibilidade, não como sucesso", () => {
    for (const status of [301, 302, 307]) {
      expect(classificarStatusResend(status)).toEqual({ ok: false, motivo: "indisponivel" });
    }
  });
});

const KEY_FAKE = "re_test_fake";

const msg = {
  para: "fulano@example.com",
  assunto: "Convite para a pelada",
  html: "<p>oi</p>",
  texto: "oi",
};

/** Só `status` e `text()` — é tudo que enviarEmail lê da resposta. */
function respostaResend(status: number, corpo = "") {
  return { status, text: () => Promise.resolve(corpo) };
}

describe("enviarEmail", () => {
  let consoleError: MockInstance;

  beforeEach(() => {
    // As falhas abaixo logam de propósito — silenciar aqui mantém a saída do
    // teste limpa e deixa o spy conferir o que foi parar no log.
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("RESEND_API_KEY", KEY_FAKE);
    vi.stubEnv("EMAIL_FROM", "");
  });

  afterEach(() => {
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
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(enviarEmail(msg)).resolves.toEqual({ ok: false, motivo: "indisponivel" });
  });

  it("timeout do AbortSignal devolve indisponivel em vez de lançar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError")),
    );
    await expect(enviarEmail(msg)).resolves.toEqual({ ok: false, motivo: "indisponivel" });
  });

  it("429 do Resend vira limite", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(respostaResend(429, '{"name":"rate_limit_exceeded"}')),
    );
    await expect(enviarEmail(msg)).resolves.toEqual({ ok: false, motivo: "limite" });
  });

  // O corpo da resposta é diagnóstico, não decisão: um text() que falha
  // (conexão que caiu no meio) não pode trocar o motivo nem virar exceção.
  it("resposta de erro com text() quebrado mantém o motivo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 400,
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
