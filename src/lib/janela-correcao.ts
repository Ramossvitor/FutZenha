import "server-only";
import { sql } from "drizzle-orm";
import { matchDays } from "@/db/schema";
import { JANELA_CORRECAO_HORAS } from "./regras";

/**
 * O instante em que a janela de correção de placar e gols fecha.
 *
 * Uma expressão só porque ela decide DUAS coisas que precisam concordar: se o
 * painel mostra o formulário de correção e o selo de prazo
 * (`segundosDeJanela`, em gerenciar/dados.ts) e se a action aceita a edição
 * (`assertPlacarEditavel`, em gerenciar/actions.ts). Enquanto eram duas
 * expressões com o `interval '24 hours'` cravado em cada uma, mudar
 * JANELA_CORRECAO_HORAS num lado só dava painel oferecendo o que o servidor
 * recusa — ou o contrário.
 *
 * Não mora no actions.ts porque aquele arquivo é `"use server"`: lá só se
 * exporta função async.
 */
export const FIM_DA_JANELA_CORRECAO = sql`${matchDays.finishedAt} + make_interval(hours => ${JANELA_CORRECAO_HORAS}::int)`;
