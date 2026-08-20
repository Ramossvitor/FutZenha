// Quantos e-mails cada coisa pode gastar, e a decisão que lê esses números.
//
// Módulo puro — sem `server-only`, sem drizzle — pelo mesmo motivo de
// ./grupos-link e ./stats-escopo: a aritmética das janelas é o que mais merece
// teste, e o vitest unit roda sem config e sem alias. Quem vai ao banco é
// ./agenda-convite e ./email-convite.
//
// ---------------------------------------------------------------------------
// A decisão de arquitetura que este arquivo carrega
// ---------------------------------------------------------------------------
//
// O free tier do Resend dá 100 e-mails por dia para a instalação inteira, e o
// projeto já reservava 90 como teto (TETO_DIARIO, abaixo). O que faltava era
// dividir esse teto entre coisas que NÃO valem o mesmo:
//
// - o **link de convite / redefinição de acesso** é recuperação de conta. Sem
//   ele, quem perdeu a senha não entra — não há outro caminho;
// - o **e-mail de agenda** é conveniência. Sem ele, a pessoa abre o app e vê o
//   fut, como sempre viu.
//
// Antes desta divisão, um vetor de conveniência derrubava o canal de
// recuperação: `setMyAttendance` alternando "Vou"/"Fora" mandava dois e-mails
// por ciclo, ilimitado, e ~50 ciclos zeravam a cota do dia para todo mundo.
// Daí o TETO_AGENDA_DIA ser um SUB-teto: a agenda gasta no máximo 40, e o
// convite tem sempre 50 garantidos.
//
// Um teto só vale se o ledger contar a coisa certa. O primeiro desenho carimbava
// `attendances.agenda_email_sent_at` e somava LINHAS carimbadas — mas o carimbo
// é sobrescrito, então o mesmo par (fut, jogador) valia 1 para sempre, e o
// mesmo loop de alternar presença passava por baixo dos dois tetos. Por isso a
// coluna irmã `agenda_emails_sent`: o que se conta são envios.

/** Teto diário da instalação, somando TODOS os fluxos. Abaixo dos 100/dia do
 *  free tier para sobrar margem — a cota do Resend conta recebidos também. */
export const TETO_DIARIO = 90;

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
 * Sub-teto da instalação para agenda. **Menor que TETO_DIARIO de propósito** —
 * é a linha que garante que conveniência não come a cota de quem perdeu a senha.
 */
export const TETO_AGENDA_DIA = 40;

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
