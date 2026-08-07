import { z } from "zod";
import type { matchDayStatusEnum } from "@/db/schema";

export type StatusPelada = (typeof matchDayStatusEnum.enumValues)[number];

/**
 * O rótulo de cada estado da pelada.
 *
 * Havia três cópias disto espalhadas — duas capitalizadas e a de
 * /admin/peladas em caixa baixa —, então a mesma pelada aparecia como "Times
 * sorteados" numa tela e "times sorteados" na outra.
 */
export const STATUS_PELADA: Record<StatusPelada, string> = {
  scheduled: "Marcada",
  teams_drawn: "Times sorteados",
  finished: "Encerrada",
};

// Compartilhado entre criar (/peladas/nova) e editar (/pelada/[id]/gerenciar):
// os dois formulários têm os mesmos campos, e duplicar o schema deixaria as
// validações divergirem na primeira mudança.
//
// `groupId` NÃO está aqui de propósito, e é o que torna o grupo da pelada
// imutável: `createMatchDay` lê o campo à parte, depois de conferir o papel de
// quem cria, e `updateMatchDay` — que usa este mesmo parse — simplesmente não
// tem como recebê-lo. Mover uma pelada encerrada entre grupos reescreveria dois
// rankings de uma vez, sem replay nenhum.
const matchDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
  startTime: z.string().transform((v) => (v === "" ? null : v)),
  location: z.string().trim().min(1, "Local é obrigatório").max(120),
  notes: z
    .string()
    .trim()
    .max(500)
    .transform((v) => (v === "" ? null : v)),
});

export function parseMatchDayForm(formData: FormData) {
  return matchDaySchema.safeParse({
    date: formData.get("date") ?? "",
    startTime: formData.get("startTime") ?? "",
    location: formData.get("location") ?? "",
    notes: formData.get("notes") ?? "",
  });
}
