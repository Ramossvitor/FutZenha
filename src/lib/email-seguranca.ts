import "server-only";
import { after } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { players, users } from "@/db/schema";
import { emailDeDestino } from "./email-destino";
import { emailConfigurado, enviarEmail } from "./email-envio";
import { emailDeGoogleVinculado, emailDeSenhaAlterada } from "./email-modelos";

// Os avisos de que uma credencial mudou. Família `email-*`: o transporte é
// ./email-envio, o conteúdo é ./email-modelos, e este junta os dois com o banco.
//
// ---------------------------------------------------------------------------
// Por que estes dois não passam pela caixa de entrada
// ---------------------------------------------------------------------------
//
// Todos os outros avisos do projeto nascem em `notifications` e o e-mail é
// aceleração (ver ./email-avisos). Estes dois não, e a razão é o que eles
// existem para cobrir: quem trocou a senha está na tela e já viu a confirmação;
// o e-mail serve para alcançar quem NÃO estava — a pessoa cuja conta foi
// tomada. Para ela, a caixa de entrada do app é exatamente o lugar onde não vai
// olhar, e pode nem ser mais alcançável (a troca derrubou a sessão dela).
//
// Não ter linha em `notifications` também significa não ter dedupe: se a ação
// acontecer duas vezes, saem dois e-mails. É o comportamento certo aqui — duas
// trocas de senha SÃO dois fatos de segurança, e agrupá-las esconderia a
// segunda.
//
// Sempre por `after()`, nunca inline: o e-mail não pode atrasar a resposta de
// quem trocou a credencial, e muito menos derrubá-la. `enviarEmail` já não lança.

/** Nome e endereço de quem teve a credencial mexida. Nulo = não há para onde mandar. */
async function destino(
  userId: number,
): Promise<{ nome: string; para: string } | null> {
  const [linha] = await db
    .select({
      // O apelido na frente, como no resumo do fut: é como a pessoa é chamada.
      // `coalesce` até o fim porque conta sem player não deveria existir, mas um
      // e-mail de segurança não é o lugar de descobrir isso com um crash.
      nome: players.name,
      apelido: players.nickname,
      para: emailDeDestino(),
    })
    .from(users)
    .leftJoin(players, eq(players.id, users.playerId))
    .where(eq(users.id, userId));

  if (!linha?.para) return null;
  return { nome: linha.apelido ?? linha.nome ?? "", para: linha.para };
}

/**
 * Avisa que a senha desta conta mudou.
 *
 * `quando` vem de fora — é o instante do FATO, e não o de quando o `after`
 * rodar. A diferença é pequena e a precisão importa: é por esse horário que a
 * pessoa decide se reconhece a própria ação.
 */
export function agendarAvisoDeSenhaAlterada(userId: number, quando: Date): void {
  if (!emailConfigurado()) return;
  after(async () => {
    try {
      const alvo = await destino(userId);
      // Conta sem endereço nenhum simplesmente não recebe — como em todo fluxo
      // que passa pelo `emailDeDestino`.
      if (!alvo) return;
      const resultado = await enviarEmail({
        para: alvo.para,
        ...emailDeSenhaAlterada({ nome: alvo.nome, quando }),
      });
      if (!resultado.ok) {
        console.error("[email-seguranca] aviso de senha alterada não saiu:", {
          userId,
          motivo: resultado.motivo,
        });
      }
    } catch (erro) {
      // Obrigatório: rejeição não tratada dentro do `after` derruba o log da
      // request inteira (ver src/lib/pendencias.ts).
      console.error("[email-seguranca] aviso de senha alterada falhou:", erro);
    }
  });
}

/**
 * Avisa que uma conta Google passou a abrir esta conta.
 *
 * Roda no caminho do OAuth, que termina em redirect — por isso o callback do
 * `after` **retorna** a promessa: um callback que devolve `undefined` deixa a
 * invocação ser congelada com o fetch ainda no ar (ver o mesmo cuidado em
 * `agendarAvisoDeConviteDeGrupo`).
 *
 * ---------------------------------------------------------------------------
 * Por que este é o único que manda para DOIS endereços
 * ---------------------------------------------------------------------------
 *
 * Vincular grava `users.email = <endereço do Google>`, e `emailDeDestino` é um
 * `coalesce(email, contact_email)` — um endereço só. Então, depois do vínculo, o
 * destino da conta É o endereço recém-vinculado, e mandar só para lá entrega o
 * aviso de segurança a quem acabou de mexer na credencial e a mais ninguém.
 *
 * No caso que importa isso é exatamente o avesso do propósito. O vínculo é
 * pedido de dentro do /perfil e quem manda é a sessão atual
 * (`pendente.link = session.userId`); numa sessão tomada, quem vincula é o
 * invasor, e o dono legítimo — cujo `contact_email` era o destino até um
 * instante atrás — não fica sabendo de nada. `paraTambem` é esse destino
 * anterior, lido por `vincularAConta` ANTES do UPDATE, porque depois ele não
 * existe mais.
 *
 * Dois envios, e não um `to` com os dois: um e-mail só entregaria a cada lado o
 * endereço do outro, e um deles é potencialmente um invasor.
 */
export function agendarAvisoDeGoogleVinculado(
  userId: number,
  emailVinculado: string,
  quando: Date,
  paraTambem: string | null,
): void {
  if (!emailConfigurado()) return;
  after(async () => {
    try {
      const alvo = await destino(userId);
      if (!alvo) return;
      // `Set` porque o caso comum é os dois serem o mesmo endereço: quem já
      // tinha aquele e-mail na conta e só agora ligou o Google dele.
      const enderecos = new Set([alvo.para, ...(paraTambem === null ? [] : [paraTambem])]);
      const conteudo = emailDeGoogleVinculado({ nome: alvo.nome, emailVinculado, quando });
      for (const para of enderecos) {
        const resultado = await enviarEmail({ para, ...conteudo });
        if (!resultado.ok) {
          console.error("[email-seguranca] aviso de Google vinculado não saiu:", {
            userId,
            motivo: resultado.motivo,
          });
        }
      }
    } catch (erro) {
      console.error("[email-seguranca] aviso de Google vinculado falhou:", erro);
    }
  });
}
