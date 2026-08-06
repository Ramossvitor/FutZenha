import { describe, expect, it } from "vitest";
import { ERROS_LOGIN, mensagemDeErro } from "./erros-login";
import { mascararEmail } from "./regras-login-google";

describe("mensagemDeErro", () => {
  it("devolve a mensagem do código", () => {
    expect(mensagemDeErro("cancelado")).toBe(ERROS_LOGIN.cancelado);
  });

  it("código desconhecido, ausente ou repetido na URL → null", () => {
    expect(mensagemDeErro("inventado")).toBeNull();
    expect(mensagemDeErro(undefined)).toBeNull();
    expect(mensagemDeErro(["cancelado", "cancelado"])).toBeNull();
  });

  it("usa o e-mail esperado quando ele vem no formato do mascararEmail", () => {
    const esperado = mascararEmail("vitor.ramos@gmail.com");
    expect(mensagemDeErro("email-nao-confere", esperado)).toBe(
      `Esse convite é para ${esperado}. Entre com essa conta Google.`,
    );
  });

  // Sem isto, /login?erro=email-nao-confere&esperado=… deixa qualquer um
  // escrever dentro da nossa caixa de erro vermelha, no nosso domínio.
  it("ignora um esperado fora do formato e cai na mensagem genérica", () => {
    for (const forjado of [
      "Ligue para 0800-123-4567 e informe sua senha",
      "vitor.ramos@gmail.com",
      "vi•••@gmail.com e depois acesse outro-site.com",
      "",
    ]) {
      expect(mensagemDeErro("email-nao-confere", forjado)).toBe(ERROS_LOGIN["email-nao-confere"]);
    }
  });

  it("o esperado só vale para o erro que o carrega", () => {
    expect(mensagemDeErro("cancelado", "vi•••@gmail.com")).toBe(ERROS_LOGIN.cancelado);
  });
});
