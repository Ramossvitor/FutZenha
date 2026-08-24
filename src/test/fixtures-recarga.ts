// Construtores da recarga para os testes de integração.
//
// O gateway FAKE implementa o contrato de src/lib/pagamentos/gateway.ts e é
// injetado nas funções de src/lib/recarga.ts — os testes de domínio nunca tocam
// o transporte do Mercado Pago (que tem os seus próprios testes unitários, de
// fetch stubado). É a mesma divisão do e-mail: resend-fake stuba o transporte,
// mas aqui o contrato existe e injetar é mais honesto que interceptar.

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { zenhaPacotes, zenhaPedidos, type ZenhaPacote, type ZenhaPedido } from "@/db/schema";
import type {
  GatewayDePagamento,
  NovaCobrancaPix,
  ResultadoConsulta,
  ResultadoCriacao,
} from "@/lib/pagamentos/gateway";

let contador = 0;

export async function criarPacote(
  extra: Partial<typeof zenhaPacotes.$inferInsert> = {},
): Promise<ZenhaPacote> {
  contador += 1;
  const [pacote] = await db
    .insert(zenhaPacotes)
    .values({
      nome: `Pacote ${contador}`,
      precoCentavos: 1000,
      zenhas: 250,
      ordem: contador,
      ...extra,
    })
    .returning();
  return pacote;
}

/**
 * Um pedido inserido DIRETO, para montar cenário (a criação de verdade é papel
 * de `criarPedido`, com o gateway fake). Os carimbos retroativos saem do
 * relógio do BANCO, como toda fixture — ver o cabeçalho de fixtures.ts.
 */
export async function criarPedidoDireto(
  playerId: number,
  pacote: ZenhaPacote,
  opcoes: {
    status?: ZenhaPedido["status"];
    gatewayId?: string | null;
    criadoHaMinutos?: number;
    expiraEmMinutos?: number;
    /**
     * Recua o `pago_em` (e o `estornado_em`) sem mexer no `criado_em`. É o que
     * separa o mês da COMPRA do mês do PAGAMENTO — o caso que o caixa do painel
     * precisa contar pela data certa.
     */
    pagoHaDias?: number;
  } = {},
): Promise<ZenhaPedido> {
  contador += 1;
  const {
    status = "pendente",
    gatewayId = status === "cancelado" ? null : `mp-fake-${contador}`,
    criadoHaMinutos = 1,
    expiraEmMinutos = 30,
    pagoHaDias = 0,
  } = opcoes;
  const criadoHa = Math.trunc(criadoHaMinutos);
  const expira = Math.trunc(expiraEmMinutos);
  const pagoHa = Math.trunc(pagoHaDias);
  const desfecho =
    status === "pago" || status === "estornado"
      ? sql`now() - interval '${sql.raw(String(pagoHa))} days'`
      : null;
  const [pedido] = await db
    .insert(zenhaPedidos)
    .values({
      playerId,
      pacoteId: pacote.id,
      precoCentavos: pacote.precoCentavos,
      zenhas: pacote.zenhas,
      gateway: "mercadopago",
      gatewayId,
      idempotencyKey: `idem-fake-${contador}`,
      status,
      qrCode: gatewayId === null ? null : "00020126fakepixcopiaecola",
      qrCodeBase64: null,
      criadoEm: sql`now() - interval '${sql.raw(String(criadoHa))} minutes'`,
      expiraEm: sql`now() - interval '${sql.raw(String(criadoHa))} minutes' + interval '${sql.raw(String(expira))} minutes'`,
      pagoEm: desfecho,
      estornadoEm: status === "estornado" ? desfecho : null,
    })
    .returning();
  return pedido;
}

export type GatewayFake = GatewayDePagamento & {
  criadas: NovaCobrancaPix[];
  consultadas: string[];
};

/**
 * O gateway de mentira. `criar` e `consultar` definem as respostas; o fake
 * grava o que lhe pediram para o teste asserir.
 */
export function gatewayFake(
  opcoes: {
    configurado?: boolean;
    criar?: (cobranca: NovaCobrancaPix) => ResultadoCriacao;
    consultar?: (gatewayId: string) => ResultadoConsulta;
  } = {},
): GatewayFake {
  const criadas: NovaCobrancaPix[] = [];
  const consultadas: string[] = [];
  let sequencia = 0;
  return {
    nome: "mercadopago",
    criadas,
    consultadas,
    configurado: () => opcoes.configurado ?? true,
    async criarCobrancaPix(cobranca) {
      criadas.push(cobranca);
      if (opcoes.criar) return opcoes.criar(cobranca);
      sequencia += 1;
      return {
        ok: true,
        cobranca: {
          gatewayId: `mp-fake-criado-${sequencia}`,
          qrCode: "00020126fakepixcopiaecola",
          qrCodeBase64: "ZmFrZQ==",
        },
      };
    },
    async consultarPagamento(gatewayId) {
      consultadas.push(gatewayId);
      if (opcoes.consultar) return opcoes.consultar(gatewayId);
      return { ok: true, status: "pendente", bruto: { fake: true } };
    },
  };
}
