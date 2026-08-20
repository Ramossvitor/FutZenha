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
// O free tier do Resend dá 100 e-mails por dia para a instalação inteira, e é
// isso que o TETO_DIARIO abaixo vale hoje (era 90, com margem, até o resumo do
// fut chegar — ver o comentário dele). O que faltava era dividir esse teto
// entre coisas que NÃO valem o mesmo:
//
// - o **link de convite / redefinição de acesso** é recuperação de conta. Sem
//   ele, quem perdeu a senha não entra — não há outro caminho;
// - o **e-mail de agenda** é conveniência. Sem ele, a pessoa abre o app e vê o
//   fut, como sempre viu;
// - o **resumo do fut** é notícia, e é o de maior volume: um fut de 20 pessoas
//   gasta 20 de uma vez. Sem ele, o placar continua na página do fut.
//
// Antes desta divisão, um vetor de conveniência derrubava o canal de
// recuperação: `setMyAttendance` alternando "Vou"/"Fora" mandava dois e-mails
// por ciclo, ilimitado, e ~50 ciclos zeravam a cota do dia para todo mundo.
// Daí TETO_AGENDA_DIA e TETO_RESUMO_DIA serem SUB-tetos: nenhum dos dois
// alcança a cota inteira, e o convite nunca é recusado por e-mail que podia
// esperar.
//
// Um teto só vale se o ledger contar a coisa certa. O primeiro desenho carimbava
// `attendances.agenda_email_sent_at` e somava LINHAS carimbadas — mas o carimbo
// é sobrescrito, então o mesmo par (fut, jogador) valia 1 para sempre, e o
// mesmo loop de alternar presença passava por baixo dos dois tetos. Por isso a
// coluna irmã `agenda_emails_sent`: o que se conta são envios.

/**
 * Teto diário da instalação, somando TODOS os fluxos (ver ./contagem-de-envios).
 *
 * É o free tier do Resend inteiro, sem margem — e isso é uma decisão, não um
 * descuido. Eram 90 justamente para sobrar folga, porque a cota do Resend conta
 * e-mails RECEBIDOS também; a folga foi gasta quando o resumo do fut entrou,
 * porque ele é o fluxo de maior volume do produto: um fut de 20 pessoas gasta 20
 * de uma vez, contra o 1 de um convite.
 *
 * O que isso significa na prática, e que vale reler antes de mexer aqui:
 *
 * - este teto deixou de ser o limite que quase nunca morde e virou **o** limite
 *   que vai morder;
 * - quem NÃO pode ser o recusado quando ele morder é o convite / redefinição de
 *   acesso, o único fluxo sem alternativa (quem perdeu a senha não entra sem
 *   ele). Quem garante isso não é este número e sim os dois sub-tetos abaixo:
 *   TETO_AGENDA_DIA contra a conveniência e TETO_RESUMO_DIA contra o volume.
 *   Entre os dois, o convite tem sempre uma faixa que ninguém mais alcança;
 * - qualquer envio fora da nossa contagem (um reenvio manual, um webhook) passa
 *   a estourar de verdade no Resend, não aqui.
 *
 * A saída é plano pago, não um número maior: acima de 100 o Resend recusa, e
 * subir isto só troca uma recusa que sabemos explicar por uma que não.
 */
export const TETO_DIARIO = 100;

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

/**
 * Sub-teto da instalação para o resumo do fut, pelo MESMO motivo do de agenda —
 * e é ele que devolve ao convite a folga que o TETO_DIARIO perdeu ao subir para
 * 100.
 *
 * Sem esta linha, o fluxo de maior volume do produto e o único fluxo sem
 * alternativa disputavam a mesma cota sem árbitro: três futs de 20 encerrados
 * numa quinta à noite gastam 60 e-mails, e quem perdeu a senha às 23h descobre
 * que não entra mais hoje. Sessenta porque três futs cheios é um dia movimentado
 * de verdade, e ainda sobram 40 garantidos para convite e redefinição.
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
