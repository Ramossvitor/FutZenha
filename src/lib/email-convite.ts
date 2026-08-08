import "server-only";
import { after } from "next/server";
import { and, count, eq, gt, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { groupInvitations, invites, players, users } from "@/db/schema";
import { emailConfigurado, enviarEmail } from "./email-envio";
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
// chegou. Recebe só o token de propósito: a revalidação (convite ainda pendente,
// não expirado, com email) mora aqui e vale igual para o disparo automático do
// cadastro e para o botão de reenviar — o call site fica com uma linha.
//
// Sem guard, como convites.ts: quem autoriza é a action.

export type ResultadoEnvioDeConvite =
  | { ok: true }
  | {
      ok: false;
      motivo: "nao-configurado" | "convite-inelegivel" | "envio-recente" | "limite" | "falha";
    };

// Freio de mão do envio. Não é otimização de cota: qualquer jogador logado cria
// uma pelada avulsa e vira admin dela (ver createMatchDay), e daí alcança
// convidarParaPelada/reenviarConviteDaPelada com nome e endereço à escolha. Sem
// isto, uma conta sozinha manda email do nosso domínio verificado para qualquer
// caixa de entrada, quantas vezes quiser — e ainda queima a cota de todo mundo.
//
// A janela por destinatário é o que impede encher a caixa de uma pessoa; o teto
// diário é o que impede espalhar por muitas. Os dois saem de `email_sent_at`,
// sem tabela nova. O teto fica abaixo dos 100/dia do free tier para sobrar
// margem para os avisos de grupo, que não passam por aqui.
const JANELA_POR_DESTINATARIO_MIN = 10;
const JANELA_DIARIA_HORAS = 24;
const TETO_DIARIO = 90;

async function motivoDeBloqueio(para: string): Promise<"envio-recente" | "limite" | null> {
  const [recente] = await db
    .select({ id: invites.id })
    .from(invites)
    .where(
      and(
        eq(invites.email, para),
        gt(invites.emailSentAt, sql`now() - make_interval(mins => ${JANELA_POR_DESTINATARIO_MIN})`),
      ),
    )
    .limit(1);
  if (recente) return "envio-recente";

  // Subcontagem conhecida: gerarConvite apaga a linha antiga antes de criar a
  // nova, então um reenvio seguido de "gerar convite novo" some do total. Serve
  // ao propósito mesmo assim — o caminho que precisa de teto (criar jogador
  // atrás de jogador) deixa cada linha para trás.
  const [{ total }] = await db
    .select({ total: count() })
    .from(invites)
    .where(gt(invites.emailSentAt, sql`now() - make_interval(hours => ${JANELA_DIARIA_HORAS})`));
  return total >= TETO_DIARIO ? "limite" : null;
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
  // "limite" pede mensagem própria (amanhã volta); o resto é falha genérica para
  // o admin — o detalhe (recusado vs indisponível) já ficou no log do transporte.
  // `nao-configurado` não chega aqui: a checagem lá em cima já teria voltado.
  if (resultado.motivo === "limite") return { ok: false, motivo: "limite" };
  return { ok: false, motivo: "falha" };
}

/**
 * Aviso do convite nominal de grupo, agendado para depois da resposta.
 *
 * Fire-and-forget deliberado: é redundante com a notificação in-app — se o email
 * falhar, o convite continua visível e respondível dentro do app. O `after()`
 * mora aqui, e não na action, pelo mesmo motivo de `agendarProcessamento` em
 * pendencias.ts: quem chama não precisa saber de agendamento nem de `.catch`.
 *
 * O callback **retorna** a promessa: `after` a entrega ao `waitUntil` da Vercel,
 * e um callback que devolve `undefined` deixa a invocação ser congelada com o
 * fetch ainda no ar (ver next/dist/server/after/after-context.js).
 */
export function agendarAvisoDeConviteDeGrupo(dados: {
  invitationId: number;
  groupId: number;
  playerId: number;
  para: string;
  nomeDoGrupo: string;
  quemConvidou: string;
}): void {
  if (!emailConfigurado()) return;

  after(async () => {
    try {
      // Revogar libera o índice parcial de pendente, então revogar-e-reconvidar
      // seria um loop de email na caixa de uma pessoa. O histórico das linhas
      // anteriores é o único freio que existe — a atual é excluída pelo id.
      const [anterior] = await db
        .select({ id: groupInvitations.id })
        .from(groupInvitations)
        .where(
          and(
            eq(groupInvitations.groupId, dados.groupId),
            eq(groupInvitations.playerId, dados.playerId),
            ne(groupInvitations.id, dados.invitationId),
            gt(
              groupInvitations.createdAt,
              sql`now() - make_interval(hours => ${JANELA_DIARIA_HORAS})`,
            ),
          ),
        )
        .limit(1);
      if (anterior) return;

      await enviarEmail({
        para: dados.para,
        ...emailDeAvisoDeGrupo({
          nomeDoGrupo: dados.nomeDoGrupo,
          quemConvidou: dados.quemConvidou,
        }),
      });
    } catch (erro) {
      // O `.catch` é obrigatório: uma rejeição não tratada dentro do `after`
      // derruba o log da request inteira (ver src/lib/pendencias.ts).
      console.error("[email-convite] aviso de grupo falhou:", erro);
    }
  });
}
