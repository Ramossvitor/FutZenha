import { describe, expect, it } from "vitest";
import { conviteAutoriza, decidirPorContas, mascararEmail } from "./regras-login-google";

const AGORA = new Date("2026-08-06T12:00:00Z").getTime();
const daqui = (ms: number) => new Date(AGORA + ms);

const conta = (id: number, googleSub: string | null) => ({ id, googleSub });

describe("decidirPorContas", () => {
  // O `sub` é o dono. Se o email da conta mudou de mão num domínio corporativo,
  // é o `sub` que continua apontando para a pessoa certa — inverter esta ordem
  // entregaria a conta a quem herdou o endereço.
  it("o sub conhecido vence, mesmo com outra conta casando pelo email", () => {
    const porSub = conta(1, "sub-antigo");
    expect(decidirPorContas(porSub, conta(2, null))).toEqual({ acao: "sessao", conta: porSub });
  });

  it("sem sub e sem email: só resta o convite", () => {
    expect(decidirPorContas(undefined, undefined)).toEqual({ acao: "convite" });
  });

  // A conta de senha encontrando o Google pela primeira vez.
  it("email conhecido numa conta sem Google → vincular", () => {
    expect(decidirPorContas(undefined, conta(7, null))).toEqual({ acao: "vincular", userId: 7 });
  });

  // Mesmo endereço, outro `sub`: endereço reciclado. Vincular aqui seria dar a
  // conta de alguém a quem só herdou o email.
  it("email conhecido numa conta com outro Google → recusa", () => {
    expect(decidirPorContas(undefined, conta(7, "sub-de-outro"))).toEqual({
      acao: "recusar",
      recusa: { erro: "google-ja-vinculado" },
    });
  });
});

describe("conviteAutoriza", () => {
  const valido = { email: "vitor@gmail.com", usedAt: null, expiresAt: daqui(60_000) };
  const identidade = { email: "vitor@gmail.com" };

  it("convite válido, com o email certo, autoriza", () => {
    expect(conviteAutoriza(valido, identidade, AGORA)).toEqual({ ok: true });
  });

  it("inexistente, usado ou vencido → convite-invalido", () => {
    const recusa = { ok: false, recusa: { erro: "convite-invalido" } };
    expect(conviteAutoriza(undefined, identidade, AGORA)).toEqual(recusa);
    expect(conviteAutoriza({ ...valido, usedAt: daqui(-1) }, identidade, AGORA)).toEqual(recusa);
    expect(conviteAutoriza({ ...valido, expiresAt: daqui(-1) }, identidade, AGORA)).toEqual(recusa);
    // O limite é inclusivo: expirar exatamente agora já é expirado.
    expect(conviteAutoriza({ ...valido, expiresAt: daqui(0) }, identidade, AGORA)).toEqual(recusa);
  });

  // Convite sem email é o antigo, de usuário e senha. Deixá-lo autorizar
  // cadastro pelo Google seria abrir um segundo caminho para o mesmo link, sem
  // a conferência de endereço que é a razão de o convite de Google existir.
  it("convite sem email não vale para o Google", () => {
    expect(conviteAutoriza({ ...valido, email: null }, identidade, AGORA)).toEqual({
      ok: false,
      recusa: { erro: "convite-sem-email" },
    });
  });

  // A trava contra quem pegou o link no grupo do WhatsApp.
  it("outro email → recusa com o endereço mascarado", () => {
    expect(conviteAutoriza(valido, { email: "estranho@gmail.com" }, AGORA)).toEqual({
      ok: false,
      recusa: { erro: "email-nao-confere", emailEsperado: "vi•••@gmail.com" },
    });
  });

  // O admin digita um lado e o Google devolve o outro; no Gmail as duas formas
  // são a mesma caixa, e reprovar aqui deixaria o convite intransponível.
  it("aceita as variantes de ponto e etiqueta do Gmail", () => {
    const comPonto = { ...valido, email: "vitor.ramos@gmail.com" };
    expect(conviteAutoriza(comPonto, { email: "vitorramos@gmail.com" }, AGORA)).toEqual({ ok: true });
    expect(conviteAutoriza(comPonto, { email: "vitor.ramos+pelada@gmail.com" }, AGORA)).toEqual({
      ok: true,
    });
    // Fora do Gmail a tolerância não existe: são endereços diferentes.
    const corporativo = { ...valido, email: "vitor.ramos@empresa.com" };
    expect(conviteAutoriza(corporativo, { email: "vitorramos@empresa.com" }, AGORA).ok).toBe(false);
  });
});

describe("mascararEmail", () => {
  it("mostra o começo e o domínio", () => {
    expect(mascararEmail("vitor.ramos@gmail.com")).toBe("vi•••@gmail.com");
  });

  it("não vaza mais do que duas letras, nem em local part curto", () => {
    expect(mascararEmail("a@gmail.com")).toBe("a•••@gmail.com");
    expect(mascararEmail("du@gmail.com")).toBe("du•••@gmail.com");
  });

  it("entrada sem domínio não vira mensagem meia-boca", () => {
    expect(mascararEmail("sem-arroba")).toBe("•••");
  });
});
