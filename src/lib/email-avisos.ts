import "server-only";
import { after } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { NotificationType } from "@/db/schema";
import { emailConfigurado, enviarEmail } from "./email-envio";
import { emailDeAviso } from "./email-modelos";
import {
  destinosDeEmail,
  reivindicarPendentesDeEmail,
  type AvisoPendenteDeEmail,
} from "./notifications";

/**
 * Despacho por e-mail dos avisos da caixa de entrada, com `notifications` como
 * outbox — o mesmo desenho de ./push-envio, e por isso vale ler os dois juntos.
 *
 * notificar() grava a intenção DENTRO da transação de quem notifica;
 * `email_dispatched_at` nasce null e é isso que enfileira. O despacho roda
 * depois da resposta (after) ou no cron, em duas fases:
 *
 *   1. claim, numa transação curta: marca um lote de pendentes e leva as linhas
 *      (UPDATE ... RETURNING, em notifications.ts). O advisory lock segura a
 *      corrida entre instâncias — quem não trava volta de mãos vazias.
 *   2. envio, FORA de transação: lê os destinos (destinosDeEmail) e fala com o
 *      Resend. Rede nunca dentro de transação — a regra da casa desde o
 *      email-convite.ts —, e a leitura dos destinos fica aqui pelo mesmo motivo
 *      que o push busca as assinaturas depois: dentro da transação ela pediria
 *      uma segunda conexão do pool com a primeira ainda presa.
 *
 * ---------------------------------------------------------------------------
 * Duas escolhas que separam este despachante dos irmãos
 * ---------------------------------------------------------------------------
 *
 * **At-most-once, como o push e ao contrário do resumo do fut.** O claim vem
 * antes do envio, então um crash entre as fases perde aquele lote e nunca
 * duplica. O resumo escolheu o oposto (./email-resumo carimba DEPOIS) porque lá
 * o buraco a fechar era "não recebeu e nunca mais recebe" — o placar é o
 * produto. Aqui o e-mail é aceleração de um aviso que continua na caixa de
 * entrada, e e-mail repetido custa mais caro que push repetido: ele fica na
 * caixa da pessoa, e dois comprovantes do mesmo Pix é o tipo de coisa que gera
 * dúvida sobre ter sido cobrado duas vezes.
 *
 * **Nem todo aviso vira e-mail.** São 26 tipos na caixa de entrada e sete aqui.
 * Quem decide é o mapa AVISOS_POR_EMAIL abaixo, e tipo de fora é marcado no
 * claim sem envio nenhum — ver o comentário de reivindicarPendentesDeEmail.
 */

// Chave própria, como o LOCK_PUSH: a seção crítica é "quem despacha o lote de
// e-mail", e compartilhá-la com o push faria um dos dois voltar de mãos vazias
// sempre que rodassem juntos — que é exatamente o caso no cron.
export const LOCK_EMAIL_AVISOS = 274156040;

/**
 * Teto por varredura. Bem menor que os 200 do push, e por dois motivos: cada
 * envio aqui é um POST ao Resend com pausa entre eles (ver ESPERA_ENTRE_ENVIOS_MS),
 * e a rota do cron tem maxDuration de 60s. O que sobra fica para o tick seguinte
 * — e fica REGISTRADO, nunca silenciado.
 *
 * O número sai de uma conta de orçamento, e é aqui que ela mora porque **um
 * limite de relógio no laço de envio não serviria**: o claim é at-most-once, e
 * linha reivindicada que o laço não alcançasse estaria perdida, não adiada.
 * Abandonar um comprovante de Pix no meio do lote é pior que estourar o
 * maxDuration. Sob at-most-once, respeitar o relógio é reivindicar menos.
 *
 * A conta, contra os 60s da rota do cron: o resumo pode gastar ~20s (2 futs ×
 * até 20 envios × 500ms), o push mais uns ~10s, e a recarga — que é a última e
 * fala HTTP com o Mercado Pago — precisa sobrar. Quinze envios a 500ms são 7,5s
 * de pausa mais os POSTs, que cabem no que resta. Uma véspera de elenco cheio
 * (~25) sai em duas passadas, e passada é coisa de minuto: o gatilho principal é
 * o `after()` do layout, não o cron.
 */
const LIMITE_POR_VARREDURA = 15;

/**
 * A mesma pausa do lote de resumo, pelo mesmo motivo: o free tier do Resend
 * aceita ~2 req/s, e a votação de exclusão manda para o elenco inteiro de uma
 * vez. Sem a pausa o lote colhe `rate_limit_exceeded` do terceiro em diante,
 * aciona a retentativa de rajada do transporte (até ~5s por e-mail) e vira
 * candidato a ser cortado pelo maxDuration.
 */
const ESPERA_ENTRE_ENVIOS_MS = 500;

/**
 * Aviso velho não vira e-mail. Rede de segurança do backfill da migration 0037:
 * se ele falhar (ou se alguém religar a coluna com um UPDATE distraído), o
 * histórico inteiro é marcado sem sair para ninguém.
 *
 * 24h, e não os 24h-do-push por coincidência: é o tempo em que qualquer um
 * destes avisos ainda é acionável. Convite para o fut de ontem e lembrete de
 * véspera vencida não têm o que pedir a quem lê.
 */
const IDADE_MAXIMA_MS = 24 * 60 * 60 * 1000;

/**
 * A costura de teste da pausa, no molde do RESUMO_ESPERA_MS de ./email-resumo:
 * um teste que manda seis e-mails pagaria 2,5s de `setTimeout` real contra o
 * testTimeout de 5s. Lida a cada chamada para o `vi.stubEnv` funcionar.
 *
 * A env é só para teste. Em produção ela não existe e o default vale — valor
 * inválido também cai nele, porque `Number("")` é 0 e um lote sem pausa nenhuma
 * é exatamente o que não pode acontecer por engano.
 */
function esperaEntreEnvios(): number {
  const bruto = process.env.AVISOS_ESPERA_MS;
  if (bruto === undefined || bruto.trim() === "") return ESPERA_ENTRE_ENVIOS_MS;
  const ms = Number(bruto);
  return Number.isFinite(ms) && ms >= 0 ? ms : ESPERA_ENTRE_ENVIOS_MS;
}

function esperar(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * O que muda de um tipo para o outro.
 *
 * `rotulo` é o texto do botão — o resto do e-mail sai do `title` e do `body` que
 * a notificação já carrega (ver emailDeAviso em ./email-modelos).
 *
 * `rodape` é a frase do "por que recebi isto". Ela existe por tipo, e não uma
 * para todos, porque a resposta é genuinamente diferente: o admin que recebe um
 * pedido de entrada não foi convidado para nada, e dizer que foi é mentir para
 * quem está justamente procurando a origem do e-mail.
 *
 * `transacional` decide se o toggle de /perfil vale. Ligado, o e-mail sai mesmo
 * para quem desligou os avisos — e é por isso que a marcação é conservadora:
 * só dinheiro pago (comprovante de valor que saiu da conta de alguém) e o
 * estorno que os admins precisam resolver na mão. Aviso de fut não é
 * transacional por mais útil que seja.
 */
type ModeloDeAviso = { rotulo: string; rodape: string; transacional?: true };

/**
 * A allowlist. Tipo que não está aqui **não vira e-mail** — é marcado no claim e
 * some da fila.
 *
 * `Partial<Record<…>>` e não um objeto solto: o tsc recusa chave que não é
 * `NotificationType`, então um tipo renomeado no enum acusa aqui em vez de virar
 * uma entrada morta que ninguém nota. O caminho contrário (tipo novo no enum sem
 * entrada aqui) é seguro por construção — ele simplesmente não sai por e-mail.
 */
const AVISOS_POR_EMAIL: Partial<Record<NotificationType, ModeloDeAviso>> = {
  fut_convite: {
    rotulo: "Ver o convite",
    rodape:
      "Você recebeu este e-mail porque alguém que já jogou com você chamou você para um fut. Para parar de receber avisos por e-mail, mude em Perfil › Avisos por e-mail.",
  },
  pelada_lembrete_vespera: {
    rotulo: "Responder",
    rodape:
      "Você recebeu este e-mail porque o fut é amanhã e você ainda não respondeu. Para parar de receber avisos por e-mail, mude em Perfil › Avisos por e-mail.",
  },
  deletion_vote_open: {
    rotulo: "Votar",
    rodape:
      "Você recebeu este e-mail porque jogou este fut e o seu voto decide se ele será apagado. Para parar de receber avisos por e-mail, mude em Perfil › Avisos por e-mail.",
  },
  group_join_request: {
    rotulo: "Ver o pedido",
    rodape:
      "Você recebeu este e-mail porque administra este grupo e alguém pediu para entrar. Para parar de receber avisos por e-mail, mude em Perfil › Avisos por e-mail.",
  },
  // Os três de dinheiro. Transacionais: comprovante de valor pago não é aviso
  // que se desliga, e o estorno é trabalho que espera um humano.
  recarga_confirmada: {
    rotulo: "Ver o extrato",
    rodape: "Você recebeu este e-mail porque uma recarga de zenhas foi paga na sua conta.",
    transacional: true,
  },
  recarga_estornada: {
    rotulo: "Ver as recargas",
    rodape:
      "Você recebeu este e-mail porque administra a plataforma e uma recarga foi estornada pelo gateway.",
    transacional: true,
  },
  loja_compra: {
    rotulo: "Ver o inventário",
    rodape: "Você recebeu este e-mail porque comprou um item na loja do FutZenha.",
    transacional: true,
  },
};

/**
 * As chaves de AVISOS_POR_EMAIL como lista, para o claim priorizar os tipos que
 * de fato viram e-mail (ver reivindicarPendentesDeEmail).
 *
 * Derivada do mapa, e não escrita à mão ao lado dele: duas listas da mesma coisa
 * divergem no primeiro tipo novo, e a que divergisse aqui empurraria o tipo novo
 * para o fim da fila sem nada falhar.
 */
const TIPOS_COM_EMAIL = Object.keys(AVISOS_POR_EMAIL) as NotificationType[];

export type ResultadoDespachoDeEmail = {
  enviados: number;
  falhas: number;
  /** Reivindicados e descartados sem envio: tipo de fora, sem endereço, opt-out, idade. */
  ignorados: number;
  /**
   * O lote saiu cheio, então provavelmente ficou coisa para o próximo disparo.
   * Um booleano, e não a contagem do que sobrou: saber o número exigiria uma
   * segunda consulta que não mudaria nada do que fazemos — e um campo chamado
   * `adiados` guardando 0 ou 1 seria uma contagem mentirosa.
   */
  loteCheio: boolean;
};

const nada = (extra: Partial<ResultadoDespachoDeEmail> = {}): ResultadoDespachoDeEmail => ({
  enviados: 0,
  falhas: 0,
  ignorados: 0,
  loteCheio: false,
  ...extra,
});

/**
 * Este aviso vira e-mail? Puro e exportado para o teste unit — é a decisão que
 * mais merece ser exercitada sem banco.
 *
 * A ordem das recusas não muda o resultado (todas descartam), mas está do fato
 * mais geral para o mais específico da pessoa: primeiro "este tipo não manda
 * e-mail", depois "não há para onde mandar", por último "esta pessoa não quer".
 */
export function modeloDoAviso(aviso: {
  type: NotificationType;
  para: string | null;
  avisosPorEmail: boolean;
}): ModeloDeAviso | null {
  const modelo = AVISOS_POR_EMAIL[aviso.type];
  if (!modelo) return null;
  if (aviso.para === null) return null;
  if (!modelo.transacional && !aviso.avisosPorEmail) return null;
  return modelo;
}

/**
 * Despacha o lote pendente. Devolve o que fez — o cron o publica no JSON da
 * resposta, como as outras etapas.
 */
export async function despacharEmailsDeAvisos(): Promise<ResultadoDespachoDeEmail> {
  // Sem key nem toca o banco: modo preview/dev. O mesmo kill switch do resto da
  // família — e o que faz a suíte de integração rodar sem mandar nada.
  if (!emailConfigurado()) return nada();

  // Fase 1 — claim. Se duas instâncias chegarem juntas, o lock manda a segunda
  // embora sem trabalho, como em despacharPush e processarPendencias.
  const reivindicados = await db.transaction(async (tx) => {
    const travou = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(${LOCK_EMAIL_AVISOS}::bigint) as locked`,
    );
    if (!travou[0]?.locked) return [];
    return reivindicarPendentesDeEmail(tx, LIMITE_POR_VARREDURA, TIPOS_COM_EMAIL);
  });
  if (reivindicados.length === 0) return nada();

  // Lote cheio é sinal de que ficou coisa para trás, e o próximo tick continua
  // de onde parou. Fica registrado porque teto invisível lê como "cobri tudo"
  // quando não cobriu — a mesma razão do `adiados` de email-resumo.ts.
  const loteCheio = reivindicados.length === LIMITE_POR_VARREDURA;
  if (loteCheio) {
    console.log(
      `[email-avisos] lote cheio (${LIMITE_POR_VARREDURA}) — o que sobrou sai no próximo disparo.`,
    );
  }

  // Fase 2 — envio, fora de transação. Os destinos são lidos aqui, e não dentro
  // do claim: lá dentro seria uma segunda conexão do pool presa junto da
  // primeira (ver destinosDeEmail).
  //
  // A idade é conferida antes de buscar destino: o lote velho de um backfill que
  // falhou não deve custar nem essa consulta.
  const corte = Date.now() - IDADE_MAXIMA_MS;
  const novos = reivindicados.filter((a) => a.createdAt.getTime() >= corte);
  const porJogador = new Map(
    (await destinosDeEmail(novos.map((a) => a.playerId))).map((d) => [d.playerId, d]),
  );

  const aEnviar: {
    aviso: AvisoPendenteDeEmail;
    para: string;
    nome: string;
    modelo: ModeloDeAviso;
  }[] = [];
  for (const aviso of novos) {
    const destino = porJogador.get(aviso.playerId);
    const modelo = modeloDoAviso({
      type: aviso.type,
      para: destino?.para ?? null,
      avisosPorEmail: destino?.avisosPorEmail ?? false,
    });
    // O `destino?.para` repete o que modeloDoAviso já conferiu (é a primeira
    // recusa dele), e está aqui para o tsc estreitar o tipo — não como segunda
    // regra. Se um dia a decisão mudar, ela muda lá, e este `if` continua sendo
    // só a prova de que `para` é string.
    if (modelo && destino?.para) {
      aEnviar.push({ aviso, para: destino.para, nome: destino.nome, modelo });
    }
  }
  const ignorados = reivindicados.length - aEnviar.length;
  if (aEnviar.length === 0) return nada({ ignorados, loteCheio });

  let enviados = 0;
  let falhas = 0;
  for (const [indice, { aviso, para, nome, modelo }] of aEnviar.entries()) {
    if (indice > 0) await esperar(esperaEntreEnvios());

    const resultado = await enviarEmail({
      para,
      // Só nos que respeitam o toggle: a saída que o header oferece é a de
      // Perfil › Avisos por e-mail, e ela não desliga comprovante de recarga.
      // Anunciar um descadastro que não vale para aquele e-mail é pior que não
      // anunciar nenhum.
      listUnsubscribe: modelo.transacional ? undefined : "/perfil",
      ...emailDeAviso({
        nome,
        title: aviso.title,
        body: aviso.body,
        href: aviso.href,
        rotuloDoBotao: modelo.rotulo,
        rodape: modelo.rodape,
      }),
    });

    if (resultado.ok) {
      enviados += 1;
      continue;
    }
    // Sem volta para a fila: o claim já marcou (at-most-once, ver o cabeçalho).
    // O aviso continua na caixa de entrada e no push — é o que torna essa perda
    // aceitável.
    falhas += 1;
    console.error("[email-avisos] aviso não saiu:", {
      id: aviso.id,
      type: aviso.type,
      motivo: resultado.motivo,
    });
  }

  return { enviados, falhas, ignorados, loteCheio };
}

// Throttle por instância, no molde de ./pendencias, ./push-envio e ./email-resumo.
let ultimoDespacho = 0;
const INTERVALO_MS = 60_000;

/**
 * O despacho agendado para depois da resposta — o gatilho principal, já que o
 * cron roda uma vez por dia.
 *
 * `forcar` para quem acabou de gravar o aviso e quer que ele saia agora (o
 * convite para o fut, por exemplo), no mesmo desenho do `agendarDespachoDePush`.
 *
 * O `try/catch` dentro é obrigatório: rejeição não tratada dentro do `after`
 * derruba o log da request inteira (ver src/lib/pendencias.ts). E o callback
 * **retorna** a promessa, para o `waitUntil` da Vercel esticar a invocação até o
 * fim do lote em vez de congelá-la com o fetch no ar.
 */
export function agendarDespachoDeEmails(forcar = false): void {
  if (!emailConfigurado()) return;
  const agora = Date.now();
  if (!forcar && agora - ultimoDespacho < INTERVALO_MS) return;
  ultimoDespacho = agora;
  after(async () => {
    try {
      await despacharEmailsDeAvisos();
    } catch (erro) {
      console.error("[email-avisos] despacho falhou:", erro);
    }
  });
}
