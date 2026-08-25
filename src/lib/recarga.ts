import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, isNotNull, lt, sql } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { players, users, zenhaPacotes, zenhaPedidos, type ZenhaPacote, type ZenhaPedido } from "@/db/schema";
import { creditar } from "./carteira";
import { emailDeDestino } from "./email-destino";
import { notificar } from "./notifications";
import { mercadoPago } from "./pagamentos/mercadopago";
import { formatarReais } from "./recarga-formato";
import { RECARGA_EXPIRA_MINUTOS } from "./regras";
import type { GatewayDePagamento } from "./pagamentos/gateway";

// A recarga: zenha comprada com dinheiro de verdade, via Pix.
//
// ── A regra que sustenta tudo ───────────────────────────────────────────────
// O CRÉDITO NUNCA NASCE DE UM CLIQUE. O clique cria um PEDIDO e uma cobrança no
// gateway; quem credita é a CONFIRMAÇÃO — o webhook, a sonda da tela do pedido
// ou a varredura, todos desaguando em `confirmarPedido`. O exatamente-uma-vez é
// o mesmo idioma do resto do sistema: `UPDATE ... WHERE status = 'pendente'
// RETURNING` reivindica o pedido, e a unique `(player_id, dedupe_key)` do
// ledger segura o que escapar dele.
//
// ── A criação NÃO abre transação em volta do gateway ────────────────────────
// Criar cobrança é uma ida HTTP de até 10s, e o pool tem max 5 conexões
// (src/db/index.ts): segurar uma transação durante o fetch esfolaria o pool nos
// exatos momentos de pico. Por isso a ordem é gateway PRIMEIRO, insert depois —
// e o check `zenha_pedidos_gateway_id_por_status` garante que nenhum pedido
// pagável nasce sem o id de lá. A falha entre a cobrança criada e o insert
// deixa uma cobrança órfã no MP, que expira sozinha em RECARGA_EXPIRA_MINUTOS e é
// rastreável pelo `external_reference` (a idempotency key) — dinheiro nenhum se
// perde: um Pix pago sem pedido é visível no painel do MP e não some.
//
// ── Estorno não devolve zenha ───────────────────────────────────────────────
// O ledger é append-only e o `check (saldo >= 0)` não aceita dívida — o saldo
// pode já ter virado badge. `registrarEstorno` marca o pedido, avisa os admins
// e para: o que fazer com o saldo é decisão de gente, caso a caso.

/** Por que a recarga não começou. `null` nos retornos é sucesso. */
export type ErroDeRecarga =
  /** Pacote fora de venda ou inexistente — mesma resposta, como na loja. */
  | "pacote-indisponivel"
  /** O gateway não criou a cobrança (sem credencial, recusa ou fora do ar). */
  | "gateway-indisponivel";

/**
 * Espera antes de a sonda/varredura consultarem o gateway por um pedido recém
 * criado: o caminho feliz é o webhook chegar primeiro, e consultar no segundo
 * seguinte ao insert só queimaria chamadas.
 */
const IDADE_MINIMA_PARA_SONDAR_SEGUNDOS = 15;

/**
 * Intervalo mínimo entre duas consultas ao gateway pelo MESMO pedido.
 *
 * `IDADE_MINIMA_PARA_SONDAR_SEGUNDOS` só atrasa a PRIMEIRA consulta; sem este
 * segundo freio, o tique de 5s do vigia da tela (acompanhar-recarga.tsx) vira
 * uma ida à API do MP a cada 5s — umas 350 pela vida de um QR, multiplicado
 * pelo número de abas abertas. Quem paga um Pix não vê diferença entre saber em
 * 5s e saber em 15s; a API do MP vê.
 */
const INTERVALO_MINIMO_ENTRE_CONSULTAS_SEGUNDOS = 15;

/**
 * Quanto tempo a varredura pode gastar consultando o gateway antes de desistir
 * do resto e deixar para o próximo ciclo.
 *
 * `limite` sozinho não é orçamento: 20 pedidos × 10s de timeout são 200s, contra
 * o `maxDuration = 60` do cron e do src/app/layout.tsx. Com o MP degradado —
 * exatamente quando a varredura importa — a função morreria no meio e levaria
 * junto o que roda depois dela. Ela é idempotente e retoma sozinha: parar cedo
 * não perde nada, e ser morta no meio perde o vizinho.
 */
const ORCAMENTO_DA_VARREDURA_MS = 20_000;

/**
 * Por quanto tempo um pedido `expirado` ainda é reexaminado pela varredura. O
 * Pix pago no último segundo pode cruzar com a nossa expiração — o dinheiro
 * saiu, então `confirmarPedido` aceita reviver um expirado. Depois desta
 * janela, um pagamento tardio vira caso de painel do MP, não de código.
 */
const JANELA_DO_EXPIRADO_HORAS = 24;

/** A UI esconde a recarga em ambiente sem credencial — espelho do emailConfigurado. */
export function recargaConfigurada(gateway: GatewayDePagamento = mercadoPago): boolean {
  return gateway.configurado();
}

/** Os pacotes à venda, do menor para o maior. */
export async function listarPacotes(exec: Executor): Promise<ZenhaPacote[]> {
  return exec
    .select()
    .from(zenhaPacotes)
    .where(eq(zenhaPacotes.ativo, true))
    .orderBy(asc(zenhaPacotes.ordem), asc(zenhaPacotes.precoCentavos));
}

/**
 * O e-mail que o gateway exige no pagador.
 *
 * A precedência verificado-antes-do-declarado é a de src/lib/email-destino.ts.
 * Quem não tem nenhum ganha um sintético do nosso domínio: o MP só usa o campo
 * para recibo e antifraude, e travar a recarga de quem nunca cadastrou e-mail
 * seria exigir um dado que o produto inteiro trata como opcional.
 */
async function emailDoPagador(exec: Executor, playerId: number): Promise<string> {
  // `emailDeDestino()`, e não um coalesce escrito aqui: aquele módulo diz que a
  // ORDEM dos dois argumentos é a regra de segurança, e por isso mora numa casa
  // só. Uma cópia que invertesse os argumentos mandaria o recibo do Pix para um
  // endereço auto-declarado por cima de um endereço provado.
  const [conta] = await exec
    .select({ email: emailDeDestino() })
    .from(users)
    .where(eq(users.playerId, playerId));
  return conta?.email ?? `recarga.jogador.${playerId}@futzenha.com.br`;
}

/**
 * Cria o pedido e a cobrança Pix. Devolve o id do pedido, ou o slug do que
 * impediu.
 *
 * A falha do gateway também GRAVA um pedido (`cancelado`, sem `gateway_id`):
 * é o registro honesto de que alguém tentou e não foi — some da tela na hora,
 * mas fica para o admin enxergar um gateway caindo em série.
 *
 * Clicar de novo no mesmo pacote NÃO abre segunda cobrança: o pendente que
 * ainda não venceu é devolvido como está — ver `pendenteVivo`.
 */
export async function criarPedido(
  playerId: number,
  pacoteId: number,
  gateway: GatewayDePagamento = mercadoPago,
): Promise<{ id: number } | ErroDeRecarga> {
  const [pacote] = await db
    .select()
    .from(zenhaPacotes)
    .where(and(eq(zenhaPacotes.id, pacoteId), eq(zenhaPacotes.ativo, true)));
  if (!pacote) return "pacote-indisponivel";

  const vivo = await pendenteVivo(playerId, pacote.id);
  if (vivo !== null) return { id: vivo };

  const idempotencyKey = randomUUID();
  const resultado = await gateway.criarCobrancaPix({
    valorCentavos: pacote.precoCentavos,
    descricao: `FutZenha — ${pacote.zenhas} zenhas`,
    emailPagador: await emailDoPagador(db, playerId),
    idempotencyKey,
    expiraEmMinutos: RECARGA_EXPIRA_MINUTOS,
  });

  if (!resultado.ok) {
    await db.insert(zenhaPedidos).values({
      playerId,
      pacoteId: pacote.id,
      precoCentavos: pacote.precoCentavos,
      zenhas: pacote.zenhas,
      gateway: gateway.nome,
      idempotencyKey,
      status: "cancelado",
      ultimoEvento: { falhaNaCriacao: resultado.motivo },
    });
    return "gateway-indisponivel";
  }

  // Congela preço e zenhas DO PACOTE no pedido: o admin mexe no pacote amanhã e
  // o QR que já está na tela de alguém continua valendo o que prometeu.
  const [pedido] = await db
    .insert(zenhaPedidos)
    .values({
      playerId,
      pacoteId: pacote.id,
      precoCentavos: pacote.precoCentavos,
      zenhas: pacote.zenhas,
      gateway: gateway.nome,
      gatewayId: resultado.cobranca.gatewayId,
      idempotencyKey,
      status: "pendente",
      qrCode: resultado.cobranca.qrCode,
      qrCodeBase64: resultado.cobranca.qrCodeBase64,
      // `now()` do Postgres, nunca `new Date()` em sql cru — regra do driver. O
      // relógio do MP correu ~1s antes deste insert; a folga está do lado certo
      // (o QR de lá morre um instante antes de o pedido expirar aqui).
      expiraEm: sql`now() + make_interval(mins => ${RECARGA_EXPIRA_MINUTOS}::int)`,
    })
    .returning({ id: zenhaPedidos.id });

  return { id: pedido.id };
}

/**
 * O pedido `pendente` deste jogador para ESTE pacote que ainda não venceu, se
 * houver. É o teto de cobranças abertas por jogador, e é UX antes de ser freio:
 * quem clica de novo quer o QR que já existe, não um segundo.
 *
 * Sem isto, nada limitava cobranças vivas — cada clique criava uma no MP, e uma
 * enxurrada de um jogador só afogaria a reconciliação de todo mundo (ela pega os
 * `limite` mais antigos, e o `expirado` segue candidato por 24h).
 *
 * `expira_em > now()` em SQL, e não comparado em JS: o prazo tem que ser lido
 * pelo relógio que o gravou — ver o cabeçalho de `reivindicarConsulta`.
 */
async function pendenteVivo(playerId: number, pacoteId: number): Promise<number | null> {
  const [pedido] = await db
    .select({ id: zenhaPedidos.id })
    .from(zenhaPedidos)
    .where(
      and(
        eq(zenhaPedidos.playerId, playerId),
        eq(zenhaPedidos.pacoteId, pacoteId),
        eq(zenhaPedidos.status, "pendente"),
        isNotNull(zenhaPedidos.gatewayId),
        gt(zenhaPedidos.expiraEm, sql`now()`),
      ),
    )
    .orderBy(desc(zenhaPedidos.criadoEm), desc(zenhaPedidos.id))
    .limit(1);
  return pedido?.id ?? null;
}

/**
 * Um pedido do jogador, para a tela dele. `null` quando não existe OU não é
 * dele — a mesma resposta, pela mesma razão de sempre: a URL não é oráculo dos
 * pedidos alheios.
 */
export async function lerPedidoDoJogador(
  playerId: number,
  pedidoId: number,
): Promise<ZenhaPedido | null> {
  const [pedido] = await db
    .select()
    .from(zenhaPedidos)
    .where(and(eq(zenhaPedidos.id, pedidoId), eq(zenhaPedidos.playerId, playerId)));
  return pedido ?? null;
}

/** As recargas de um jogador, da mais recente para a mais antiga. */
export async function listarPedidosDoJogador(playerId: number, limite = 20): Promise<ZenhaPedido[]> {
  return db
    .select()
    .from(zenhaPedidos)
    .where(eq(zenhaPedidos.playerId, playerId))
    .orderBy(desc(zenhaPedidos.criadoEm), desc(zenhaPedidos.id))
    .limit(limite);
}

/**
 * Confirma um pedido pago e credita as zenhas — o ÚNICO lugar de onde o motivo
 * `recarga` entra no ledger. Devolve `true` quando ESTA chamada creditou.
 *
 * A reivindicação aceita `pendente` E `expirado`: o Pix pago no último segundo
 * pode cruzar com a nossa varredura de expiração, e o dinheiro já saiu da conta
 * de alguém — reviver o pedido é a única resposta honesta. `pago` de novo é
 * no-op (o webhook do MP retenta por design), e `cancelado`/`estornado` não têm
 * caminho para cá.
 *
 * `bruto` é o payload da consulta ao gateway, guardado em `ultimo_evento` para
 * auditoria. A DECISÃO nunca vem dele — quem chama só chega aqui depois de
 * consultar a API, nunca pelo corpo de um webhook.
 */
export async function confirmarPedido(
  exec: Executor,
  pedidoId: number,
  bruto?: unknown,
): Promise<boolean> {
  // Reivindicação e crédito caem juntos ou não caem — mesma razão do débito da
  // carteira: um pedido `pago` sem linha no ledger seria dinheiro recebido e
  // zenha nenhuma entregue, o único roubo possível deste fluxo.
  if (exec === db) return db.transaction((tx) => confirmarPedidoCom(tx, pedidoId, bruto));
  return confirmarPedidoCom(exec, pedidoId, bruto);
}

async function confirmarPedidoCom(
  exec: Executor,
  pedidoId: number,
  bruto?: unknown,
): Promise<boolean> {
  const [pedido] = await exec
    .update(zenhaPedidos)
    .set({
      status: "pago",
      pagoEm: sql`now()`,
      ...(bruto === undefined ? {} : { ultimoEvento: bruto }),
    })
    .where(
      and(
        eq(zenhaPedidos.id, pedidoId),
        sql`${zenhaPedidos.status} in ('pendente', 'expirado')`,
      ),
    )
    .returning({
      id: zenhaPedidos.id,
      playerId: zenhaPedidos.playerId,
      zenhas: zenhaPedidos.zenhas,
      // Só para o aviso: é o valor que sai da conta de alguém, e um comprovante
      // que não diz quanto foi pago não é comprovante.
      precoCentavos: zenhaPedidos.precoCentavos,
    });
  if (!pedido) return false;

  await creditar(exec, [
    {
      playerId: pedido.playerId,
      motivo: "recarga",
      amount: pedido.zenhas,
      dedupeKey: `recarga:pedido:${pedido.id}`,
      descricao: `Recarga de ${pedido.zenhas} zenhas (Pix)`,
      pedidoId: pedido.id,
    },
  ]);

  // O comprador pode ter fechado a aba antes de o Pix cair — o aviso é o que
  // fecha o ciclo para ele. Dedupe pela mesma chave do ledger: reconfirmação
  // impossível, mas a caixa de entrada não depende disso.
  //
  // O texto diz o VALOR e não "toque para ver": este é um dos tipos que também
  // sai por e-mail (ver AVISOS_POR_EMAIL em ./email-avisos), e lá o mesmo `body`
  // vai debaixo de um botão "Ver o extrato" — pedir um toque seria falar de um
  // gesto que aquele canal não tem. Quem chegar por qualquer um dos três já tem
  // o caminho na frente; o que só o texto pode dar é quanto foi pago.
  await notificar(exec, [
    {
      playerId: pedido.playerId,
      type: "recarga_confirmada",
      title: `Suas ${pedido.zenhas} zenhas chegaram`,
      body: `O Pix de ${formatarReais(pedido.precoCentavos)} caiu e o saldo já subiu.`,
      href: "/zenhas",
      dedupeKey: `recarga:pedido:${pedido.id}`,
    },
  ]);

  return true;
}

/**
 * O gateway devolveu o dinheiro de um pedido pago (estorno ou disputa). Marca e
 * avisa os admins — NÃO toca o ledger, ver o cabeçalho.
 *
 * Só sai de `pago`: estorno de coisa não paga não existe, e um evento desses é
 * ruído do gateway, não fato nosso.
 */
export async function registrarEstorno(
  exec: Executor,
  pedidoId: number,
  bruto?: unknown,
): Promise<boolean> {
  const [pedido] = await exec
    .update(zenhaPedidos)
    .set({
      status: "estornado",
      estornadoEm: sql`now()`,
      ...(bruto === undefined ? {} : { ultimoEvento: bruto }),
    })
    .where(and(eq(zenhaPedidos.id, pedidoId), eq(zenhaPedidos.status, "pago")))
    .returning({
      id: zenhaPedidos.id,
      playerId: zenhaPedidos.playerId,
      zenhas: zenhaPedidos.zenhas,
      precoCentavos: zenhaPedidos.precoCentavos,
    });
  if (!pedido) return false;

  const [comprador] = await exec
    .select({ nome: players.name })
    .from(players)
    .where(eq(players.id, pedido.playerId));

  const admins = await exec
    .select({ playerId: users.playerId })
    .from(users)
    .where(and(eq(users.isPlatformAdmin, true), eq(users.active, true)));

  await notificar(
    exec,
    admins.flatMap((a) =>
      a.playerId === null
        ? []
        : [
            {
              playerId: a.playerId,
              type: "recarga_estornada" as const,
              title: "Uma recarga foi estornada no gateway",
              body: `${formatarReais(pedido.precoCentavos)} de ${comprador?.nome ?? "jogador removido"} voltaram. As ${pedido.zenhas} zenhas NÃO foram debitadas — decida o caso no painel.`,
              href: "/admin/recargas",
              dedupeKey: `recarga:pedido:${pedido.id}:estorno`,
            },
          ],
    ),
  );

  return true;
}

/**
 * Expira os pedidos cujo prazo venceu. Devolve quantos viraram `expirado`.
 *
 * Não consulta o gateway: o QR de lá morre sozinho (a cobrança nasceu com
 * `date_of_expiration`), e o caso raro do pago-no-limite é coberto pela
 * varredura reexaminar expirados recentes e por `confirmarPedido` aceitá-los.
 */
export async function expirarPedidosVencidos(exec: Executor): Promise<number> {
  const expirados = await exec
    .update(zenhaPedidos)
    .set({ status: "expirado" })
    .where(and(eq(zenhaPedidos.status, "pendente"), lt(zenhaPedidos.expiraEm, sql`now()`)))
    .returning({ id: zenhaPedidos.id });
  return expirados.length;
}

/**
 * Reivindica o direito de consultar o gateway por este pedido: carimba
 * `ultima_consulta_em` e devolve `true` SÓ se o pedido já tem idade para valer a
 * chamada e a consulta anterior é velha o bastante.
 *
 * EM SQL, e não em JS, por três coisas que só o banco entrega:
 *
 *  1. `criado_em` é `timestamp` SEM fuso, e o postgres.js o devolve com
 *     `new Date("2026-08-24 15:00:00")` — string que o V8 lê como hora LOCAL.
 *     Num processo fora de UTC (qualquer máquina de desenvolvimento daqui), a
 *     conta `Date.now() - criadoEm.getTime()` erra pelo offset inteiro: dá
 *     negativa, a idade nunca alcança o mínimo e a sonda NUNCA consulta o
 *     gateway. Que é justamente o caminho que faz a recarga funcionar em dev,
 *     onde o webhook não alcança localhost.
 *  2. É o mesmo `UPDATE ... WHERE <condição> RETURNING` do resto do sistema: duas
 *     abas sondando o mesmo pedido disputam a linha, e a segunda perde em
 *     silêncio em vez de dobrar a chamada.
 *  3. Um relógio só — o do banco — decide, como já decidia em
 *     `reconciliarPedidos` e em `expirarPedidosVencidos`.
 */
async function reivindicarConsulta(exec: Executor, pedidoId: number): Promise<boolean> {
  const [reivindicado] = await exec
    .update(zenhaPedidos)
    .set({ ultimaConsultaEm: sql`now()` })
    .where(
      and(
        eq(zenhaPedidos.id, pedidoId),
        eq(zenhaPedidos.status, "pendente"),
        sql`${zenhaPedidos.criadoEm} < now() - make_interval(secs => ${IDADE_MINIMA_PARA_SONDAR_SEGUNDOS}::int)`,
        sql`(${zenhaPedidos.ultimaConsultaEm} is null
          or ${zenhaPedidos.ultimaConsultaEm} < now() - make_interval(secs => ${INTERVALO_MINIMO_ENTRE_CONSULTAS_SEGUNDOS}::int))`,
      ),
    )
    .returning({ id: zenhaPedidos.id });
  return reivindicado !== undefined;
}

/**
 * A rede de segurança do webhook: consulta no gateway os pedidos que ainda
 * esperam resposta e aplica o que encontrar. Devolve quantos mudaram de estado.
 *
 * FORA de qualquer transação de quem chama, de propósito: são até `limite` idas
 * HTTP de 10s cada, e cada transição abre a própria transação curta em
 * `confirmarPedido`/`registrarEstorno`. Sem lock entre instâncias — duas
 * varreduras no mesmo pedido disputam o mesmo `UPDATE ... WHERE status`, e a
 * segunda perde em silêncio, que é o resultado certo.
 *
 * Reexamina também os `expirado` recentes (ver JANELA_DO_EXPIRADO_HORAS): é por
 * aqui que o Pix pago no último segundo vira crédito mesmo depois de a
 * expiração ter passado na frente.
 */
export async function reconciliarPedidos(
  gateway: GatewayDePagamento = mercadoPago,
  limite = 20,
): Promise<number> {
  if (!gateway.configurado()) return 0;

  const candidatos = await db
    .select({ id: zenhaPedidos.id, gatewayId: zenhaPedidos.gatewayId, status: zenhaPedidos.status })
    .from(zenhaPedidos)
    .where(
      and(
        isNotNull(zenhaPedidos.gatewayId),
        sql`(
          (${zenhaPedidos.status} = 'pendente'
            and ${zenhaPedidos.criadoEm} < now() - make_interval(secs => ${IDADE_MINIMA_PARA_SONDAR_SEGUNDOS}::int))
          or (${zenhaPedidos.status} = 'expirado'
            and ${zenhaPedidos.expiraEm} > now() - make_interval(hours => ${JANELA_DO_EXPIRADO_HORAS}::int))
        )`,
      ),
    )
    .orderBy(asc(zenhaPedidos.criadoEm))
    .limit(limite);

  const comeco = Date.now();
  let mudaram = 0;
  for (const pedido of candidatos) {
    if (pedido.gatewayId === null) continue;
    // Duração medida no relógio do PROCESSO, e não contra uma coluna do banco —
    // é a única conta de tempo daqui que `Date.now()` responde certo.
    if (Date.now() - comeco > ORCAMENTO_DA_VARREDURA_MS) break;
    // Carimba a consulta também aqui: o que a varredura acabou de perguntar não
    // precisa ser perguntado de novo pela sonda da tela um segundo depois. O
    // resultado do claim não gateia a varredura — ela é a rede de segurança e
    // roda no máximo uma vez por minuto.
    await db
      .update(zenhaPedidos)
      .set({ ultimaConsultaEm: sql`now()` })
      .where(eq(zenhaPedidos.id, pedido.id));
    const consulta = await gateway.consultarPagamento(pedido.gatewayId);
    // Gateway fora do ar ou pagamento sumido: nada a decidir agora — a próxima
    // varredura tenta de novo, e `nao-encontrado` persistente acaba caindo na
    // expiração normal.
    if (!consulta.ok) continue;

    if (consulta.status === "pago") {
      if (await confirmarPedido(db, pedido.id, consulta.bruto)) mudaram += 1;
    } else if (consulta.status === "estornado") {
      if (await registrarEstorno(db, pedido.id, consulta.bruto)) mudaram += 1;
    } else if (consulta.status === "expirado" && pedido.status === "pendente") {
      const [expirou] = await db
        .update(zenhaPedidos)
        .set({ status: "expirado", ultimoEvento: consulta.bruto })
        .where(and(eq(zenhaPedidos.id, pedido.id), eq(zenhaPedidos.status, "pendente")))
        .returning({ id: zenhaPedidos.id });
      if (expirou) mudaram += 1;
    }
  }
  return mudaram;
}

/**
 * A varredura da recarga: expira o que venceu e reconcilia o que espera. É a
 * irmã de processarPendencias e roda nos mesmos gatilhos (o `after()` do layout
 * e o cron) — mas por fora da transação de lá, pela razão do cabeçalho de
 * `reconciliarPedidos`.
 */
export async function processarRecargas(
  gateway: GatewayDePagamento = mercadoPago,
): Promise<{ expirados: number; reconciliados: number }> {
  const expirados = await expirarPedidosVencidos(db);
  const reconciliados = await reconciliarPedidos(gateway);
  return { expirados, reconciliados };
}

/**
 * A sonda da tela do pedido: devolve o status atual e, quando o pedido ainda
 * espera e já tem idade para valer a chamada, consulta o gateway UMA vez antes
 * de responder.
 *
 * É o que faz o fluxo funcionar em desenvolvimento (onde webhook não alcança
 * localhost) e encurta o caminho feliz em produção: quem está com a tela aberta
 * vê o crédito segundos depois de pagar, sem depender do retry do webhook.
 * A concorrência com o webhook é a mesma disputa de sempre pelo
 * `UPDATE ... WHERE status` — um credita, o outro faz no-op.
 *
 * Quem decide se ESTA chamada vale uma ida ao gateway é `reivindicarConsulta`,
 * em SQL: idade mínima do pedido e intervalo mínimo desde a última consulta, no
 * relógio do banco. O vigia da tela pergunta a cada 5s; o gateway ouve bem
 * menos que isso.
 */
export async function sondarPedido(
  playerId: number,
  pedidoId: number,
  gateway: GatewayDePagamento = mercadoPago,
): Promise<ZenhaPedido | null> {
  const pedido = await lerPedidoDoJogador(playerId, pedidoId);
  if (!pedido) return null;
  if (pedido.status !== "pendente" || pedido.gatewayId === null || !gateway.configurado()) {
    return pedido;
  }

  if (!(await reivindicarConsulta(db, pedido.id))) return pedido;

  const consulta = await gateway.consultarPagamento(pedido.gatewayId);
  if (consulta.ok && consulta.status === "pago") {
    await confirmarPedido(db, pedido.id, consulta.bruto);
  } else if (consulta.ok && consulta.status === "expirado") {
    await db
      .update(zenhaPedidos)
      .set({ status: "expirado", ultimoEvento: consulta.bruto })
      .where(and(eq(zenhaPedidos.id, pedido.id), eq(zenhaPedidos.status, "pendente")));
  }

  return lerPedidoDoJogador(playerId, pedidoId);
}

/**
 * Acha um pedido pelo id do pagamento no gateway — o caminho do webhook, que só
 * conhece o id de lá.
 */
export async function lerPedidoPorGatewayId(gatewayId: string): Promise<ZenhaPedido | null> {
  const [pedido] = await db
    .select()
    .from(zenhaPedidos)
    .where(eq(zenhaPedidos.gatewayId, gatewayId));
  return pedido ?? null;
}
