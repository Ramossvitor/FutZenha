// O despacho de push contra o banco de verdade: o claim at-most-once, o lock
// entre instâncias, o escopo por jogador, a auto-limpeza de assinatura morta e
// o kill switch. As funções puras moram na camada unit (push-envio.test.ts).
//
// web-push é MOCKADO SEMPRE: a lib usa o https do Node, não fetch — o bloqueio
// de fetch do setup-integration NÃO a intercepta, e as chaves fake do stubEnv
// não impediriam uma tentativa real de rede. O guard de VAPID_PRIVATE_KEY no
// setup é a rede de segurança; este mock é a prática.

import { afterEach, describe, expect, it, vi } from "vitest";
import { eq, isNull, sql } from "drizzle-orm";
import webpush from "web-push";
import { db } from "@/db";
import { notifications, pushSubscriptions, type Player } from "@/db/schema";
import { notificar } from "@/lib/notifications";
import {
  agendarDespachoDePush,
  despacharPush,
  LOCK_PUSH,
  reiniciarThrottleDePush,
} from "@/lib/push-envio";
import { criarJogadorComConta } from "@/test/fixtures";
import { flushAfter } from "@/test/after-flush";

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(async () => ({ statusCode: 201 })),
  },
}));

const enviar = vi.mocked(webpush.sendNotification);

// Chaves com forma plausível: o setVapidDetails está mockado, mas manter o
// formato evita que um dia o mock caia e o teste passe por acidente.
function comChavesFake() {
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "chave-publica-fake");
  vi.stubEnv("VAPID_PRIVATE_KEY", "chave-privada-fake");
}

afterEach(() => {
  vi.unstubAllEnvs();
  reiniciarThrottleDePush();
});

// Com conta, sempre: o despacho junta `users` para não mandar push de conta
// desativada, então jogador sem conta não tem para onde receber — como em
// produção, onde a assinatura só nasce dentro de uma sessão logada.
async function jogadorInscrito(sufixo: string, extraConta: { active?: boolean } = {}) {
  const { jogador } = await criarJogadorComConta({}, extraConta);
  await inscrever(jogador, sufixo);
  return jogador;
}

async function avisar(jogador: Player, chave = "teste:1") {
  await db.transaction((tx) =>
    notificar(tx, [
      {
        playerId: jogador.id,
        type: "pelada_criada",
        title: "Pelada marcada",
        body: "quinta, 20h",
        href: "/pelada/1",
        dedupeKey: chave,
      },
    ]),
  );
}

async function inscrever(jogador: Player, sufixo: string) {
  await db.insert(pushSubscriptions).values({
    playerId: jogador.id,
    endpoint: `https://fcm.googleapis.com/fcm/send/${sufixo}`,
    p256dh: "p256dh-fake",
    auth: "auth-fake",
  });
}

const pendentes = () =>
  db.select().from(notifications).where(isNull(notifications.pushDispatchedAt));

const zerado = { enviadas: 0, falhas: 0, assinaturasRemovidas: 0, chavesRecusadas: 0 };

describe("despacharPush", () => {
  it("sem chaves é no-op de verdade: nem marca, nem envia", async () => {
    const jogador = await jogadorInscrito("device-1");
    await avisar(jogador);

    expect(await despacharPush()).toEqual({ ...zerado, ignoradasPorIdade: 0 });
    expect(enviar).not.toHaveBeenCalled();
    expect(await pendentes()).toHaveLength(1);
  });

  it("envia um push por assinatura do jogador e não repete na varredura seguinte", async () => {
    comChavesFake();
    const jogador = await jogadorInscrito("celular");
    await inscrever(jogador, "tablet");
    await avisar(jogador);

    const resultado = await despacharPush();

    expect(resultado).toEqual({ ...zerado, enviadas: 2, ignoradasPorIdade: 0 });
    expect(await pendentes()).toHaveLength(0);
    const payload = JSON.parse(String(enviar.mock.calls[0][1]));
    expect(payload).toMatchObject({ title: "Pelada marcada", href: "/pelada/1" });

    enviar.mockClear();
    expect(await despacharPush()).toEqual({ ...zerado, ignoradasPorIdade: 0 });
    expect(enviar).not.toHaveBeenCalled();
  });

  // O erro que nenhum teste de um jogador só pega: cada device tem que receber
  // o aviso do SEU dono. Trocar `porJogador.get(aviso.playerId)` pela lista
  // inteira mandaria o aviso de todo mundo para todo device — vazamento entre
  // contas com a suíte inteira verde.
  it("cada device recebe só o aviso do próprio jogador", async () => {
    comChavesFake();
    const ana = await jogadorInscrito("device-ana");
    const bruno = await jogadorInscrito("device-bruno");
    await avisar(ana, "aviso:ana");
    await avisar(bruno, "aviso:bruno");

    const resultado = await despacharPush();

    expect(resultado).toEqual({ ...zerado, enviadas: 2, ignoradasPorIdade: 0 });
    const porEndpoint = new Map(
      enviar.mock.calls.map(([sub, payload]) => [
        (sub as { endpoint: string }).endpoint,
        JSON.parse(String(payload)).href,
      ]),
    );
    expect(porEndpoint.get("https://fcm.googleapis.com/fcm/send/device-ana")).toBe("/pelada/1");
    expect(porEndpoint.size).toBe(2);
    // Duas notificações × dois devices seriam 4 chamadas — o escopo é o que
    // mantém em 2.
    expect(enviar).toHaveBeenCalledTimes(2);
  });

  // A assinatura sobrevive ao logout e à desativação da conta: sem o join com
  // users, o aparelho de quem perdeu o acesso continuaria recebendo avisos.
  it("conta desativada não recebe push, mas o aviso é marcado igual", async () => {
    comChavesFake();
    const desativado = await jogadorInscrito("device-fora", { active: false });
    await avisar(desativado);

    expect(await despacharPush()).toEqual({ ...zerado, ignoradasPorIdade: 0 });
    expect(enviar).not.toHaveBeenCalled();
    expect(await pendentes()).toHaveLength(0);
  });

  it("assinatura morta (410) é removida sem contar como falha", async () => {
    comChavesFake();
    const jogador = await jogadorInscrito("device-velho");
    await avisar(jogador);
    enviar.mockRejectedValueOnce(Object.assign(new Error("Gone"), { statusCode: 410 }));

    const resultado = await despacharPush();

    expect(resultado).toEqual({ ...zerado, assinaturasRemovidas: 1, ignoradasPorIdade: 0 });
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);
  });

  // 403 é "esta assinatura não foi feita com a sua chave VAPID" — um fato sobre
  // o REMETENTE, que chega igual para todo endpoint. Apagar por 403 zerava a
  // tabela inteira num deploy com o par de chaves trocado.
  it("403 não apaga assinatura — é problema de config, não device morto", async () => {
    comChavesFake();
    const jogador = await jogadorInscrito("device-1");
    await avisar(jogador);
    enviar.mockRejectedValueOnce(Object.assign(new Error("Forbidden"), { statusCode: 403 }));

    const resultado = await despacharPush();

    expect(resultado).toEqual({ ...zerado, chavesRecusadas: 1, ignoradasPorIdade: 0 });
    expect(await db.select().from(pushSubscriptions)).toHaveLength(1);
  });

  it("erro transitório conta como falha e a assinatura fica", async () => {
    comChavesFake();
    const jogador = await jogadorInscrito("device-1");
    await avisar(jogador);
    enviar.mockRejectedValueOnce(Object.assign(new Error("Boom"), { statusCode: 500 }));

    const resultado = await despacharPush();

    expect(resultado).toEqual({ ...zerado, falhas: 1, ignoradasPorIdade: 0 });
    expect(await db.select().from(pushSubscriptions)).toHaveLength(1);
    // At-most-once: o claim já marcou — a falha não volta para a fila. A caixa
    // in-app é a garantia; o push é aceleração.
    expect(await pendentes()).toHaveLength(0);
  });

  // Ligar a chave VAPID pela primeira vez (ou religá-la) encontraria a fila
  // inteira acumulada desde o deploy: sem o corte por idade, anos de caixa de
  // entrada sairiam como novidade na tela de bloqueio.
  it("aviso velho é marcado mas não vira push", async () => {
    comChavesFake();
    const jogador = await jogadorInscrito("device-1");
    // Relógio do BANCO, regra da casa — nunca new Date() em SQL cru.
    await db.insert(notifications).values({
      playerId: jogador.id,
      type: "pelada_criada",
      title: "Pelada de antigamente",
      dedupeKey: "teste:velho",
      createdAt: sql`now() - interval '3 days'`,
    });
    await avisar(jogador, "teste:novo");

    const resultado = await despacharPush();

    expect(resultado).toEqual({ ...zerado, enviadas: 1, ignoradasPorIdade: 1 });
    expect(await pendentes()).toHaveLength(0);
    expect(JSON.parse(String(enviar.mock.calls[0][1])).title).toBe("Pelada marcada");
  });

  it("sem assinatura nenhuma, o claim marca mesmo assim — at-most-once", async () => {
    comChavesFake();
    const { jogador } = await criarJogadorComConta();
    await avisar(jogador);

    expect(await despacharPush()).toEqual({ ...zerado, ignoradasPorIdade: 0 });
    expect(await pendentes()).toHaveLength(0);
    expect(enviar).not.toHaveBeenCalled();
  });

  it("com o lock tomado por outra 'instância', volta de mãos vazias", async () => {
    comChavesFake();
    const jogador = await jogadorInscrito("device-1");
    await avisar(jogador);

    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_PUSH}::bigint)`);
      // Roda noutra conexão do pool, como rodaria noutra instância da Vercel.
      expect(await despacharPush()).toEqual({ ...zerado, ignoradasPorIdade: 0 });
    });

    // Nada foi claimado: o aviso continua pendente para a próxima varredura.
    expect(await pendentes()).toHaveLength(1);
  });

  it("o claim atualiza só o lote e preserva o que já tinha saído", async () => {
    comChavesFake();
    const jogador = await jogadorInscrito("device-1");
    await avisar(jogador, "teste:antigo");
    await despacharPush();
    const [antigo] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.dedupeKey, "teste:antigo"));

    await avisar(jogador, "teste:novo");
    await despacharPush();

    const [aindaAntigo] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.dedupeKey, "teste:antigo"));
    expect(aindaAntigo.pushDispatchedAt).toEqual(antigo.pushDispatchedAt);
  });
});

// O elo que nenhum teste de action alcança: as chaves VAPID são ausentes em
// todo o resto da suíte (por design), então em qualquer outro arquivo o
// agendarDespachoDePush volta na primeira linha. Aqui ele roda inteiro.
describe("agendarDespachoDePush", () => {
  it("`imediato` fura o throttle; sem ele, a segunda chamada do minuto não despacha", async () => {
    comChavesFake();
    const jogador = await jogadorInscrito("device-1");
    await avisar(jogador, "aviso:1");

    // Primeira do minuto: passa.
    agendarDespachoDePush();
    await flushAfter();
    expect(enviar).toHaveBeenCalledTimes(1);

    // Segunda no mesmo minuto: o throttle segura, e o aviso novo fica na fila.
    await avisar(jogador, "aviso:2");
    agendarDespachoDePush();
    await flushAfter();
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(await pendentes()).toHaveLength(1);

    // É para isto que serve o `true` nas actions sensíveis a tempo (vaga
    // aberta, pelada nova): o aviso sai nesta invocação, não daqui a um minuto.
    agendarDespachoDePush(true);
    await flushAfter();
    expect(enviar).toHaveBeenCalledTimes(2);
    expect(await pendentes()).toHaveLength(0);
  });

  // Se alguém mover o agendarDespachoDePush para DENTRO da transação da action,
  // o claim roda antes do commit, não enxerga a linha e o push some em silêncio
  // — com todos os testes de notificação ainda verdes.
  it("agendado depois do commit, o claim enxerga o aviso da transação", async () => {
    comChavesFake();
    const jogador = await jogadorInscrito("device-1");

    await db.transaction((tx) =>
      notificar(tx, [
        {
          playerId: jogador.id,
          type: "pelada_times_sorteados",
          title: "Times sorteados",
          href: "/pelada/9",
          dedupeKey: "pelada:9:sorteada",
        },
      ]),
    );
    agendarDespachoDePush(true);
    await flushAfter();

    expect(enviar).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(enviar.mock.calls[0][1])).href).toBe("/pelada/9");
  });

  it("sem chaves não agenda nada", async () => {
    const jogador = await jogadorInscrito("device-1");
    await avisar(jogador);

    agendarDespachoDePush(true);
    await flushAfter();

    expect(enviar).not.toHaveBeenCalled();
    expect(await pendentes()).toHaveLength(1);
  });
});
