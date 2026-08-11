// Textos prontos para o admin (ou qualquer membro) colar no grupo de WhatsApp.
//
// Este é o canal "oficial" da pelada desde sempre — o que o app faz é montar a
// mensagem, não enviá-la: nada de API da Meta, número dedicado ou telefone
// cadastrado. Puro e sem `server-only` de propósito, como email-modelos.ts: o
// texto da convocação nasce no servidor, mas o botão que o compartilha é um
// Client Component e o módulo precisa ser importável dos dois lados.
import { formatDate, formatTime } from "@/lib/format";

export type PeladaParaConvocar = {
  id: number;
  date: string;
  startTime: string | null;
  location: string;
  notes: string | null;
};

export function textoDeConvocacao(matchDay: PeladaParaConvocar, urlBase: string): string {
  const hora = formatTime(matchDay.startTime);
  const linhas = [
    `⚽ Pelada ${formatDate(matchDay.date)}${hora ? ` às ${hora}` : ""}`,
    `📍 ${matchDay.location}`,
  ];
  if (matchDay.notes) linhas.push(matchDay.notes);
  linhas.push("", `Confirma presença: ${urlBase}/pelada/${matchDay.id}`);
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
  return [`⚽ Times da pelada de ${formatDate(matchDay.date)}`, "", blocos.join("\n\n")].join("\n");
}

// O wa.me sem número abre o WhatsApp com a mensagem pronta e deixa a pessoa
// escolher a conversa — exatamente o fluxo "cola no grupo".
export function linkWaMe(texto: string): string {
  return `https://wa.me/?text=${encodeURIComponent(texto)}`;
}
