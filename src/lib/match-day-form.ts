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
/**
 * Até onde a data do fut pode recuar e avançar.
 *
 * O passado é o que importa: a ordem dos futs é a ordem do replay da nota
 * (skill.ts ordena por `matchDayDate`) e é sobre ela que a sequência de
 * presenças da zenha é contada. Sem teto, marcar um fut "de três meses atrás"
 * reescreve as duas coisas de uma vez. Uma semana cobre o caso honesto — o
 * organizador que lança o fut de sábado na segunda — e fecha o resto.
 *
 * O futuro tem teto só para o campo não virar porta de número absurdo.
 */
export const MAX_DIAS_RETROATIVOS_DO_FUT = 7;
export const MAX_DIAS_FUTUROS_DO_FUT = 365;

/**
 * A data de hoje no fuso do fut, como "YYYY-MM-DD".
 *
 * Recebe o instante em vez de chamar `new Date()` lá dentro para o teste poder
 * cravar o dia. Este `Date` só existe para COMPARAR com a string do formulário
 * — nunca entra em template `sql` cru, onde o driver o rejeitaria.
 */
export function hojeNoFusoDoFut(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

// Dias inteiros entre duas datas "YYYY-MM-DD", positivo quando `b` é depois.
// Compara ao meio-dia UTC para o horário de verão nunca virar meio dia a mais.
function diasEntre(a: string, b: string): number {
  const meioDia = (d: string) => Date.parse(`${d}T12:00:00Z`);
  return Math.round((meioDia(b) - meioDia(a)) / 86_400_000);
}

const criarMatchDaySchema = (hoje: string, dataAtual: string | null) =>
  z
  .object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida")
    // Os limites valem para REMARCAR, não para editar. Quando o formulário
    // devolve exatamente a data que o fut já tem, eles não se aplicam: quem
    // está corrigindo o local de um fut de mês passado não pode esbarrar num
    // limite que existe para impedir mover o fut no tempo.
    .refine((d) => d === dataAtual || diasEntre(d, hoje) <= MAX_DIAS_RETROATIVOS_DO_FUT, {
      message: `A data não pode ser mais de ${MAX_DIAS_RETROATIVOS_DO_FUT} dias no passado.`,
    })
    .refine((d) => d === dataAtual || diasEntre(hoje, d) <= MAX_DIAS_FUTUROS_DO_FUT, {
      message: "A data não pode ser mais de um ano à frente.",
    }),
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

export type OpcoesDoParse = {
  /** Hoje no fuso do fut, como "YYYY-MM-DD". Entra por fora para o teste cravar o dia. */
  hoje?: string;
  /**
   * A data que o fut JÁ tem, quando se está editando. Devolver exatamente ela
   * dispensa os limites de faixa — ver o comentário no schema. Nulo (o padrão)
   * é o caso de criação, onde não há data anterior e os limites sempre valem.
   */
  dataAtual?: string | null;
};

export function parseMatchDayForm(formData: FormData, opcoes: OpcoesDoParse = {}) {
  const { hoje = hojeNoFusoDoFut(), dataAtual = null } = opcoes;
  return criarMatchDaySchema(hoje, dataAtual).safeParse({
    date: formData.get("date") ?? "",
    startTime: formData.get("startTime") ?? "",
    endTime: formData.get("endTime") ?? "",
    location: formData.get("location") ?? "",
    notes: formData.get("notes") ?? "",
    maxPlayers: formData.get("maxPlayers") ?? "",
  });
}
