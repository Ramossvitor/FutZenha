import { describe, expect, it } from "vitest";
import {
  DURACAO_PADRAO_MIN,
  icsDeConvite,
  icsParaBaixar,
  uidDoConvite,
  urlGoogleAgenda,
  urlOutlookAgenda,
  type FutParaAgenda,
} from "./agenda";

const AGORA = new Date("2026-08-19T12:00:00Z");
const URL_BASE = "https://futzenha.com.br";
const FUT: FutParaAgenda = {
  id: 7,
  date: "2026-08-22",
  startTime: "20:00:00",
  location: "Society do Zé",
  notes: null,
};
const ORGANIZADOR = { nome: "FutZenha", email: "convite@futzenha.com.br" };
const CONVIDADO = { playerId: 3, nome: "Vitor", email: "vitor@example.com" };

function convite(
  extra: { fut?: Partial<FutParaAgenda>; metodo?: "REQUEST" | "CANCEL"; sequence?: number } = {},
): string {
  return icsDeConvite({
    fut: { ...FUT, ...extra.fut },
    urlBase: URL_BASE,
    metodo: extra.metodo ?? "REQUEST",
    sequence: extra.sequence ?? 2,
    agora: AGORA,
    organizador: ORGANIZADOR,
    convidado: CONVIDADO,
  });
}

/** As linhas do .ics já desdobradas — é assim que um cliente as lê. */
function linhasDesdobradas(ics: string): string[] {
  return ics.replaceAll("\r\n ", "").split("\r\n");
}

describe("icsDeConvite", () => {
  it("monta o REQUEST com identidade, versão e horário de parede", () => {
    const ics = convite();

    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).toContain("UID:fut-7-3@futzenha.com.br");
    expect(ics).toContain("SEQUENCE:2");
    expect(ics).toContain("DTSTAMP:20260819T120000Z");
    expect(ics).toContain("DTSTART;TZID=America/Sao_Paulo:20260822T200000");
    expect(ics).toContain("DTEND;TZID=America/Sao_Paulo:20260822T220000");
    expect(ics).toContain("STATUS:CONFIRMED");
    expect(ics).toContain("PARTSTAT=ACCEPTED");
    // O ATTENDEE passa dos 75 octetos e sai dobrado — quem lê o endereço é o
    // cliente, depois de desdobrar.
    expect(linhasDesdobradas(ics)).toContain(
      'ATTENDEE;CN="Vitor";ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:vitor@example.com',
    );
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  // Cliente estrito rejeita o arquivo inteiro se uma quebra vier sem o CR.
  it("quebra toda linha com CRLF", () => {
    const ics = convite();

    expect(ics.split("\r\n").join("").includes("\n")).toBe(false);
  });

  // Fut de sexta à noite acaba no sábado — o DTEND tem que virar o dia junto.
  it("atravessa a meia-noite sem perder o dia", () => {
    const ics = convite({ fut: { startTime: "23:30:00" } });

    expect(ics).toContain("DTSTART;TZID=America/Sao_Paulo:20260822T233000");
    expect(ics).toContain("DTEND;TZID=America/Sao_Paulo:20260823T013000");
  });

  it("sem horário vira evento de dia inteiro", () => {
    const ics = convite({ fut: { startTime: null } });

    expect(ics).toContain("DTSTART;VALUE=DATE:20260822");
    expect(ics).toContain("DTEND;VALUE=DATE:20260823");
    expect(ics).not.toContain("DTSTART;TZID");
  });

  it("no CANCEL o evento sai como cancelado", () => {
    const ics = convite({ metodo: "CANCEL" });

    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("STATUS:CANCELLED");
  });

  // Ponto e vírgula e vírgula separam campos no formato; sem escape, um local
  // como "Quadra; bloco B" partiria a linha em dois valores.
  it("escapa os separadores do formato e as quebras de linha", () => {
    const ics = convite({
      fut: { location: "Quadra; bloco B, fundos", notes: "trazer colete\nchega 19h45" },
    });

    expect(ics).toContain("LOCATION:Quadra\\; bloco B\\, fundos");
    expect(ics).toContain("DESCRIPTION:trazer colete\\nchega 19h45\\n\\nPresenças e times:");
  });

  // O CN não pode usar o escape de valor (dentro de aspas, `\;` sairia
  // literal), então a quebra de linha some ali: um nome com "\n" encerraria o
  // ATTENDEE e a linha seguinte viraria propriedade nova do VEVENT.
  it("nome com quebra de linha não injeta propriedade no evento", () => {
    const ics = icsDeConvite({
      fut: FUT,
      urlBase: URL_BASE,
      metodo: "REQUEST",
      sequence: 2,
      agora: AGORA,
      organizador: ORGANIZADOR,
      convidado: { ...CONVIDADO, nome: "Vitor\r\nDESCRIPTION:injetado" },
    });

    expect(linhasDesdobradas(ics)).toContain(
      'ATTENDEE;CN="Vitor DESCRIPTION:injetado";ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:vitor@example.com',
    );
    // Uma DESCRIPTION só: a do fut. A do nome não virou linha.
    const descricoes = linhasDesdobradas(ics).filter((l) => l.startsWith("DESCRIPTION:"));
    expect(descricoes).toHaveLength(1);
    expect(descricoes[0]).toContain("Presenças e times:");
  });

  it("dobra linha longa em 75 octetos, sem partir caractere acentuado", () => {
    const acentos = "á".repeat(200);
    const ics = convite({ fut: { notes: acentos } });

    const encoder = new TextEncoder();
    for (const linha of ics.split("\r\n")) {
      expect(encoder.encode(linha).length).toBeLessThanOrEqual(75);
    }
    // Desdobrada, a descrição volta inteira: a dobra é transporte, não conteúdo.
    expect(linhasDesdobradas(ics).join("\r\n")).toContain(`DESCRIPTION:${acentos}\\n`);
  });
});

describe("icsParaBaixar", () => {
  it("publica o evento sem convidar ninguém", () => {
    const ics = icsParaBaixar({ fut: FUT, urlBase: URL_BASE, agora: AGORA });

    expect(ics).toContain("METHOD:PUBLISH");
    expect(ics).toContain("UID:fut-7@futzenha.com.br");
    expect(ics).not.toContain("ATTENDEE");
    expect(ics).not.toContain("ORGANIZER");
  });
});

describe("urlGoogleAgenda", () => {
  it("leva o fuso junto do intervalo", () => {
    const url = urlGoogleAgenda(FUT, URL_BASE);

    expect(url).toContain("action=TEMPLATE");
    expect(url).toContain("ctz=America%2FSao_Paulo");
    expect(url).toContain("dates=20260822T200000%2F20260822T220000");
  });

  it("sem horário manda só as datas", () => {
    const url = urlGoogleAgenda({ ...FUT, startTime: null }, URL_BASE);

    expect(url).toContain("dates=20260822%2F20260823");
  });
});

describe("urlOutlookAgenda", () => {
  // O compose não tem TZID nem `ctz`: parede nua ficaria à mercê do fuso da
  // caixa de quem clica. Vai em UTC — 20h de Brasília são 23h Z, e o fim (22h)
  // já cai no dia seguinte em UTC.
  it("manda início e fim em UTC, com o Z explícito", () => {
    const url = urlOutlookAgenda(FUT, URL_BASE);

    expect(url).toContain("rru=addevent");
    expect(url).toContain("startdt=2026-08-22T23%3A00%3A00Z");
    expect(url).toContain("enddt=2026-08-23T01%3A00%3A00Z");
  });

  it("sem horário marca o dia inteiro, sem fuso nenhum", () => {
    const url = urlOutlookAgenda({ ...FUT, startTime: null }, URL_BASE);

    expect(url).toContain("allday=true");
    expect(url).toContain("startdt=2026-08-22&");
    expect(url).not.toContain("Z&");
  });
});

describe("uidDoConvite", () => {
  // O UID é o que faz atualização e cancelamento acharem o evento já criado:
  // mudar o formato quebra a agenda de quem já recebeu convite.
  it("é estável por par (fut, jogador)", () => {
    expect(uidDoConvite(7, 3)).toBe("fut-7-3@futzenha.com.br");
    expect(DURACAO_PADRAO_MIN).toBe(120);
  });
});
