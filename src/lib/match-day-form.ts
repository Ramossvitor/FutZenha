import { z } from "zod";
import type { matchDayStatusEnum } from "@/db/schema";
import { DURACAO_MAX_MIN, DURACAO_MIN_MIN, duracaoDoFut } from "@/lib/agenda";

export type StatusFut = (typeof matchDayStatusEnum.enumValues)[number];

/**
 * O rótulo de cada estado do fut.
 *
 * Havia três cópias disto espalhadas — duas capitalizadas e a de
 * /admin/futs em caixa baixa —, então o mesmo fut aparecia como "Times
 * sorteados" numa tela e "times sorteados" na outra.
 */
export const STATUS_FUT: Record<StatusFut, string> = {
  scheduled: "Marcado",
  teams_drawn: "Times sorteados",
  finished: "Encerrado",
};

// Compartilhado entre criar (/futs/novo) e editar (/fut/[id]/gerenciar):
// os dois formulários têm os mesmos campos, e duplicar o schema deixaria as
// validações divergirem na primeira mudança.
//
// `groupId` NÃO está aqui de propósito, e é o que torna o grupo do fut
// imutável: `createMatchDay` lê o campo à parte, depois de conferir o papel de
// quem cria, e `updateMatchDay` — que usa este mesmo parse — simplesmente não
// tem como recebê-lo. Mover um fut encerrado entre grupos reescreveria dois
// rankings de uma vez, sem replay nenhum.
const matchDaySchema = z
  .object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
  startTime: z.string().transform((v) => (v === "" ? null : v)),
  // Vazio = 1h no evento de agenda (DURACAO_PADRAO_MIN), que é o que todo fut
  // anterior a este campo tinha. As regras de duração ficam no superRefine
  // abaixo, porque dependem do horário de início.
  endTime: z.string().transform((v) => (v === "" ? null : v)),
  location: z.string().trim().min(1, "Local é obrigatório").max(120),
  notes: z
    .string()
    .trim()
    .max(500)
    .transform((v) => (v === "" ? null : v)),
  // Quantos cabem. Vazio vira null = sem limite, que é o padrão e o
  // comportamento de todo fut anterior à lista de espera. O piso é 2 porque
  // abaixo disso não há sorteio possível; o teto é folga para quadra grande,
  // e existe só para o campo não virar porta de número absurdo.
  maxPlayers: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 2 && v <= 60), {
      message: "Vagas: deixe vazio ou informe um número de 2 a 60",
    }),
  })
  // Duração é validação cruzada, daí o superRefine no objeto e não no campo.
  // O espelho desta regra é o match_days_duracao_check em src/db/schema.ts: aqui
  // sai a mensagem para quem preencheu, lá fica a garantia de que nenhum caminho
  // — action nova, SQL na mão — grava um fut que toma o dia de quem confirmou.
  .superRefine((dados, ctx) => {
    if (dados.endTime === null) return;
    if (dados.startTime === null) {
      ctx.addIssue({
        code: "custom",
        path: ["endTime"],
        message: "Informe o horário de início para definir o término",
      });
      return;
    }
    const duracao = duracaoDoFut(dados.startTime, dados.endTime);
    if (duracao < DURACAO_MIN_MIN || duracao > DURACAO_MAX_MIN) {
      ctx.addIssue({
        code: "custom",
        path: ["endTime"],
        message: "O fut deve durar de 30 minutos a 6 horas",
      });
    }
  });

export function parseMatchDayForm(formData: FormData) {
  return matchDaySchema.safeParse({
    date: formData.get("date") ?? "",
    startTime: formData.get("startTime") ?? "",
    endTime: formData.get("endTime") ?? "",
    location: formData.get("location") ?? "",
    notes: formData.get("notes") ?? "",
    maxPlayers: formData.get("maxPlayers") ?? "",
  });
}
