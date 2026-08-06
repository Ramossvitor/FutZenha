// As decisões do login pelo Google, separadas de quem vai ao banco.
//
// A escada inteira — quem entra, quem vincula, quem é recusado e com qual
// mensagem — é a parte que precisa de teste, e é a que não depende de banco
// nenhum: recebe linhas já buscadas e devolve o que fazer com elas. O
// google-login.ts busca, aplica e grava.
//
// Módulo puro de propósito (sem `server-only`, sem drizzle, sem `@/`): o vitest
// aqui roda sem config e sem alias. Os tipos são estruturais pelo mesmo motivo —
// as linhas do drizzle os satisfazem sem precisar importar o schema.

import { mesmoEmail } from "./email";

export type ErroLogin =
  | "email-nao-verificado"
  | "sem-convite"
  | "convite-invalido"
  | "convite-sem-email"
  | "email-nao-confere"
  | "jogador-inativo"
  | "conta-inativa"
  | "google-ja-vinculado";

export type Recusa = { erro: ErroLogin; emailEsperado?: string };

/** O mínimo de `users` que a decisão olha. */
export type ContaConhecida = { id: number; googleSub: string | null };

/** O mínimo de `invites` que a decisão olha. */
export type ConviteConhecido = { email: string | null; usedAt: Date | null; expiresAt: Date };

export type Decisao<C extends ContaConhecida> =
  /** Já conhecemos a conta: é login e acabou. */
  | { acao: "sessao"; conta: C }
  /** Conta existente que ainda não tem Google: vincular esta. */
  | { acao: "vincular"; userId: number }
  /** Ninguém conhecido: só entra com convite. */
  | { acao: "convite" }
  | { acao: "recusar"; recusa: Recusa };

/**
 * "vitor.ramos@gmail.com" → "vi•••@gmail.com".
 *
 * O suficiente para a pessoa reconhecer a própria conta e trocar de login, sem
 * entregar o endereço inteiro a quem apenas interceptou o link no grupo.
 */
export function mascararEmail(email: string): string {
  const [local, dominio] = email.split("@");
  if (!dominio) return "•••";
  return `${local.slice(0, 2)}•••@${dominio}`;
}

/**
 * Passos 3 a 5 da escada, sobre as duas linhas de `users` já buscadas.
 *
 * `sub` antes de email de propósito. O email é como as duas contas se encontram
 * uma vez; depois disso o dono é o `sub`, que não muda quando a pessoa troca de
 * email — e que não pode ser herdado por quem receber um endereço reciclado.
 */
export function decidirPorContas<C extends ContaConhecida>(
  porSub: C | undefined,
  porEmail: C | undefined,
): Decisao<C> {
  if (porSub) return { acao: "sessao", conta: porSub };
  if (!porEmail) return { acao: "convite" };
  // Mesmo email, outra conta Google: endereço que trocou de dono (só acontece
  // em domínio corporativo). Quem manda é o `sub` já vinculado.
  if (porEmail.googleSub !== null) return { acao: "recusar", recusa: { erro: "google-ja-vinculado" } };
  // Conta de senha encontrando o Google pela primeira vez.
  return { acao: "vincular", userId: porEmail.id };
}

/**
 * O convite autoriza esta identidade a virar conta?
 *
 * A comparação é canônica (ver src/lib/email.ts) porque os dois lados escrevem
 * o endereço de jeitos diferentes: o admin digita no formulário, o Google
 * devolve o da conta. Igualdade crua reprovaria um convite correto para
 * "vitor.ramos@gmail.com" quando a conta é "vitorramos@gmail.com" — e a
 * mensagem mascara justamente a parte que difere.
 */
export function conviteAutoriza(
  convite: ConviteConhecido | undefined,
  identidade: { email: string },
  agora: number,
): { ok: true } | { ok: false; recusa: Recusa } {
  if (!convite || convite.usedAt !== null || convite.expiresAt.getTime() <= agora) {
    return { ok: false, recusa: { erro: "convite-invalido" } };
  }
  // Convite antigo, de usuário e senha: não autoriza cadastro pelo Google. O
  // caminho dele continua sendo o formulário em /convite/[token].
  if (convite.email === null) return { ok: false, recusa: { erro: "convite-sem-email" } };
  if (!mesmoEmail(convite.email, identidade.email)) {
    return {
      ok: false,
      recusa: { erro: "email-nao-confere", emailEsperado: mascararEmail(convite.email) },
    };
  }
  return { ok: true };
}
