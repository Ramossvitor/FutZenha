// A recarga contra o banco de verdade. O que só ele prova:
//
// 1. o exatamente-uma-vez do crédito — `UPDATE ... WHERE status = 'pendente'
//    RETURNING` + a unique de dedupe do ledger;
// 2. o fecho `saldo == sum(amount)` depois de cada caminho (o mesmo invariante
//    de carteira.integration.test.ts);
// 3. o estorno que NÃO toca o ledger;
// 4. a varredura que expira, reconcilia e revive o pago-no-limite.
//
// O gateway é o fake de fixtures-recarga — o transporte do MP tem os seus
// testes unitários e nenhum teste daqui fala HTTP.

import { describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { notifications, zenhaCarteiras, zenhaLedger, zenhaPedidos, type Player } from "@/db/schema";
import {
  confirmarPedido,
  criarPedido,
  expirarPedidosVencidos,
  lerPedidoDoJogador,
  reconciliarPedidos,
  registrarEstorno,
  sondarPedido,
} from "@/lib/recarga";
import { criarJogadorComConta } from "@/test/fixtures";
import { criarPacote, criarPedidoDireto, gatewayFake } from "@/test/fixtures-recarga";

async function conferirFecho(jogador: Player): Promise<number> {
  const [carteira] = await db
    .select({ saldo: zenhaCarteiras.saldo })
    .from(zenhaCarteiras)
    .where(eq(zenhaCarteiras.playerId, jogador.id));
  const [soma] = await db
    .select({ total: sql<number>`coalesce(sum(${zenhaLedger.amount}), 0)::int` })
    .from(zenhaLedger)
    .where(eq(zenhaLedger.playerId, jogador.id));

  const saldo = carteira?.saldo ?? 0;
  expect(saldo).toBe(soma?.total ?? 0);
  expect(saldo).toBeGreaterThanOrEqual(0);
  return saldo;
}

async function linhasDoLedger(playerId: number) {
  return db
    .select()
    .from(zenhaLedger)
    .where(eq(zenhaLedger.playerId, playerId))
    .orderBy(zenhaLedger.id);
}

describe("criarPedido", () => {
  it("congela o pacote no pedido e guarda o QR da cobrança", async () => {
    const { jogador } = await criarJogadorComConta();
    const pacote = await criarPacote({ precoCentavos: 1000, zenhas: 250 });
    const gateway = gatewayFake();

    const resultado = await criarPedido(jogador.id, pacote.id, gateway);

    expect(resultado).not.toBeTypeOf("string");
    const { id } = resultado as { id: number };
    const pedido = await lerPedidoDoJogador(jogador.id, id);
    expect(pedido).toMatchObject({
      status: "pendente",
      precoCentavos: 1000,
      zenhas: 250,
      gateway: "mercadopago",
      qrCode: "00020126fakepixcopiaecola",
    });
    expect(pedido!.gatewayId).not.toBeNull();
    expect(pedido!.expiraEm).not.toBeNull();

    // O gateway recebeu centavos e a MESMA chave que ficou no pedido — é ela
    // que torna o retry de rede incapaz de criar segunda cobrança.
    expect(gateway.criadas).toHaveLength(1);
    expect(gateway.criadas[0].valorCentavos).toBe(1000);
    expect(gateway.criadas[0].idempotencyKey).toBe(pedido!.idempotencyKey);

    // Pedido criado NÃO é zenha creditada: o clique não credita nunca.
    expect(await linhasDoLedger(jogador.id)).toHaveLength(0);
    await conferirFecho(jogador);
  });

  it("recusa pacote fora de venda — e não fala com o gateway", async () => {
    const { jogador } = await criarJogadorComConta();
    const pacote = await criarPacote({ ativo: false });
    const gateway = gatewayFake();

    expect(await criarPedido(jogador.id, pacote.id, gateway)).toBe("pacote-indisponivel");
    expect(gateway.criadas).toHaveLength(0);
  });

  // Clicar de novo devolve o QR que já existe. É o teto de cobranças abertas por
  // jogador: sem ele, cada clique abriria uma cobrança de verdade no gateway.
  it("reaproveita o pendente vivo do mesmo pacote em vez de abrir segunda cobrança", async () => {
    const { jogador } = await criarJogadorComConta();
    const pacote = await criarPacote();
    const gateway = gatewayFake();

    const primeiro = await criarPedido(jogador.id, pacote.id, gateway);
    const segundo = await criarPedido(jogador.id, pacote.id, gateway);

    expect(segundo).toEqual(primeiro);
    expect(gateway.criadas).toHaveLength(1);
    expect(await db.select().from(zenhaPedidos).where(eq(zenhaPedidos.playerId, jogador.id))).toHaveLength(1);
  });

  it("o pendente VENCIDO não é reaproveitado — o QR de lá já morreu", async () => {
    const { jogador } = await criarJogadorComConta();
    const pacote = await criarPacote();
    await criarPedidoDireto(jogador.id, pacote, { criadoHaMinutos: 60, expiraEmMinutos: 30 });
    const gateway = gatewayFake();

    const novo = await criarPedido(jogador.id, pacote.id, gateway);

    expect(novo).not.toBeTypeOf("string");
    expect(gateway.criadas).toHaveLength(1);
  });

  // O teto é por PACOTE: quem mudou de ideia sobre o tamanho da compra precisa
  // de um QR do valor novo, não do antigo.
  it("pacote diferente ganha cobrança própria", async () => {
    const { jogador } = await criarJogadorComConta();
    const pequeno = await criarPacote({ precoCentavos: 1000, zenhas: 250 });
    const grande = await criarPacote({ precoCentavos: 4000, zenhas: 1200 });
    const gateway = gatewayFake();

    const a = await criarPedido(jogador.id, pequeno.id, gateway);
    const b = await criarPedido(jogador.id, grande.id, gateway);

    expect(a).not.toEqual(b);
    expect(gateway.criadas).toHaveLength(2);
  });

  it("falha do gateway grava o pedido cancelado, sem QR e sem cobrança", async () => {
    const { jogador } = await criarJogadorComConta();
    const pacote = await criarPacote();
    const gateway = gatewayFake({ criar: () => ({ ok: false, motivo: "indisponivel" }) });

    expect(await criarPedido(jogador.id, pacote.id, gateway)).toBe("gateway-indisponivel");

    const [registro] = await db
      .select()
      .from(zenhaPedidos)
      .where(eq(zenhaPedidos.playerId, jogador.id));
    expect(registro.status).toBe("cancelado");
    expect(registro.gatewayId).toBeNull();
  });
});

describe("confirmarPedido", () => {
  it("credita UMA vez, com a linha do extrato apontando para o pedido", async () => {
    const { jogador } = await criarJogadorComConta();
    const pacote = await criarPacote({ zenhas: 550 });
    const pedido = await criarPedidoDireto(jogador.id, pacote);

    expect(await confirmarPedido(db, pedido.id)).toBe(true);
    // A segunda confirmação (o retry do webhook, a varredura chegando junto) é
    // no-op — e diz isso no retorno.
    expect(await confirmarPedido(db, pedido.id)).toBe(false);

    const linhas = await linhasDoLedger(jogador.id);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      motivo: "recarga",
      amount: 550,
      dedupeKey: `recarga:pedido:${pedido.id}`,
      pedidoId: pedido.id,
    });
    expect(await conferirFecho(jogador)).toBe(550);

    const depois = await lerPedidoDoJogador(jogador.id, pedido.id);
    expect(depois!.status).toBe("pago");
    expect(depois!.pagoEm).not.toBeNull();

    // O aviso fecha o ciclo para quem fechou a aba antes de o Pix cair.
    const avisos = await db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.playerId, jogador.id), eq(notifications.type, "recarga_confirmada")),
      );
    expect(avisos).toHaveLength(1);
    expect(avisos[0].href).toBe("/zenhas");
  });

  // O Pix pago no último segundo pode cruzar com a expiração — o dinheiro saiu,
  // então o expirado revive.
  it("aceita reviver um pedido expirado", async () => {
    const { jogador } = await criarJogadorComConta();
    const pacote = await criarPacote({ zenhas: 250 });
    const pedido = await criarPedidoDireto(jogador.id, pacote, { status: "expirado" });

    expect(await confirmarPedido(db, pedido.id)).toBe(true);
    expect(await conferirFecho(jogador)).toBe(250);
  });

  it("não confirma cancelado nem estornado", async () => {
    const { jogador } = await criarJogadorComConta();
    const pacote = await criarPacote();
    const cancelado = await criarPedidoDireto(jogador.id, pacote, { status: "cancelado" });
    const estornado = await criarPedidoDireto(jogador.id, pacote, { status: "estornado" });

    expect(await confirmarPedido(db, cancelado.id)).toBe(false);
    expect(await confirmarPedido(db, estornado.id)).toBe(false);
    expect(await linhasDoLedger(jogador.id)).toHaveLength(0);
  });
});

describe("registrarEstorno", () => {
  it("marca o pedido, avisa os admins e NÃO toca o ledger", async () => {
    const { jogador } = await criarJogadorComConta();
    const { jogador: admin } = await criarJogadorComConta({}, { isPlatformAdmin: true });
    const pacote = await criarPacote({ zenhas: 250 });
    const pedido = await criarPedidoDireto(jogador.id, pacote);
    await confirmarPedido(db, pedido.id);
    const saldoAntes = await conferirFecho(jogador);

    expect(await registrarEstorno(db, pedido.id)).toBe(true);

    // O saldo fica: estorno de gateway não debita zenha — quem decide é gente.
    expect(await conferirFecho(jogador)).toBe(saldoAntes);
    const depois = await lerPedidoDoJogador(jogador.id, pedido.id);
    expect(depois!.status).toBe("estornado");
    expect(depois!.estornadoEm).not.toBeNull();

    const avisos = await db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.playerId, admin.id), eq(notifications.type, "recarga_estornada")),
      );
    expect(avisos).toHaveLength(1);
    expect(avisos[0].href).toBe("/admin/recargas");
  });

  it("só sai de pago — estorno de pendente é ruído do gateway", async () => {
    const { jogador } = await criarJogadorComConta();
    const pacote = await criarPacote();
    const pedido = await criarPedidoDireto(jogador.id, pacote);

    expect(await registrarEstorno(db, pedido.id)).toBe(false);
    expect((await lerPedidoDoJogador(jogador.id, pedido.id))!.status).toBe("pendente");
  });
});

describe("expirarPedidosVencidos", () => {
  it("expira só o que venceu", async () => {
    const { jogador } = await criarJogadorComConta();
    const pacote = await criarPacote();
    const vencido = await criarPedidoDireto(jogador.id, pacote, {
      criadoHaMinutos: 60,
      expiraEmMinutos: 30,
    });
    const vivo = await criarPedidoDireto(jogador.id, pacote, {
      criadoHaMinutos: 1,
      expiraEmMinutos: 30,
    });

    expect(await expirarPedidosVencidos(db)).toBe(1);

    expect((await lerPedidoDoJogador(jogador.id, vencido.id))!.status).toBe("expirado");
    expect((await lerPedidoDoJogador(jogador.id, vivo.id))!.status).toBe("pendente");
  });
});

describe("reconciliarPedidos", () => {
  it("confirma pelo gateway o pendente cujo webhook não chegou", async () => {
    const { jogador } = await criarJogadorComConta();
    const pacote = await criarPacote({ zenhas: 250 });
    const pedido = await criarPedidoDireto(jogador.id, pacote, { criadoHaMinutos: 5 });
    const gateway = gatewayFake({
      consultar: () => ({ ok: true, status: "pago", bruto: { status: "approved" } }),
    });

    expect(await reconciliarPedidos(gateway)).toBe(1);

    expect(gateway.consultadas).toEqual([pedido.gatewayId]);
    expect((await lerPedidoDoJogador(jogador.id, pedido.id))!.status).toBe("pago");
    expect(await conferirFecho(jogador)).toBe(250);
  });

  it("não consulta pedido recém-criado — o webhook tem prioridade", async () => {
    const { jogador } = await criarJogadorComConta();
    const pacote = await criarPacote();
    await criarPedidoDireto(jogador.id, pacote, { criadoHaMinutos: 0 });
    const gateway = gatewayFake();

    expect(await reconciliarPedidos(gateway)).toBe(0);
    expect(gateway.consultadas).toHaveLength(0);
  });

  // A ponta solta do pago-no-limite: a NOSSA varredura expirou, mas o gateway
  // diz pago — o expirado recente ainda é reexaminado e revive.
  it("revive o expirado recente que o gateway diz pago", async () => {
    const { jogador } = await criarJogadorComConta();
    const pacote = await criarPacote({ zenhas: 250 });
    const pedido = await criarPedidoDireto(jogador.id, pacote, {
      status: "expirado",
      criadoHaMinutos: 40,
      expiraEmMinutos: 30,
    });
    const gateway = gatewayFake({
      consultar: () => ({ ok: true, status: "pago", bruto: {} }),
    });

    expect(await reconciliarPedidos(gateway)).toBe(1);

    expect((await lerPedidoDoJogador(jogador.id, pedido.id))!.status).toBe("pago");
    expect(await conferirFecho(jogador)).toBe(250);
  });

  it("gateway fora do ar não muda nada — a próxima varredura tenta de novo", async () => {
    const { jogador } = await criarJogadorComConta();
    const pacote = await criarPacote();
    const pedido = await criarPedidoDireto(jogador.id, pacote, { criadoHaMinutos: 5 });
    const gateway = gatewayFake({ consultar: () => ({ ok: false, motivo: "indisponivel" }) });

    expect(await reconciliarPedidos(gateway)).toBe(0);
    expect((await lerPedidoDoJogador(jogador.id, pedido.id))!.status).toBe("pendente");
  });

  it("sem credencial é no-op silencioso", async () => {
    const gateway = gatewayFake({ configurado: false });
    expect(await reconciliarPedidos(gateway)).toBe(0);
  });
});

describe("sondarPedido", () => {
  it("pedido de outra pessoa é null — a mesma resposta de 'não existe'", async () => {
    const { jogador: dono } = await criarJogadorComConta();
    const { jogador: outro } = await criarJogadorComConta();
    const pacote = await criarPacote();
    const pedido = await criarPedidoDireto(dono.id, pacote);

    expect(await sondarPedido(outro.id, pedido.id, gatewayFake())).toBeNull();
    expect(await sondarPedido(dono.id, 99999, gatewayFake())).toBeNull();
  });

  it("consulta o gateway e credita quando o Pix caiu", async () => {
    const { jogador } = await criarJogadorComConta();
    const pacote = await criarPacote({ zenhas: 250 });
    const pedido = await criarPedidoDireto(jogador.id, pacote, { criadoHaMinutos: 5 });
    const gateway = gatewayFake({ consultar: () => ({ ok: true, status: "pago", bruto: {} }) });

    const depois = await sondarPedido(jogador.id, pedido.id, gateway);

    expect(depois!.status).toBe("pago");
    expect(await conferirFecho(jogador)).toBe(250);
  });

  it("pedido novo demais não vale uma ida ao gateway", async () => {
    const { jogador } = await criarJogadorComConta();
    const pacote = await criarPacote();
    const pedido = await criarPedidoDireto(jogador.id, pacote, { criadoHaMinutos: 0 });
    const gateway = gatewayFake();

    const depois = await sondarPedido(jogador.id, pedido.id, gateway);

    expect(depois!.status).toBe("pendente");
    expect(gateway.consultadas).toHaveLength(0);
  });

  // O freio do tique de 5s do vigia da tela: a segunda sonda em seguida não
  // vale outra ida ao MP. Sem ele são ~350 chamadas pela vida de um QR, por aba.
  it("duas sondas seguidas consultam o gateway UMA vez", async () => {
    const { jogador } = await criarJogadorComConta();
    const pacote = await criarPacote();
    const pedido = await criarPedidoDireto(jogador.id, pacote, { criadoHaMinutos: 5 });
    const gateway = gatewayFake();

    await sondarPedido(jogador.id, pedido.id, gateway);
    await sondarPedido(jogador.id, pedido.id, gateway);
    await sondarPedido(jogador.id, pedido.id, gateway);

    expect(gateway.consultadas).toHaveLength(1);
  });

  // A prova de que a idade é medida pelo relógio do BANCO: com a conta em JS
  // sobre `criado_em` (timestamp SEM fuso, que o driver reinterpreta no fuso do
  // processo), este caso passa em UTC e falha em qualquer máquina fora dele —
  // que é onde a recarga é desenvolvida.
  it("mede a idade do pedido pelo relógio do banco, não pelo do processo", async () => {
    const { jogador } = await criarJogadorComConta();
    const pacote = await criarPacote({ zenhas: 250 });
    const pedido = await criarPedidoDireto(jogador.id, pacote, { criadoHaMinutos: 5 });
    const gateway = gatewayFake({ consultar: () => ({ ok: true, status: "pago", bruto: {} }) });

    const depois = await sondarPedido(jogador.id, pedido.id, gateway);

    expect(gateway.consultadas).toEqual([pedido.gatewayId]);
    expect(depois!.status).toBe("pago");
  });
});
