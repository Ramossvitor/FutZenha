import "server-only";
import { sql } from "drizzle-orm";
import { games, matchDays } from "@/db/schema";

/**
 * O instante em que a bola rola.
 *
 * Existe pelo mesmo motivo do FIM_DA_JANELA_CORRECAO (src/lib/janela-correcao.ts):
 * duas coisas precisam concordar sobre ele — a tela do fut, que decide mostrar
 * ou esconder o botão de armar o multiplicador, e a action, que decide aceitar
 * ou recusar. Enquanto forem duas expressões, um lado oferece o que o outro
 * recusa.
 *
 * É o corte do antiabuso do multiplicador. O problema que ele resolve: o fut
 * costuma ser encerrado horas depois de acabar fisicamente, então quem esperasse
 * o encerramento para armar já saberia como jogou — e uma aposta cujo resultado
 * se conhece antes de apostar não é aposta.
 *
 * `start_time` nulo vira meia-noite, de propósito conservador: sem horário
 * marcado, o dia inteiro do fut já é "depois da bola rolar". Isso fecha a janela
 * cedo demais em vez de tarde demais, que é o lado certo de errar aqui.
 *
 * ── Sobre o fuso ───────────────────────────────────────────────────────────
 * O fuso entra como LITERAL dentro do template, nunca interpolado de uma
 * constante do TypeScript. O drizzle transforma toda interpolação em parâmetro
 * ligado, e `timestamp AT TIME ZONE $1` é AMBÍGUO no Postgres (existe
 * `timezone(text, timestamp)` e `timezone(interval, timestamp)`), então a query
 * falharia em runtime. Pior: dentro de processarPendencias ela falharia em
 * SILÊNCIO, porque o `after()` só faz `console.error` — e levaria junto o
 * fechamento de rodada por prazo e o lembrete de véspera.
 *
 * `date + time` devolve `timestamp` sem fuso; o `at time zone` o ancora e
 * devolve `timestamptz`, que é o tipo de `armado_em` e `corte_previsto` no
 * schema. A comparação com `now()` fica correta em qualquer fuso de sessão.
 */
export const KICKOFF_DO_FUT = sql`((${matchDays.date} + coalesce(${matchDays.startTime}, time '00:00')) at time zone 'America/Sao_Paulo')`;

/** Meia-noite do dia do fut, ancorada no mesmo fuso. */
const MEIA_NOITE_DO_FUT = sql`(${matchDays.date}::timestamp at time zone 'America/Sao_Paulo')`;

/**
 * A bola já rolou HOJE, segundo a testemunha independente.
 *
 * O horário marcado não é a única coisa que fecha a janela: `PRIMEIRO_SINAL_DE_BOLA`
 * também a fecha, e antes, quando alguém lança o primeiro jogo mais cedo. A
 * súmula ao vivo abre em `teams_drawn` e não confere relógio nenhum
 * (src/lib/sumula.ts: `sumulaDisponivel` só olha o status), então um jogo pode
 * nascer no dia do fut ANTES do kickoff marcado — e nasce, quando o fut começa
 * adiantado.
 *
 * Sem esta condição, `armar` aceitaria às 19h45 um arme que a liquidação depois
 * anularia como `corte-antecipado`, culpando uma antecipação de horário que
 * nunca houve. É exatamente a divergência que o KICKOFF_DO_FUT existe para
 * impedir, e o lado certo de resolvê-la é a oferta seguir a testemunha, nunca a
 * testemunha afrouxar para caber na oferta: quem já viu a bola rolar não pode
 * mais apostar.
 *
 * `>= MEIA_NOITE_DO_FUT` pelo mesmo motivo do `greatest` de
 * `PRIMEIRO_SINAL_DE_BOLA`: jogo lançado em dias anteriores não é sinal de nada
 * e não pode envenenar a janela.
 */
export const BOLA_JA_ROLOU_HOJE = sql`exists (
  select 1 from ${games}
  where ${games.matchDayId} = ${matchDays.id}
    and (${games.createdAt} at time zone 'UTC') >= ${MEIA_NOITE_DO_FUT}
)`;

/**
 * A primeira evidência de que o fut começou de verdade.
 *
 * O corte combinado no arme (`corte_previsto`) e o horário marcado podem os dois
 * estar errados — o admin adia, antecipa, ou nunca preencheu o horário. Esta é a
 * testemunha independente: o instante em que alguém lançou o primeiro jogo.
 *
 * `games.created_at`, e NÃO `games.started_at`: o `started_at` só é gravado no
 * fluxo da súmula ao vivo (src/lib/jogos.ts) e fica NULL no fluxo clássico, que
 * é o comum — usá-lo daria testemunha nula quase sempre.
 *
 * O `greatest` com a meia-noite do fut é o que impede envenenar a testemunha:
 * sem ele, criar um jogo dias antes puxaria o corte para trás e invalidaria o
 * arme de quem fez tudo certo.
 *
 * `at time zone 'UTC'` em `created_at` porque a coluna é `timestamp` sem fuso,
 * gravada por `now()` numa sessão UTC — é assim que o resto do schema guarda
 * tempo. Sem o âncora, o `greatest` misturaria `timestamp` com `timestamptz`.
 */
export const PRIMEIRO_SINAL_DE_BOLA = sql`greatest(
  ${MEIA_NOITE_DO_FUT},
  coalesce(
    (select min(${games.createdAt}) at time zone 'UTC'
       from ${games} where ${games.matchDayId} = ${matchDays.id}),
    ${MEIA_NOITE_DO_FUT}
  )
)`;
