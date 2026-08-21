import "server-only";
import { count, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { attendances, groupInvitations, invites } from "@/db/schema";
import { enviadosPelaAgendaNoDia } from "./agenda-convite";
import { JANELA_DIARIA_HORAS, TETO_DIARIO } from "./freios-de-envio";

// Quantos e-mails a instalação inteira mandou nas últimas 24h, somando TODOS os
// fluxos — a contagem que o teto diário de ./freios-de-envio lê.
//
// Mora num módulo próprio, e não em ./email-convite onde nasceu, porque passou a
// ter dois leitores: o convite e o resumo do fut. Deixá-la lá obrigaria o
// ./email-resumo a importar o ./email-convite, que importaria o ./email-resumo
// de volta para contá-lo — ciclo.
//
// Não tem tabela de contador: cada fluxo carimba a linha de domínio que já
// registra o envio (`invites.email_sent_at`, `group_invitations.email_sent_at`,
// `attendances.agenda_email_sent_at` + `agenda_emails_sent`,
// `attendances.resumo_email_sent_at`), e este arquivo soma as quatro. É a mesma
// decisão de sempre: um contador central traria GC próprio, uma segunda noção de
// "quando" e uma chave que nenhum `\d` explica.

function dentroDaJanela(coluna: Parameters<typeof gt>[0]) {
  return gt(coluna, sql`now() - make_interval(hours => ${JANELA_DIARIA_HORAS})`);
}

/**
 * Um e-mail de resumo por linha carimbada — aqui a contagem de LINHAS está
 * certa, ao contrário da agenda.
 *
 * A agenda precisou de um contador (`agenda_emails_sent`) porque reenvia no
 * mesmo par (fut, jogador) e o carimbo é sobrescrito: dez envios viravam 1. O
 * resumo sai uma vez por par e nunca mais — o `resumo_email_sent_at is null` do
 * envio é o que garante isso —, então linha carimbada e e-mail enviado são a
 * mesma coisa. Ver o cabeçalho de drizzle/0029_resumo_do_fut.sql.
 */
export async function enviadosPeloResumoNoDia(): Promise<number> {
  const [linha] = await db
    .select({ total: count() })
    .from(attendances)
    .where(dentroDaJanela(attendances.resumoEmailSentAt));
  return linha?.total ?? 0;
}

/**
 * O que a instalação gastou nas últimas 24h: o total dos quatro fluxos e, à
 * parte, quanto disso foi resumo.
 *
 * Os dois números na MESMA ida ao banco porque quem decide precisa dos dois: o
 * lote do resumo confere o teto da instalação e o sub-teto dele (ver
 * `TETO_RESUMO_DIA`), e pedir cada um por sua conta rodaria o `count` de
 * `attendances` duas vezes por encerramento.
 */
export async function contagensDoDia(): Promise<{ total: number; resumo: number }> {
  const [[plataforma], [grupo], agenda, resumo] = await Promise.all([
    db.select({ total: count() }).from(invites).where(dentroDaJanela(invites.emailSentAt)),
    db
      .select({ total: count() })
      .from(groupInvitations)
      .where(dentroDaJanela(groupInvitations.emailSentAt)),
    enviadosPelaAgendaNoDia(),
    enviadosPeloResumoNoDia(),
  ]);
  return { total: plataforma.total + grupo.total + agenda + resumo, resumo };
}

/**
 * O teto diário vale para a instalação inteira, somando TODOS os fluxos.
 *
 * A agenda entrou nesta soma junto com o freio dela. Enquanto ela ficava de
 * fora, este teto media meia realidade: os e-mails de calendário gastavam a
 * mesma cota do Resend e não apareciam em contagem nenhuma, então o convite
 * podia ser recusado por uma cota que ele achava livre — ou, pior, passar e
 * estourar de verdade no Resend.
 *
 * O resumo do fut entrou pelo mesmo motivo, e com mais urgência: ele é o fluxo
 * de MAIOR volume do produto — um fut de 20 pessoas gasta 20 e-mails de uma vez,
 * contra o 1 de um convite. É também por isso que ele tem sub-teto próprio
 * (`TETO_RESUMO_DIA`): este teto aqui é o que recusa o convite, e o convite não
 * pode ser recusado por cota que um placar gastou.
 */
export async function tetoDiarioAtingido(): Promise<boolean> {
  return (await contagensDoDia()).total >= TETO_DIARIO;
}
