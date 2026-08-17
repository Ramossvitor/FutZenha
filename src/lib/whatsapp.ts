// Textos prontos para o admin (ou qualquer membro) colar no grupo de WhatsApp.
//
// Este é o canal "oficial" do fut desde sempre — o que o app faz é montar a
// mensagem, não enviá-la: nada de API da Meta, número dedicado ou telefone
// cadastrado. Puro e sem `server-only` de propósito, como email-modelos.ts: o
// texto da convocação nasce no servidor, mas o botão que o compartilha é um
// Client Component e o módulo precisa ser importável dos dois lados.
import { formatDate, formatTime } from "@/lib/format";
import { textoDePrazo } from "@/lib/prazo";

export type FutParaConvocar = {
  id: number;
  date: string;
  startTime: string | null;
  location: string;
  notes: string | null;
};

export function textoDeConvocacao(matchDay: FutParaConvocar, urlBase: string): string {
  const hora = formatTime(matchDay.startTime);
  const linhas = [
    `⚽ Fut ${formatDate(matchDay.date)}${hora ? ` às ${hora}` : ""}`,
    `📍 ${matchDay.location}`,
  ];
  if (matchDay.notes) linhas.push(matchDay.notes);
  linhas.push("", `Confirma presença: ${urlBase}/fut/${matchDay.id}`);
  return linhas.join("\n");
}

export type TimeParaCompartilhar = { nome: string; jogadores: string[] };

export function textoDeTimes(
  matchDay: { date: string },
  times: TimeParaCompartilhar[],
): string {
  const blocos = times.map(
    (t) => [`${t.nome}:`, ...t.jogadores.map((j) => `- ${j}`)].join("\n"),
  );
  return [`⚽ Times do fut de ${formatDate(matchDay.date)}`, "", blocos.join("\n\n")].join("\n");
}

export type AvaliacaoParaCobrar = {
  roundId: number;
  date: string;
  location: string;
  /** Já calculado no Postgres, como todo prazo do produto (ver lib/prazo.ts). */
  horasRestantes: number;
  total: number;
  /** Rótulos (apelido, ou nome) de quem ainda não avaliou. */
  faltam: string[];
};

/**
 * A cobrança da avaliação, com nome de quem está devendo.
 *
 * O link exige login e a rodada só abre para quem está no roster congelado
 * (ratingRoundRaters), então colá-lo no grupo não expõe nada: quem não jogou
 * cai num 404.
 */
export function textoDeCobrancaDeAvaliacao(
  rodada: AvaliacaoParaCobrar,
  urlBase: string,
): string {
  const cobranca =
    rodada.faltam.length === 0
      ? `Todos os ${rodada.total} já avaliaram 🎉`
      : `Falta a nota de ${rodada.faltam.length} dos ${rodada.total}: ${rodada.faltam.join(", ")}`;

  return [
    `⭐ Avaliação do fut de ${formatDate(rodada.date)}`,
    `📍 ${rodada.location}`,
    "",
    cobranca,
    `⏳ ${textoDePrazo(rodada.horasRestantes)} para o prazo`,
    "",
    `Avalia aí: ${urlBase}/avaliar/${rodada.roundId}`,
  ].join("\n");
}

// O wa.me sem número abre o WhatsApp com a mensagem pronta e deixa a pessoa
// escolher a conversa — exatamente o fluxo "cola no grupo".
export function linkWaMe(texto: string): string {
  return `https://wa.me/?text=${encodeURIComponent(texto)}`;
}
