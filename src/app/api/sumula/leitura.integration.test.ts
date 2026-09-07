// A leitura da súmula pelo relógio contra o banco de verdade: quem entra (só
// Bearer — nunca cookie), qual fut a API escolhe quando o atalho não diz, e a
// forma do JSON que o Atalho consome (rótulos únicos, último gol por lado).

import { and, eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  desfazerLancamento,
  iniciarJogo,
  lancarGol,
} from "@/app/(esqueleto)/fut/[id]/sumula/actions";
import { db } from "@/db";
import { attendances, games, matchDays, players, users } from "@/db/schema";
import {
  confirmarPresenca,
  criarFut,
  criarJogadorComConta,
  criarTokenDeApi,
} from "@/test/fixtures";
import { criarGrupo, entrarNoGrupo } from "@/test/fixtures-grupo";
import {
  criarDelegado,
  formDeGol,
  formDeTimes,
  golsDoJogo,
  montarSumula,
  type Sumula,
} from "@/test/fixtures-sumula";
import { GET } from "./route";

const URL = "http://localhost/api/sumula";

function pedido(token: string | null, query = ""): Request {
  return new Request(`${URL}${query}`, {
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  });
}

async function ler(token: string | null, query = "") {
  const resposta = await GET(pedido(token, query));
  return { status: resposta.status, corpo: await resposta.json() };
}

/** Abre o jogo pelo painel — o admin de montarSumula está logado por cookie. */
async function abrirJogo(s: Sumula) {
  await iniciarJogo(s.fut.id, formDeTimes(s.timeAId, s.timeBId));
  const [jogo] = await db.select().from(games).where(eq(games.matchDayId, s.fut.id));
  return jogo;
}

describe("autenticação", () => {
  // O cookie do admin está no jar (montarSumula loga), e não vale de nada aqui:
  // a API é só Bearer, e é isso que a deixa sem CSRF.
  it("sem Bearer é 401 — mesmo com o cookie do admin no jar", async () => {
    await montarSumula();

    const { status, corpo } = await ler(null);

    expect(status).toBe(401);
    expect(corpo).toMatchObject({ erro: "token-invalido" });
    expect(typeof corpo.mensagem).toBe("string");
  });

  it("token revogado é 401", async () => {
    const s = await montarSumula();
    const token = await criarTokenDeApi(s.adminConta);
    await db.update(users).set({ apiTokenHash: null }).where(eq(users.id, s.adminConta.id));

    expect((await ler(token)).status).toBe(401);
  });

  it("a resposta não entra em cache", async () => {
    const s = await montarSumula();

    const resposta = await GET(pedido(await criarTokenDeApi(s.adminConta)));

    expect(resposta.headers.get("cache-control")).toBe("no-store");
  });
});

describe("qual fut", () => {
  it("quem não opera fut nenhum: 404", async () => {
    await montarSumula();
    const outro = await criarJogadorComConta();

    const { status, corpo } = await ler(await criarTokenDeApi(outro.conta));

    expect(status).toBe(404);
    expect(corpo.erro).toBe("sem-fut-para-operar");
  });

  it("fut encerrado não conta", async () => {
    const s = await montarSumula();
    const token = await criarTokenDeApi(s.adminConta);
    await db
      .update(matchDays)
      .set({ status: "finished", finishedAt: sql`now()` })
      .where(eq(matchDays.id, s.fut.id));

    expect((await ler(token)).status).toBe(404);
  });

  it("dois futs empatados na data: 409 com a lista", async () => {
    const s = await montarSumula();
    const segundo = await criarFut({
      createdByPlayerId: s.admin.id,
      status: "teams_drawn",
      location: "Outra quadra",
    });

    const { status, corpo } = await ler(await criarTokenDeApi(s.adminConta));

    expect(status).toBe(409);
    expect(corpo.erro).toBe("varios-futs");
    const ids = corpo.candidatos.map((c: { id: number }) => c.id).sort();
    expect(ids).toEqual([s.fut.id, segundo.id].sort());
    expect(corpo.candidatos.find((c: { id: number }) => c.id === segundo.id)).toMatchObject({
      local: "Outra quadra",
      data: segundo.date,
    });
  });

  it("o fut com jogo aberto vence o empate", async () => {
    const s = await montarSumula();
    await criarFut({ createdByPlayerId: s.admin.id, status: "teams_drawn" });
    await abrirJogo(s);

    const { status, corpo } = await ler(await criarTokenDeApi(s.adminConta));

    expect(status).toBe(200);
    expect(corpo.fut.id).toBe(s.fut.id);
  });

  it("sem jogo aberto, o fut de data mais próxima", async () => {
    const s = await montarSumula();
    const longe = await criarFut({ createdByPlayerId: s.admin.id, status: "teams_drawn" });
    // Datas pelo relógio do BANCO, no fuso do fut — o mesmo "hoje" que a API
    // compara (futs-operaveis.ts). Com `current_date` (UTC), depois das 21h de
    // Brasília o dia já virou, e "amanhã" e "hoje" trocariam de distância.
    await db
      .update(matchDays)
      .set({ date: sql`(now() at time zone 'America/Sao_Paulo')::date + 1` })
      .where(eq(matchDays.id, s.fut.id));
    await db
      .update(matchDays)
      .set({ date: sql`(now() at time zone 'America/Sao_Paulo')::date + 5` })
      .where(eq(matchDays.id, longe.id));

    const { corpo } = await ler(await criarTokenDeApi(s.adminConta));

    expect(corpo.fut.id).toBe(s.fut.id);
  });

  it("?fut= força um dos empatados; alheio, inexistente ou inválido não passa", async () => {
    const s = await montarSumula();
    const segundo = await criarFut({ createdByPlayerId: s.admin.id, status: "teams_drawn" });
    const token = await criarTokenDeApi(s.adminConta);

    expect((await ler(token, `?fut=${segundo.id}`)).corpo.fut.id).toBe(segundo.id);

    const alheio = await criarFut({ status: "teams_drawn" });
    expect((await ler(token, `?fut=${alheio.id}`)).status).toBe(404);
    expect((await ler(token, "?fut=999999")).status).toBe(404);
    expect((await ler(token, "?fut=abc")).status).toBe(400);
  });

  // Forçado, o fut é da pessoa — então a resposta pode dizer o que há com ele.
  it("fut forçado fora da janela da súmula diz o motivo", async () => {
    const s = await montarSumula();
    const token = await criarTokenDeApi(s.adminConta);

    await db.update(matchDays).set({ status: "scheduled" }).where(eq(matchDays.id, s.fut.id));
    expect((await ler(token, `?fut=${s.fut.id}`)).corpo.erro).toBe("sumula-indisponivel");

    await db
      .update(matchDays)
      .set({ status: "finished", finishedAt: sql`now()` })
      .where(eq(matchDays.id, s.fut.id));
    expect((await ler(token, `?fut=${s.fut.id}`)).corpo.erro).toBe("fut-encerrado");
  });

  it("admin do grupo enxerga o fut do grupo; organizador e membro não", async () => {
    const grupo = await criarGrupo();
    const admin = await criarJogadorComConta();
    const organizador = await criarJogadorComConta();
    const membro = await criarJogadorComConta();
    await entrarNoGrupo(grupo.id, admin.jogador, "admin");
    await entrarNoGrupo(grupo.id, organizador.jogador, "organizer");
    await entrarNoGrupo(grupo.id, membro.jogador, "member");
    const fut = await criarFut({ groupId: grupo.id, status: "teams_drawn" });

    expect((await ler(await criarTokenDeApi(admin.conta))).corpo.fut?.id).toBe(fut.id);
    expect((await ler(await criarTokenDeApi(organizador.conta))).status).toBe(404);
    expect((await ler(await criarTokenDeApi(membro.conta))).status).toBe(404);
  });

  it("delegado enxerga — e perde ao sair da lista", async () => {
    const s = await montarSumula();
    const delegado = await criarDelegado(s.fut);
    const token = await criarTokenDeApi(delegado.conta);

    expect((await ler(token)).corpo.fut?.id).toBe(s.fut.id);

    await db
      .update(attendances)
      .set({ status: "out" })
      .where(
        and(eq(attendances.matchDayId, s.fut.id), eq(attendances.playerId, delegado.jogador.id)),
      );
    expect((await ler(token)).status).toBe(404);
  });

  // O admin da plataforma opera qualquer fut, mas não está em qualquer fut.
  it("admin da plataforma: o fut em que está vence o que só alcança", async () => {
    const s = await montarSumula();
    const chefe = await criarJogadorComConta({}, { isPlatformAdmin: true });
    const token = await criarTokenDeApi(chefe.conta);

    // Só o fut alheio existe: o alcance de admin serve.
    expect((await ler(token)).corpo.fut?.id).toBe(s.fut.id);

    // Com um fut próprio, é o próprio — mesmo com o alheio de bola rolando.
    await abrirJogo(s);
    const meu = await criarFut({ createdByPlayerId: chefe.jogador.id, status: "teams_drawn" });
    expect((await ler(token)).corpo.fut?.id).toBe(meu.id);
  });

  // Estar na lista também é vínculo — o admin joga no fut de outro criador e
  // não pode cair no de um estranho que está com jogo aberto.
  it("admin da plataforma: a presença na lista é vínculo direto", async () => {
    const alheio = await montarSumula();
    await abrirJogo(alheio);
    const chefe = await criarJogadorComConta({}, { isPlatformAdmin: true });
    const token = await criarTokenDeApi(chefe.conta);
    const ondeJoga = await montarSumula();
    await confirmarPresenca(ondeJoga.fut, chefe.jogador);

    expect((await ler(token)).corpo.fut?.id).toBe(ondeJoga.fut.id);

    // Saiu da lista: volta a ser só alcance, e o jogo aberto decide.
    await db
      .update(attendances)
      .set({ status: "out" })
      .where(
        and(eq(attendances.matchDayId, ondeJoga.fut.id), eq(attendances.playerId, chefe.jogador.id)),
      );
    expect((await ler(token)).corpo.fut?.id).toBe(alheio.fut.id);
  });
});

describe("a forma do JSON", () => {
  it("antes do jogo: fut, times, escalação vazia e jogo nulo", async () => {
    const s = await montarSumula();

    const { corpo } = await ler(await criarTokenDeApi(s.adminConta));

    expect(corpo).toMatchObject({
      ok: true,
      fut: { id: s.fut.id, local: s.fut.location, data: s.fut.date },
      jogo: null,
      escalacao: { A: [], B: [] },
      rotulos: { A: {}, B: {} },
      ultimoGol: { A: null, B: null },
    });
    expect(corpo.times.map((t: { nome: string }) => t.nome)).toEqual(["Preto", "Branco"]);
    expect(corpo.mensagem).toContain("Nenhum jogo");
  });

  it("com jogo aberto: placar, escalação por lado, rótulos únicos e último gol", async () => {
    const s = await montarSumula();
    // Dois "Zé" do mesmo lado: o dicionário não pode engolir um deles.
    await db
      .update(players)
      .set({ nickname: "Zé" })
      .where(
        inArray(
          players.id,
          s.ladoA.map((p) => p.id),
        ),
      );
    const jogo = await abrirJogo(s);
    await lancarGol(s.fut.id, jogo.id, formDeGol("A", s.ladoA[0].id));
    await lancarGol(s.fut.id, jogo.id, formDeGol("A", s.ladoA[1].id));
    await lancarGol(s.fut.id, jogo.id, formDeGol("B"));
    const gols = await golsDoJogo(jogo.id);
    await desfazerLancamento(s.fut.id, gols[1].id);

    const { corpo } = await ler(await criarTokenDeApi(s.adminConta));

    expect(corpo.jogo).toMatchObject({
      id: jogo.id,
      placar: { A: 1, B: 1 },
      times: { A: "Preto", B: "Branco" },
      emAndamentoHa: "agora",
    });
    const ids = (lado: { playerId: number }[]) => lado.map((j) => j.playerId).sort();
    expect(ids(corpo.escalacao.A)).toEqual(s.ladoA.map((p) => p.id).sort());
    expect(ids(corpo.escalacao.B)).toEqual(s.ladoB.map((p) => p.id).sort());
    expect(Object.keys(corpo.rotulos.A).sort()).toEqual(["Zé", "Zé (2)"]);
    expect((Object.values(corpo.rotulos.A) as number[]).sort()).toEqual(
      s.ladoA.map((p) => p.id).sort(),
    );
    // Desfeito o segundo do A, o primeiro volta a ser o último do lado.
    expect(corpo.ultimoGol).toEqual({ A: gols[0].id, B: gols[2].id });
    expect(corpo.mensagem).toBe("Em andamento: Preto 1 × 1 Branco");
  });
});
