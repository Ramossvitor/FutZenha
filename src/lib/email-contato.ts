// O e-mail que a pessoa digita para RECEBER aviso — nunca para entrar.
//
// Módulo puro (sem `server-only`, sem drizzle) porque é lido dos dois lados: o
// formulário de resgate de convite, a action do perfil e a do admin. Fica
// separado de src/lib/email.ts de propósito — aquele é sem dependência nenhuma
// para que regras-login-google.ts possa importá-lo por caminho relativo, e
// arrastar o zod para lá quebraria esse contrato.
//
// Uma normalização, três políticas de vazio: aqui vazio é erro (o cadastro
// exige endereço), em `parseEmailDeContatoOpcional` vazio é `null` (o admin
// limpando um engano) e em `parseEmailDeConvite` (src/lib/convites.ts) vazio é
// o convite legado de usuário e senha.

import { z } from "zod";

/**
 * Trim e minúsculas antes de validar: é o que faz o endereço bater com o que o
 * Google devolve quando a mesma pessoa depois vincula a conta, e o que a
 * comparação canônica de src/lib/email.ts espera receber.
 */
export const emailSchema = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
  z.email("E-mail inválido — confira o endereço.").max(160, "E-mail longo demais."),
);

export type ParseDeEmail<T> = { ok: true; email: T } | { ok: false; erro: string };

function validar(valor: FormDataEntryValue | null): ParseDeEmail<string> {
  const parsed = emailSchema.safeParse(valor);
  return parsed.success
    ? { ok: true, email: parsed.data }
    : { ok: false, erro: parsed.error.issues[0].message };
}

function vazio(valor: FormDataEntryValue | null): boolean {
  return typeof valor !== "string" || valor.trim() === "";
}

/** O campo obrigatório: quem cria conta precisa dizer para onde mandamos aviso. */
export function parseEmailDeContato(valor: FormDataEntryValue | null): ParseDeEmail<string> {
  if (vazio(valor)) return { ok: false, erro: "Informe seu e-mail." };
  return validar(valor);
}

/** O campo que aceita ficar em branco — e em branco significa apagar o que havia. */
export function parseEmailDeContatoOpcional(
  valor: FormDataEntryValue | null,
): ParseDeEmail<string | null> {
  if (vazio(valor)) return { ok: true, email: null };
  return validar(valor);
}
