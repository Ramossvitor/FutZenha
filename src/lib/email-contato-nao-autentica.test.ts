import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Por que isto é um teste e não um comentário.
//
// `users.contact_email` guarda um endereço que NINGUÉM verificou: a pessoa
// digita no cadastro, ou o admin digita por ela. `users.email` guarda o que o
// Google devolveu, e é chave de autorização — decidirPorContas vincula um
// login Google a qualquer conta cujo email case e que ainda não tenha
// google_sub (ver regras-login-google.ts).
//
// Juntar as duas leituras num coalesce "para simplificar" é a mudança de uma
// linha que transforma um campo de perfil em porta de entrada: bastaria digitar
// o Gmail de outra pessoa para que o login dela caísse na sua conta. É uma
// mudança que parece limpeza e que nenhum teste de comportamento pega, porque o
// cenário que ela abre ninguém pensa em escrever. Então o teste é estrutural:
// os dois módulos do login não podem sequer MENCIONAR a coluna.
//
// Mesmo truque de mensagens.test.ts, que também lê fonte com readFileSync.

const MODULOS_DO_LOGIN = ["./google-login.ts", "./regras-login-google.ts"];
const MENCIONA_CONTATO = /contact_?[eE]mail/;

describe("o e-mail de contato não participa do login", () => {
  it.each(MODULOS_DO_LOGIN)("%s não menciona a coluna de contato", (modulo) => {
    const fonte = readFileSync(fileURLToPath(new URL(modulo, import.meta.url)), "utf8");
    expect(fonte).not.toMatch(MENCIONA_CONTATO);
  });
});
