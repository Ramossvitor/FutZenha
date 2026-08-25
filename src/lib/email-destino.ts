import { sql } from "drizzle-orm";
import { users } from "@/db/schema";

/**
 * Para onde mandamos e-mail desta conta: o endereço verificado pelo Google, e
 * na falta dele o de contato que a pessoa (ou o admin) digitou.
 *
 * Precedência, não substituição. O auto-declarado nunca desvia o correio de uma
 * conta que já tem endereço provado — senão bastaria digitar o e-mail de alguém
 * num campo de perfil para redirecionar o que era dela. Por isso também o
 * `coalesce` mora aqui e não em cada query: são três chamadores, e a ordem dos
 * dois argumentos É a regra de segurança.
 *
 * Função, e não constante, para nascer um fragmento novo a cada uso — `sql`
 * carrega os pedaços já montados, e reaproveitar a mesma instância em queries
 * com formas diferentes é convite a surpresa.
 *
 * O que este coalesce NÃO cobre: o e-mail de convite de plataforma, que carrega
 * o link de resgate de conta e por isso só vai para `invites.email` (ver
 * enviarConvitePorEmail em src/lib/email-convite.ts).
 */
export function emailDeDestino() {
  return sql<string | null>`coalesce(${users.email}, ${users.contactEmail})`;
}

/**
 * A mesma regra em TypeScript, para quem tem a linha em mãos e não uma query.
 *
 * Mora aqui junto do `coalesce` pelo motivo que fez `condicaoLinkVivo` nascer
 * (ver src/lib/grupos-link.ts): escrita à mão, ela estava em três lugares — a
 * página do convite, a action que resgata e a sessão — e as três precisam
 * concordar exatamente. Divergir uma faz a página esconder o campo enquanto a
 * action ainda o exige, e a pessoa recebe "Informe seu e-mail." num formulário
 * sem onde digitar, sem saída a não ser um convite novo.
 *
 * Há um chamador com um motivo a mais para não escrever o `??` à mão:
 * `vincularAConta` em src/lib/google-login.ts precisa do destino ANTERIOR ao
 * vínculo, e aquele módulo é proibido por teste estrutural de sequer MENCIONAR
 * `contact_email` (ver email-contato-nao-autentica.test.ts) — a coluna não é
 * chave de autorização, e a proibição existe para que ninguém a transforme em
 * uma. Pedindo o endereço a esta função, ele obtém o destino sem nomear a
 * coluna, e a precedência continua definida num lugar só.
 */
export function enderecoDeDestino(conta: {
  email: string | null;
  contactEmail: string | null;
}): string | null {
  return conta.email ?? conta.contactEmail;
}

/** Tem para onde mandar? A mesma precedência, respondida como sim/não. */
export function temEmailDeDestino(conta: {
  email: string | null;
  contactEmail: string | null;
}): boolean {
  return enderecoDeDestino(conta) !== null;
}
