import { describe, expect, it } from "vitest";
import {
  emailDeAvisoDeGrupo,
  emailDeConvitePlataforma,
  emailDeResetDeAcesso,
  escaparHtml,
} from "./email-modelos";

describe("escaparHtml", () => {
  it("escapa os cinco caracteres com significado em HTML", () => {
    expect(escaparHtml(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  });

  it("texto comum passa intacto", () => {
    expect(escaparHtml("Zé da Silva")).toBe("Zé da Silva");
  });
});

describe("emailDeConvitePlataforma", () => {
  const dados = {
    nome: "Zé <script>alert(1)</script>",
    token: "tok-abc123",
    emailDeDestino: "ze@gmail.com",
    expiraEm: new Date(2026, 7, 15),
  };

  it("html e texto levam o link do convite", () => {
    const email = emailDeConvitePlataforma(dados);
    // Sem NEXT_PUBLIC_SITE_URL no ambiente de teste, siteUrl() cai no localhost.
    expect(email.html).toContain("/convite/tok-abc123");
    expect(email.texto).toContain("/convite/tok-abc123");
  });

  // O nome vem de formulário de admin — texto livre. Sem escape, viraria markup
  // dentro do email de outra pessoa.
  it("escapa o nome no html e não deixa markup passar", () => {
    const email = emailDeConvitePlataforma(dados);
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });

  // O contrário do teste acima, e igualmente deliberado: a versão `texto` não é
  // HTML, então escapar ali entregaria "Zé &lt;script&gt;" na caixa de entrada.
  // É a "correção" de consistência mais provável de alguém tentar um dia.
  it("não escapa nada na versão texto", () => {
    const email = emailDeConvitePlataforma(dados);
    expect(email.texto).toContain("Zé <script>alert(1)</script>");
    expect(email.texto).not.toContain("&lt;");
    expect(email.texto).not.toContain("&amp;");
  });

  it("diz qual conta Google resgata e quando expira", () => {
    const email = emailDeConvitePlataforma(dados);
    expect(email.html).toContain("ze@gmail.com");
    expect(email.texto).toContain("ze@gmail.com");
    expect(email.html).toContain("15/08/2026");
  });

  it("assunto fixo de convite", () => {
    expect(emailDeConvitePlataforma(dados).assunto).toBe("Seu convite para o FutZenha");
  });
});

describe("emailDeResetDeAcesso", () => {
  const dados = {
    nome: "Zé <script>alert(1)</script>",
    token: "tok-reset9",
    emailDeDestino: "ze@gmail.com",
    expiraEm: new Date(2026, 7, 15),
  };

  it("leva o mesmo link de /convite, com o assunto de reset", () => {
    const email = emailDeResetDeAcesso(dados);
    expect(email.html).toContain("/convite/tok-reset9");
    expect(email.texto).toContain("/convite/tok-reset9");
    expect(email.assunto).toBe("Redefinir seu acesso ao FutZenha");
  });

  // A razão de este modelo existir: quem já tem conta não pode receber boas-vindas.
  it("não dá as boas-vindas a quem já é do app", () => {
    const email = emailDeResetDeAcesso(dados);
    expect(email.html).not.toContain("Você foi convidado");
    expect(email.texto).not.toContain("Você foi convidado");
  });

  it("escapa o nome no html mas não no texto", () => {
    const email = emailDeResetDeAcesso(dados);
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.texto).toContain("Zé <script>alert(1)</script>");
    expect(email.texto).not.toContain("&lt;");
  });
});

describe("emailDeAvisoDeGrupo", () => {
  // Os dois campos são texto livre de formulário: o nome do grupo e o nome de
  // quem convidou (session.player.name). Markup nos dois de propósito — com um
  // só, apagar o escape do outro passaria batido.
  const dados = {
    nomeDoGrupo: `Pelada <b>dos Amigos</b>`,
    quemConvidou: `Vitor <img src=x onerror=alert(1)>`,
  };

  it("aponta para a página de grupos, onde o aceite acontece", () => {
    const email = emailDeAvisoDeGrupo(dados);
    expect(email.html).toContain("/grupos");
    expect(email.texto).toContain("/grupos");
  });

  it("escapa o nome do grupo no html", () => {
    const email = emailDeAvisoDeGrupo(dados);
    expect(email.html).not.toContain("<b>dos Amigos</b>");
    expect(email.html).toContain("&lt;b&gt;dos Amigos&lt;/b&gt;");
  });

  it("escapa quem convidou no html", () => {
    const email = emailDeAvisoDeGrupo(dados);
    expect(email.html).not.toContain("<img src=x");
    expect(email.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("não escapa nada na versão texto", () => {
    const email = emailDeAvisoDeGrupo(dados);
    expect(email.texto).toContain(`Vitor <img src=x onerror=alert(1)>`);
    expect(email.texto).toContain(`Pelada <b>dos Amigos</b>`);
    expect(email.texto).not.toContain("&lt;");
  });

  it("assunto carrega o nome do grupo (sem escape: assunto não é HTML)", () => {
    expect(emailDeAvisoDeGrupo(dados).assunto).toBe(
      "Convite para o grupo Pelada <b>dos Amigos</b> no FutZenha",
    );
  });
});
