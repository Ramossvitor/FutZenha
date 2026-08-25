// Quantos e-mails cada coisa pode gastar, e a decisão que lê esses números.
//
// Módulo puro — sem `server-only`, sem drizzle — pelo mesmo motivo de
// ./grupos-link e ./stats-escopo: a aritmética das janelas é o que mais merece
// teste, e o vitest unit roda sem config e sem alias. Quem vai ao banco é
// ./agenda-convite e ./email-convite.
//
// ---------------------------------------------------------------------------
// O teto geral que existiu aqui, e por que não existe mais
// ---------------------------------------------------------------------------
//
// Havia um `TETO_DIARIO` que somava TODOS os fluxos e recusava o convite ao
// encostar nos 100 do free tier do Resend. Ele saiu, e o que o derrubou não foi
// o número: foi a contagem. Somar fluxos exige que cada um saiba contar os
// PRÓPRIOS envios, e o dos avisos da caixa de entrada não sabia — ele contava
// linhas de `notifications` carimbadas, e o carimbo cai também nos 19 de 26
// tipos que nunca viram e-mail. Um dia com dois futs encerrados (~50 linhas
// cada) zerava sozinho a cota de quem tinha perdido a senha, sem um único
// e-mail ter saído.
//
// Corrigir aquela soma era fácil; manter uma soma correta para sempre, com cada
// fluxo novo tendo de se declarar nela sob pena de recusar o convite por engano,
// não é. Então o teto geral acabou. O que ficou:
//
// - **por destinatário** (JANELA_POR_DESTINATARIO_MIN) e **por convidante**
//   (TETO_POR_CONVIDANTE_DIA): é onde o abuso mora de verdade. Qualquer jogador
//   logado marca um fut e vira admin dele, e daí alcança o cadastro com e-mail à
//   escolha — o freio que importa é o que limita AQUELA conta e AQUELA caixa de
//   entrada, não o que soma a instalação;
// - **por fluxo de lote** (TETO_AGENDA_DIA, TETO_RESUMO_DIA): agenda e resumo
//   mandam para o elenco inteiro de uma vez, e cada um responde pelo próprio
//   volume;
// - **e o Resend**, que continua sendo 100/dia. Estourar agora volta como recusa
//   dele: um 429 sem `rate_limit_exceeded` vira `motivo: "limite"` em
//   ./email-envio, que a UI já traduz no banner de copiar o link e mandar no
//   WhatsApp. Perdeu-se o pré-aviso, não o fallback.
//
// Um teto só vale se o ledger contar a coisa certa — a lição que o de agenda
// aprendeu primeiro. O primeiro desenho carimbava
// `attendances.agenda_email_sent_at` e somava LINHAS carimbadas, mas o carimbo
// é sobrescrito: o mesmo par (fut, jogador) valia 1 para sempre, e o loop de
// alternar presença passava por baixo do teto. Por isso a coluna irmã
// `agenda_emails_sent` — o que se conta são envios.

/** Janela por caixa de entrada, em qualquer fluxo. */
export const JANELA_POR_DESTINATARIO_MIN = 10;

export const JANELA_DIARIA_HORAS = 24;

/** Teto de quem dispara, só para o aviso de grupo (`invites` não guarda quem
 *  convidou). Acima de dois elencos inteiros no mesmo dia. */
export const TETO_POR_CONVIDANTE_DIA = 40;

/**
 * Janela por par (fut, jogador) para o e-mail de agenda.
 *
 * É esta que mata o loop de alternar presença: a segunda confirmação dentro de
 * 10 minutos não vira e-mail. Dez minutos é a mesma janela por destinatário do
 * convite — quem reconfirma de verdade é raro, e quem alterna é script.
 */
export const JANELA_AGENDA_POR_FUT_MIN = 10;

/**
 * Teto diário de e-mail de agenda por caixa de entrada.
 *
 * A janela por fut sozinha não basta, por dois caminhos. Criar 50 futs e
 * confirmar presença em cada um são 50 pares diferentes, todos estreando; e o
 * cancelamento, que é isento da janela de propósito, repete no MESMO par.
 * Contra os dois é este teto que responde — desde que ele conte e-mails, e não
 * pares (ver `attendances.agenda_emails_sent` e `carimbarEnvio`).
 *
 * Doze cobre com folga quem joga todo dia e ainda muda de ideia.
 */
export const TETO_AGENDA_POR_JOGADOR_DIA = 12;

/**
 * Teto diário da instalação para o e-mail de agenda.
 *
 * Era a fatia que impedia a conveniência de comer a cota do convite; sem o teto
 * geral, virou o que já era na prática — o limite absoluto de quanto ESTE fluxo
 * gasta num dia. O que ele barra continua sendo o vetor de sempre:
 * `setMyAttendance` alternando "Vou"/"Fora" mandava dois e-mails por ciclo,
 * ilimitado, e ~50 ciclos queimavam o domínio do projeto de graça.
 *
 * Quarenta passa longe de um dia movimentado de verdade.
 */
export const TETO_AGENDA_DIA = 40;

/**
 * Teto diário da instalação para o resumo do fut, pelo MESMO motivo do de
 * agenda: é o fluxo de maior volume do produto — um fut de 20 pessoas gasta 20
 * e-mails de uma vez, contra o 1 de um convite.
 *
 * Sessenta porque três futs cheios encerrados na mesma noite é um dia
 * movimentado de verdade; acima disso é backlog anormal, não uso.
 *
 * Ele é conferido contra o LOTE INTEIRO, não e-mail a e-mail: o resumo é
 * tudo-ou-nada por fut (ver `enviarResumoDoFut`), porque metade do elenco com o
 * placar na caixa e a outra metade sem é o estado que ninguém explica no grupo.
 */
export const TETO_RESUMO_DIA = 60;

/** Por que um e-mail de agenda não vai sair. `null` = pode ir. */
export type BloqueioDeAgenda = "envio-recente" | "teto-do-jogador" | "teto-da-agenda" | null;

export type ContagensDeAgenda = {
  /** Este par (fut, jogador) recebeu e-mail dentro de JANELA_AGENDA_POR_FUT_MIN? */
  recebeuHaPouco: boolean;
  /** Quantos e-mails de agenda esta caixa recebeu nas últimas 24h. */
  doJogadorNoDia: number;
  /** Quantos e-mails de agenda a instalação inteira mandou nas últimas 24h. */
  daInstalacaoNoDia: number;
};

/**
 * A decisão, na ordem em que ela faz sentido explicar a quem clicou.
 *
 * Do mais específico para o mais geral: "você acabou de receber" antes de "você
 * já recebeu demais hoje" antes de "a instalação já mandou demais hoje". Se a
 * ordem fosse a inversa, quem alternasse presença num dia movimentado veria a
 * mensagem da instalação por um problema que é dele.
 */
export function motivoDeBloqueioDeAgenda(c: ContagensDeAgenda): BloqueioDeAgenda {
  if (c.recebeuHaPouco) return "envio-recente";
  if (c.doJogadorNoDia >= TETO_AGENDA_POR_JOGADOR_DIA) return "teto-do-jogador";
  if (c.daInstalacaoNoDia >= TETO_AGENDA_DIA) return "teto-da-agenda";
  return null;
}
