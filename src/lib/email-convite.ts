import "server-only";
import { after } from "next/server";
import { and, count, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { groupInvitations, groups, invites, players, users } from "@/db/schema";
import { enviadosPelaAgendaNoDia } from "./agenda-convite";
import { mesmoEmail } from "./email";
import { emailDeDestino } from "./email-destino";
import { emailConfigurado, enviarEmail } from "./email-envio";
import {
  JANELA_DIARIA_HORAS,
  JANELA_POR_DESTINATARIO_MIN,
  TETO_DIARIO,
  TETO_POR_CONVIDANTE_DIA,
} from "./freios-de-envio";
import {
  emailDeAvisoDeGrupo,
  emailDeConvitePlataforma,
  emailDeResetDeAcesso,
} from "./email-modelos";

// Orquestração do convite por email: carrega do banco, renderiza e envia.
//
// Família `email-*`: `email-envio.ts` é o transporte, `email-modelos.ts` monta o
// conteúdo, este junta os dois com o banco. É o único dos três com `server-only`
// e drizzle — mesma divisão de google-oauth.ts (puro) e google-login.ts (banco).
//
// Sempre chamado DEPOIS do commit, nunca dentro da transação — o envio segura
// uma conexão do pool por até 10s, e um rollback não "desenvia" um email que já
// chegou. Recebe só o token (ou o id do convite) de propósito: a revalidação
// (convite ainda pendente, não expirado, com email) mora aqui e vale igual para
// o disparo automático e para o botão de reenviar — o call site fica com uma
// linha.
//
// Sem guard, como convites.ts: quem autoriza é a action.

export type ResultadoEnvioDeConvite =
  | { ok: true }
  | {
      ok: false;
      motivo:
        | "nao-configurado"
        | "convite-inelegivel"
        | "envio-recente"
        | "limite"
        // Separado de "limite" porque a saída de quem leu é outra: o teto da
        // instalação volta amanhã, o teto de quem convida é do próprio ator e
        // some sozinho conforme as 24h correm. Dizer "limite diário de e-mails
        // atingido" para o segundo culpa a plataforma por uma conta.
        | "limite-do-convidante"
        | "rajada"
        | "falha";
    };

// Freio de mão do envio. Não é otimização de cota: qualquer jogador logado cria
// um fut avulso e vira admin dele (ver createMatchDay), e daí alcança
// convidarParaFut/reenviarConviteDoFut com nome e endereço à escolha. Sem
// isto, uma conta sozinha manda email do nosso domínio verificado para qualquer
// caixa de entrada, quantas vezes quiser — e ainda queima a cota de todo mundo.
//
// A janela por destinatário é o que impede encher a caixa de uma pessoa; o teto
// diário é o que impede espalhar por muitas. Os dois valem para os DOIS fluxos —
// convite de plataforma e aviso de grupo — e saem de `email_sent_at` (invites e
// group_invitations), sem tabela nova. O teto fica abaixo dos 100/dia do free
// tier para sobrar margem (a cota do Resend conta recebidos também).
// Os números moram em ./freios-de-envio, com o porquê de cada um — inclusive o
// do sub-teto que separa conveniência (agenda) de recuperação de conta (este
// arquivo). Aqui ficou só o uso.

/**
 * O teto diário vale para a instalação inteira, somando os TRÊS fluxos.
 *
 * A agenda entrou nesta soma junto com o freio dela. Enquanto ela ficava de
 * fora, este teto media meia realidade: os e-mails de calendário gastavam a
 * mesma cota do Resend e não apareciam em contagem nenhuma, então o convite
 * podia ser recusado por uma cota que ele achava livre — ou, pior, passar e
 * estourar de verdade no Resend.
 */
async function tetoDiarioAtingido(): Promise<boolean> {
  const [[plataforma], [grupo], agenda] = await Promise.all([
    db
      .select({ total: count() })
      .from(invites)
      .where(gt(invites.emailSentAt, sql`now() - make_interval(hours => ${JANELA_DIARIA_HORAS})`)),
    db
      .select({ total: count() })
      .from(groupInvitations)
      .where(
        gt(
          groupInvitations.emailSentAt,
          sql`now() - make_interval(hours => ${JANELA_DIARIA_HORAS})`,
        ),
      ),
    enviadosPelaAgendaNoDia(),
  ]);
  return plataforma.total + grupo.total + agenda >= TETO_DIARIO;
}

/**
 * Esta caixa de entrada já recebeu email nosso na janela por destinatário?
 *
 * Lê as duas tabelas porque o dedupe do aviso de grupo é por par (grupo,
 * jogador), e criar um grupo novo estreia um par novo: sem esta consulta,
 * quem cria grupo atrás de grupo alcança a mesma pessoa de novo a cada grupo,
 * e a janela que existe justamente para "impedir encher a caixa de uma
 * pessoa" não valeria para metade dos envios.
 *
 * Compara em memória, não em SQL: a forma canônica (ponto e +tag de Gmail, ver
 * email.ts) não vira um predicado simples sem duplicar a regra aqui dentro. O
 * conjunto é pequeno por construção — o teto diário o limita a 90 linhas.
 *
 * Os dois lados leem REGISTRO, não a conta: `invites.email` e
 * `group_invitations.email_sent_to` guardam para onde o e-mail foi de fato. Ler
 * `coalesce(users.email, users.contact_email)` ao vivo aqui seria um furo — o
 * contact_email é reescrito por qualquer um num request, então trocá-lo depois
 * de receber faria a linha antiga parar de resolver para aquela caixa, e uma
 * segunda conta apontada para ela passava pelo freio dentro da janela.
 *
 * O `coalesce` com `emailDeDestino()` é só a ponte: linha carimbada antes desta
 * coluna existir tem `email_sent_to` nulo, e sem ele os envios dos 10 minutos
 * anteriores ao deploy sumiriam do freio. Passada a janela ele nunca mais casa.
 */
async function destinatarioRecebeuHaPouco(para: string): Promise<boolean> {
  const [dePlataforma, deGrupo] = await Promise.all([
    db
      .select({ email: invites.email })
      .from(invites)
      .where(
        gt(
          invites.emailSentAt,
          sql`now() - make_interval(mins => ${JANELA_POR_DESTINATARIO_MIN})`,
        ),
      ),
    db
      .select({
        email: sql<
          string | null
        >`coalesce(${groupInvitations.emailSentTo}, ${emailDeDestino()})`,
      })
      .from(groupInvitations)
      .innerJoin(users, eq(users.playerId, groupInvitations.playerId))
      .where(
        gt(
          groupInvitations.emailSentAt,
          sql`now() - make_interval(mins => ${JANELA_POR_DESTINATARIO_MIN})`,
        ),
      ),
  ]);
  return [...dePlataforma, ...deGrupo].some(
    (linha) => linha.email !== null && mesmoEmail(linha.email, para),
  );
}

/** Traduz a resposta do transporte no motivo que a UI sabe explicar. */
function traduzirFalhaDeTransporte(
  motivo: "limite" | "rajada" | "recusado" | "indisponivel" | "nao-configurado",
): ResultadoEnvioDeConvite {
  // "limite" e "rajada" pedem mensagem própria (amanhã volta vs espere uns
  // segundos); o resto é falha genérica para o admin — o detalhe (recusado vs
  // indisponível) já ficou no log do transporte. `nao-configurado` não chega
  // aqui: a checagem no começo de cada fluxo já teria voltado.
  if (motivo === "limite") return { ok: false, motivo: "limite" };
  if (motivo === "rajada") return { ok: false, motivo: "rajada" };
  return { ok: false, motivo: "falha" };
}

async function motivoDeBloqueio(para: string): Promise<"envio-recente" | "limite" | null> {
  if (await destinatarioRecebeuHaPouco(para)) return "envio-recente";

  // Subcontagem conhecida: gerarConvite apaga a linha antiga antes de criar a
  // nova, então um reenvio seguido de "gerar convite novo" some do total. Serve
  // ao propósito mesmo assim — o caminho que precisa de teto (criar jogador
  // atrás de jogador) deixa cada linha para trás.
  return (await tetoDiarioAtingido()) ? "limite" : null;
}

export async function enviarConvitePorEmail(token: string): Promise<ResultadoEnvioDeConvite> {
  // Sem key nem toca o banco: é o modo preview/dev, e a action segue o fluxo de
  // sempre (criou o convite, ninguém prometeu email).
  if (!emailConfigurado()) return { ok: false, motivo: "nao-configurado" };

  const [convite] = await db
    .select({
      email: invites.email,
      expiresAt: invites.expiresAt,
      nome: players.name,
      // Convite para quem já tem conta é reset de acesso, não estreia — muda o
      // texto do email (ver emailDeResetDeAcesso).
      contaId: users.id,
    })
    .from(invites)
    .innerJoin(players, eq(players.id, invites.playerId))
    .leftJoin(users, eq(users.playerId, invites.playerId))
    .where(
      and(
        eq(invites.token, token),
        isNull(invites.usedAt),
        // Convite sem email é o legado de usuário e senha: não há destinatário.
        //
        // E não, o e-mail de contato da conta NÃO serve de reserva aqui — este
        // é o único e-mail que carrega o link de resgate, que vale por senha.
        // Mandá-lo para um endereço que ninguém verificou (o campo de contato é
        // digitado, pela pessoa ou pelo admin) entregaria a conta a quem
        // digitou. Quem não tem convite com e-mail recebe o link no WhatsApp,
        // como sempre foi.
        isNotNull(invites.email),
        gt(invites.expiresAt, sql`now()`),
      ),
    );
  // O filtro do select já garante o email; o `!convite.email` é para o TypeScript.
  if (!convite || !convite.email) return { ok: false, motivo: "convite-inelegivel" };

  const bloqueio = await motivoDeBloqueio(convite.email);
  if (bloqueio) return { ok: false, motivo: bloqueio };

  const modelo = convite.contaId === null ? emailDeConvitePlataforma : emailDeResetDeAcesso;
  const resultado = await enviarEmail({
    para: convite.email,
    ...modelo({
      nome: convite.nome,
      token,
      emailDeDestino: convite.email,
      expiraEm: convite.expiresAt,
    }),
  });

  if (resultado.ok) {
    // Best-effort de propósito: o email já saiu. Escrita não tem retentativa
    // (ver src/db/retry.ts), e deixar um tropeço de pool estourar aqui daria
    // tela de erro para um cadastro que deu certo — e um reenvio depois gastaria
    // outro email. O custo de falhar é o selo "e-mail enviado" não aparecer.
    await db
      .update(invites)
      .set({ emailSentAt: new Date() })
      .where(eq(invites.token, token))
      .catch((erro) => {
        console.error("[email-convite] não marcou email_sent_at:", erro);
      });
    return { ok: true };
  }
  return traduzirFalhaDeTransporte(resultado.motivo);
}

/**
 * O miolo do aviso de grupo: revalida no banco, aplica os freios e envia.
 *
 * São dois freios de janela, não um. `janelaMinutos` é o dedupe por par (grupo,
 * jogador) sobre `email_sent_at` — envio de fato, não criação de linha: uma
 * falha silenciosa não pode custar 24h de bloqueio. O disparo automático usa
 * 24h (revogar-e-reconvidar não vira loop de email na caixa de uma pessoa); o
 * botão de reenviar usa 10 min, a mesma confiança do "Reenviar e-mail" do admin
 * de plataforma. Por cima dele vem `destinatarioRecebeuHaPouco`, que é global
 * por caixa de entrada: é ele que fecha o contorno de criar um grupo novo para
 * estrear um par novo.
 */
async function enviarAvisoDeGrupo(
  groupId: number,
  invitationId: number,
  janelaMinutos: number,
): Promise<ResultadoEnvioDeConvite> {
  if (!emailConfigurado()) return { ok: false, motivo: "nao-configurado" };

  const [convite] = await db
    .select({
      playerId: groupInvitations.playerId,
      invitedByPlayerId: groupInvitations.invitedByPlayerId,
      // Verificado na frente, contato atrás — ver src/lib/email-destino.ts. É
      // esta linha que faz o aviso alcançar quem se cadastrou por usuário e
      // senha, que antes caía sempre em "convite-inelegivel".
      para: emailDeDestino(),
      nomeDoGrupo: groups.name,
      quemConvidou: players.name,
    })
    .from(groupInvitations)
    .innerJoin(groups, eq(groups.id, groupInvitations.groupId))
    // Só conta ativa recebe o aviso — sem conta não há como aceitar o convite.
    .innerJoin(
      users,
      and(eq(users.playerId, groupInvitations.playerId), eq(users.active, true)),
    )
    // Quem convidou pode ter sido apagado (FK set null) — o texto tem fallback.
    .leftJoin(players, eq(players.id, groupInvitations.invitedByPlayerId))
    .where(
      and(
        eq(groupInvitations.id, invitationId),
        // Escopo pelo grupo: no reenvio o id vem do cliente, e sem o filtro o
        // organizador de um grupo dispararia email pelo convite de outro.
        eq(groupInvitations.groupId, groupId),
        eq(groupInvitations.status, "pending"),
      ),
    );
  if (!convite || !convite.para) return { ok: false, motivo: "convite-inelegivel" };

  // Dedupe por envio de fato, em qualquer linha do par — inclusive a atual:
  // reenviar logo depois do disparo automático espera a janela passar.
  const [recente] = await db
    .select({ id: groupInvitations.id })
    .from(groupInvitations)
    .where(
      and(
        eq(groupInvitations.groupId, groupId),
        eq(groupInvitations.playerId, convite.playerId),
        gt(groupInvitations.emailSentAt, sql`now() - make_interval(mins => ${janelaMinutos})`),
      ),
    )
    .limit(1);
  if (recente) return { ok: false, motivo: "envio-recente" };

  // O dedupe acima é por par; este é por caixa de entrada, atravessando grupo e
  // fluxo. Sem ele, 20 grupos novos = 20 emails para a mesma pessoa em segundos.
  if (await destinatarioRecebeuHaPouco(convite.para)) {
    return { ok: false, motivo: "envio-recente" };
  }

  if (convite.invitedByPlayerId !== null) {
    const [porConvidante] = await db
      .select({ total: count() })
      .from(groupInvitations)
      .where(
        and(
          eq(groupInvitations.invitedByPlayerId, convite.invitedByPlayerId),
          gt(
            groupInvitations.emailSentAt,
            sql`now() - make_interval(hours => ${JANELA_DIARIA_HORAS})`,
          ),
        ),
      );
    if (porConvidante.total >= TETO_POR_CONVIDANTE_DIA) {
      return { ok: false, motivo: "limite-do-convidante" };
    }
  }

  if (await tetoDiarioAtingido()) return { ok: false, motivo: "limite" };

  const resultado = await enviarEmail({
    para: convite.para,
    ...emailDeAvisoDeGrupo({
      nomeDoGrupo: convite.nomeDoGrupo,
      quemConvidou: convite.quemConvidou ?? "Alguém do grupo",
    }),
  });

  if (resultado.ok) {
    // Best-effort pelo mesmo motivo do fluxo de plataforma: o email já saiu, e
    // o custo de falhar é o selo não aparecer (e um reenvio manual possível).
    await db
      .update(groupInvitations)
      // O endereço vai junto do carimbo: é ele que a janela por caixa de
      // entrada lê depois, e reler a conta mais tarde deixaria o freio à mercê
      // de quem reescreve o próprio contact_email.
      .set({ emailSentAt: new Date(), emailSentTo: convite.para })
      .where(eq(groupInvitations.id, invitationId))
      .catch((erro) => {
        console.error("[email-convite] não marcou email_sent_at do aviso de grupo:", erro);
      });
    return { ok: true };
  }
  return traduzirFalhaDeTransporte(resultado.motivo);
}

/**
 * O botão "Reenviar e-mail" da tela de gerenciar grupo. Inline (a action espera
 * e traduz o resultado em banner via redirectPosEnvio), janela de 10 min por
 * par — a janela global por destinatário continua valendo por cima.
 */
export function reenviarAvisoDeGrupo(
  groupId: number,
  invitationId: number,
): Promise<ResultadoEnvioDeConvite> {
  return enviarAvisoDeGrupo(groupId, invitationId, JANELA_POR_DESTINATARIO_MIN);
}

/**
 * Aviso do convite nominal de grupo, agendado para depois da resposta.
 *
 * O envio é redundante com a notificação in-app — se o email falhar, o convite
 * continua visível e respondível dentro do app —, então a action não espera por
 * ele. Mas o resultado não é descartado: falha vira log (e o par fica sem
 * `email_sent_at`, o que acende o selo "e-mail não saiu" na tela de gerenciar,
 * ao lado do "Reenviar e-mail" que fica sempre disponível). O
 * `after()` mora aqui, e não na action, pelo mesmo motivo de
 * `agendarProcessamento` em pendencias.ts: quem chama não precisa saber de
 * agendamento nem de `.catch`.
 *
 * O callback **retorna** a promessa: `after` a entrega ao `waitUntil` da Vercel,
 * e um callback que devolve `undefined` deixa a invocação ser congelada com o
 * fetch ainda no ar (ver next/dist/server/after/after-context.js).
 */
export function agendarAvisoDeConviteDeGrupo(groupId: number, invitationId: number): void {
  if (!emailConfigurado()) return;

  after(async () => {
    try {
      const resultado = await enviarAvisoDeGrupo(groupId, invitationId, JANELA_DIARIA_HORAS * 60);
      // "envio-recente" é o dedupe fazendo o trabalho dele, não um problema.
      if (!resultado.ok && resultado.motivo !== "envio-recente") {
        console.error("[email-convite] aviso de grupo não saiu:", {
          invitationId,
          motivo: resultado.motivo,
        });
      }
    } catch (erro) {
      // O `.catch` é obrigatório: uma rejeição não tratada dentro do `after`
      // derruba o log da request inteira (ver src/lib/pendencias.ts).
      console.error("[email-convite] aviso de grupo falhou:", erro);
    }
  });
}
