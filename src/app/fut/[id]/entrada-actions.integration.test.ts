// Os três caminhos de entrada num fut, pelas fronteiras que eles guardam.
//
// O foco aqui é autorização, não fluxo feliz: cada action é endpoint HTTP
// público e recebe ids do cliente, então o que estes casos travam é quem NÃO
// pode — convidar sem vínculo, aceitar convite alheio, aprovar pedido de fut de
// outro, entrar num fut que já sorteou.

import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  attendances,
  matchDayInviteLinks,
  matchDayInvitations,
  matchDayJoinRequests,
  matchDays,
  notifications,
  type MatchDay,
  type Player,
} from "@/db/schema";
import {
  cancelarPedidoDeFut,
  convidarParaOFut,
  decidirPedidoDeFut,
  gerarLinkDoFutAction,
  pedirParaEntrarNoFut,
  resgatarLinkDoFut,
  responderConviteDeFut,
} from "./entrada-actions";
import { setMyAttendance } from "./actions";
import { definirPresenca } from "./gerenciar/actions";
import {
  confirmarPresenca,
  criarFut,
  criarJogador,
  criarJogadorComConta,
  logarComo,
} from "@/test/fixtures";
import { criarGrupo, entrarNoGrupo } from "@/test/fixtures-grupo";
import { esperaRedirect } from "@/test/navigation-fake";

async function statusDe(fut: MatchDay, jogador: Player) {
  const [linha] = await db
    .select({ status: attendances.status })
    .from(attendances)
    .where(and(eq(attendances.matchDayId, fut.id), eq(attendances.playerId, jogador.id)));
  return linha?.status ?? null;
}

/** Dois jogadores que já dividiram um fut — o vínculo do fut avulso. */
async function duplaComHistorico() {
  const a = await criarJogadorComConta();
  const b = await criarJogadorComConta();
  const anterior = await criarFut({ date: "2026-01-10" });
  await confirmarPresenca(anterior, a.jogador);
  await confirmarPresenca(anterior, b.jogador);
  return { a, b };
}

describe("convidarParaOFut", () => {
  it("quem já jogou junto chama, e o convidado recebe aviso — sem entrar na lista", async () => {
    const { a, b } = await duplaComHistorico();
    const fut = await criarFut({ createdByPlayerId: a.jogador.id });
    await logarComo(a.conta);

    const url = await esperaRedirect(convidarParaOFut(fut.id, b.jogador.id));

    expect(url).toBe(`/fut/${fut.id}?ok=convite-enviado`);
    // O ponto do desenho: convite NÃO é presença. Quem decide é quem recebeu.
    expect(await statusDe(fut, b.jogador)).toBeNull();
    const [aviso] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.playerId, b.jogador.id));
    expect(aviso.type).toBe("fut_convite");
  });

  // A regressão que este módulo inteiro existe para fechar.
  it("estranho não chama estranho em fut avulso", async () => {
    const { conta } = await criarJogadorComConta();
    const alvo = await criarJogadorComConta();
    const fut = await criarFut();
    await logarComo(conta);

    const url = await esperaRedirect(convidarParaOFut(fut.id, alvo.jogador.id));

    expect(url).toBe(`/fut/${fut.id}?erro=sem-vinculo-para-convidar`);
    expect(await db.select().from(matchDayInvitations)).toHaveLength(0);
    expect(
      await db.select().from(notifications).where(eq(notifications.playerId, alvo.jogador.id)),
    ).toHaveLength(0);
  });

  // Organizar não é credencial: criar fut é auto-servível, então um atalho por
  // "sou o dono deste fut" devolveria a plataforma inteira ao alcance de
  // qualquer conta — um convite, com notificação e push, por jogador. Quem
  // organiza e não conhece a pessoa manda o LINK, que ela decide abrir.
  it("organizar não basta: sem histórico, quem organiza não chama", async () => {
    const { conta, jogador } = await criarJogadorComConta();
    const alvo = await criarJogadorComConta();
    const fut = await criarFut({ createdByPlayerId: jogador.id });
    await logarComo(conta);

    expect(await esperaRedirect(convidarParaOFut(fut.id, alvo.jogador.id))).toBe(
      `/fut/${fut.id}?erro=sem-vinculo-para-convidar`,
    );
    expect(await db.select().from(matchDayInvitations)).toHaveLength(0);
  });

  it("não chama quem não tem conta — ela não teria como responder", async () => {
    const { conta, jogador } = await criarJogadorComConta();
    const semConta = await criarJogador();
    // Com histórico: sem ele o vínculo barraria antes, e o teste mediria outra
    // coisa. O vínculo sai de `attendances`, então vale para quem não tem conta.
    const anterior = await criarFut({ date: "2026-01-10" });
    await confirmarPresenca(anterior, jogador);
    await confirmarPresenca(anterior, semConta);
    const fut = await criarFut({ createdByPlayerId: jogador.id });
    await logarComo(conta);

    expect(await esperaRedirect(convidarParaOFut(fut.id, semConta.id))).toBe(
      `/fut/${fut.id}?erro=convidado-sem-conta`,
    );
  });

  // Com vínculo, de propósito: sem ele o convite morreria no vínculo e o teste
  // passaria sem nunca exercitar a trava do sorteio.
  it("fut já sorteado não aceita convite", async () => {
    const { a, b } = await duplaComHistorico();
    const fut = await criarFut({ createdByPlayerId: a.jogador.id, status: "teams_drawn" });
    await logarComo(a.conta);

    expect(await esperaRedirect(convidarParaOFut(fut.id, b.jogador.id))).toBe(
      `/fut/${fut.id}?erro=sem-vinculo-para-convidar`,
    );
    expect(await db.select().from(matchDayInvitations)).toHaveLength(0);
  });
});

describe("responderConviteDeFut", () => {
  async function comConvite() {
    const { a, b } = await duplaComHistorico();
    const fut = await criarFut({ createdByPlayerId: a.jogador.id });
    await logarComo(a.conta);
    await esperaRedirect(convidarParaOFut(fut.id, b.jogador.id));
    const [convite] = await db.select().from(matchDayInvitations);
    return { a, b, fut, convite };
  }

  it("aceitar entra na lista", async () => {
    const { b, fut, convite } = await comConvite();
    await logarComo(b.conta);

    expect(await esperaRedirect(responderConviteDeFut(fut.id, convite.id, true))).toBe(
      `/fut/${fut.id}?ok=fut-entrou`,
    );
    expect(await statusDe(fut, b.jogador)).toBe("in");
  });

  it("recusar não entra", async () => {
    const { b, fut, convite } = await comConvite();
    await logarComo(b.conta);

    await esperaRedirect(responderConviteDeFut(fut.id, convite.id, false));

    expect(await statusDe(fut, b.jogador)).toBeNull();
    const [depois] = await db.select().from(matchDayInvitations);
    expect(depois.status).toBe("declined");
  });

  // `invitationId` vem do cliente: sem o playerId da sessão no `where`, aceitar
  // convite alheio seria entrar num fut sem nunca ter sido chamado.
  it("ninguém aceita o convite de outra pessoa", async () => {
    const { fut, convite } = await comConvite();
    const bisbilhoteiro = await criarJogadorComConta();
    await logarComo(bisbilhoteiro.conta);

    expect(await esperaRedirect(responderConviteDeFut(fut.id, convite.id, true))).toBe(
      "/futs?erro=convite-invalido",
    );
    expect(await statusDe(fut, bisbilhoteiro.jogador)).toBeNull();
  });

  // Recusar um convite vale o mesmo que tirar o nome da lista: é uma das duas
  // formas de dizer não, e as duas fecham o fut para quem chamou.
  describe("depois de recusar", () => {
    async function recusou() {
      const { a, b, fut, convite } = await comConvite();
      await logarComo(b.conta);
      await esperaRedirect(responderConviteDeFut(fut.id, convite.id, false));
      return { a, b, fut };
    }

    // A porta dos fundos: o índice único de convites é parcial em `pending`,
    // então uma recusa não estorva a próxima linha. Sem a regra, quem organiza
    // manda convite atrás de convite, cada um com notificação e push.
    it("não dá para chamar de novo para o MESMO fut", async () => {
      const { a, b, fut } = await recusou();
      await logarComo(a.conta);

      const url = await esperaRedirect(convidarParaOFut(fut.id, b.jogador.id));

      expect(url).toBe(`/fut/${fut.id}?erro=alvo-recusou`);
      // Nenhum convite pendente novo — só o recusado de antes.
      const convites = await db.select().from(matchDayInvitations);
      expect(convites).toHaveLength(1);
      expect(convites[0].status).toBe("declined");
    });

    // O bloqueio é por par (fut, jogador) e morre com o fut: recusar hoje não
    // tira ninguém do fut da semana que vem.
    it("mas continua podendo ser chamada para OUTRO fut", async () => {
      const { a, b } = await recusou();
      const outro = await criarFut({ createdByPlayerId: a.jogador.id });
      await logarComo(a.conta);

      const url = await esperaRedirect(convidarParaOFut(outro.id, b.jogador.id));

      expect(url).toBe(`/fut/${outro.id}?ok=convite-enviado`);
    });

    // A outra metade do bloqueio: recusar o convite também fecha a marcação
    // direta pela tela de gestão, não só o reconvite.
    it("quem organiza também não marca a presença dela", async () => {
      const { a, b, fut } = await recusou();
      await db.update(matchDays).set({ status: "teams_drawn" }).where(eq(matchDays.id, fut.id));
      await logarComo(a.conta);

      const url = await esperaRedirect(definirPresenca(fut.id, b.jogador.id, "in"));

      expect(url).toBe(`/fut/${fut.id}/gerenciar?erro=recusou`);
      expect(await statusDe(fut, b.jogador)).toBeNull();
    });

    // Pedido pendente de antes da recusa não vira porta de entrada: a última
    // palavra dela é a que vale, e aprovar entraria gravando-a como autora.
    it("pedido pendente de antes não é aprovável depois da recusa", async () => {
      const { a, b, fut } = await recusou();
      await db.insert(matchDayJoinRequests).values({ matchDayId: fut.id, playerId: b.jogador.id });
      const [pedido] = await db.select().from(matchDayJoinRequests);
      await logarComo(a.conta);

      const url = await esperaRedirect(decidirPedidoDeFut(fut.id, pedido.id, true));

      expect(url).toBe(`/fut/${fut.id}/gerenciar?erro=alvo-recusou`);
      expect(await statusDe(fut, b.jogador)).toBeNull();
      // E o pedido continua pendente — não foi decidido coisa nenhuma.
      const [depois] = await db.select().from(matchDayJoinRequests);
      expect(depois.status).toBe("pending");
    });

    // Recusar não é entrar na lista: sem linha em `attendances`, o vínculo do
    // fut avulso ("já dividiu um fut com") continua não existindo. É por isso
    // que a recusa NÃO vira linha ali — ver recusouEsteFut.
    it("não cria linha na lista, e portanto não cria vínculo de círculo", async () => {
      const { b, fut } = await recusou();
      expect(await statusDe(fut, b.jogador)).toBeNull();
    });

    // O desfazer também vale para esta metade da recusa. Limpar só `opted_out_at`
    // deixava um beco sem saída: quem recusou o convite e depois entrou sozinha
    // ficava `in` na lista com `declined` vivo para sempre, e nada no app move
    // `declined` — nem o admin da plataforma destravava.
    describe("e voltar sozinha", () => {
      async function voltou() {
        const { a, b, fut } = await recusou();
        await logarComo(b.conta);
        await setMyAttendance(fut.id, "in");
        expect(await statusDe(fut, b.jogador)).toBe("in");
        return { a, b, fut };
      }

      it("o convite recusado deixa de valer como recusa", async () => {
        const { b, fut } = await voltou();
        const [convite] = await db
          .select()
          .from(matchDayInvitations)
          .where(
            and(
              eq(matchDayInvitations.matchDayId, fut.id),
              eq(matchDayInvitations.playerId, b.jogador.id),
            ),
          );
        expect(convite.status).toBe("accepted");
      });

      // A consequência que doía: com `declined` vivo, `avaliarMarcacao` barrava
      // quem organiza nos DOIS sentidos — inclusive escalar na súmula alguém que
      // está na lista e na quadra.
      it("quem organiza volta a mandar na presença dela", async () => {
        const { a, b, fut } = await voltou();
        await logarComo(a.conta);

        await definirPresenca(fut.id, b.jogador.id, "out");

        expect(await statusDe(fut, b.jogador)).toBe("out");
      });
    });
  });
});

describe("pedirParaEntrarNoFut", () => {
  it("quem vem de fora pede, e quem organiza é avisado", async () => {
    const dono = await criarJogadorComConta();
    const fut = await criarFut({ createdByPlayerId: dono.jogador.id });
    const forasteiro = await criarJogadorComConta();
    await logarComo(forasteiro.conta);

    expect(await esperaRedirect(pedirParaEntrarNoFut(fut.id))).toBe(
      `/fut/${fut.id}?ok=fut-pedido-enviado`,
    );
    // Pedido não é presença.
    expect(await statusDe(fut, forasteiro.jogador)).toBeNull();
    const [aviso] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.playerId, dono.jogador.id));
    expect(aviso.type).toBe("fut_pedido");
  });

  it("fut de grupo não é pedido — membro entra direto, e quem é de fora não vê", async () => {
    const groupId = (await criarGrupo()).id;
    const fut = await criarFut({ groupId });
    const membro = await criarJogadorComConta();
    await entrarNoGrupo(groupId, membro.jogador);
    await logarComo(membro.conta);

    expect(await esperaRedirect(pedirParaEntrarNoFut(fut.id))).toBe(
      `/fut/${fut.id}?erro=fut-entrada-fechada`,
    );
  });

  it("fut já sorteado recusa o pedido", async () => {
    const dono = await criarJogadorComConta();
    const fut = await criarFut({ createdByPlayerId: dono.jogador.id, status: "teams_drawn" });
    const { conta } = await criarJogadorComConta();
    await logarComo(conta);

    expect(await esperaRedirect(pedirParaEntrarNoFut(fut.id))).toBe(
      `/fut/${fut.id}?erro=fut-entrada-fechada`,
    );
  });

  it("cancelar tira só o próprio pedido", async () => {
    // Com organizador: fut órfão é de todo mundo (ver estaNoCirculoDoFut) e não
    // chega a produzir pedido nenhum.
    const dono = await criarJogadorComConta();
    const fut = await criarFut({ createdByPlayerId: dono.jogador.id });
    const um = await criarJogadorComConta();
    const outro = await criarJogadorComConta();
    await logarComo(um.conta);
    await esperaRedirect(pedirParaEntrarNoFut(fut.id));
    await logarComo(outro.conta);
    await esperaRedirect(pedirParaEntrarNoFut(fut.id));

    await esperaRedirect(cancelarPedidoDeFut(fut.id));

    const restantes = await db.select().from(matchDayJoinRequests);
    expect(restantes).toHaveLength(1);
    expect(restantes[0].playerId).toBe(um.jogador.id);
  });
});

describe("decidirPedidoDeFut", () => {
  async function comPedido() {
    const dono = await criarJogadorComConta();
    const fut = await criarFut({ createdByPlayerId: dono.jogador.id });
    const forasteiro = await criarJogadorComConta();
    await logarComo(forasteiro.conta);
    await esperaRedirect(pedirParaEntrarNoFut(fut.id));
    const [pedido] = await db.select().from(matchDayJoinRequests);
    return { dono, fut, forasteiro, pedido };
  }

  it("aprovar põe na lista e avisa", async () => {
    const { dono, fut, forasteiro, pedido } = await comPedido();
    await logarComo(dono.conta);

    expect(await esperaRedirect(decidirPedidoDeFut(fut.id, pedido.id, true))).toBe(
      `/fut/${fut.id}/gerenciar?ok=pedido-aprovado`,
    );
    expect(await statusDe(fut, forasteiro.jogador)).toBe("in");
  });

  it("recusar não põe na lista", async () => {
    const { dono, fut, forasteiro, pedido } = await comPedido();
    await logarComo(dono.conta);

    await esperaRedirect(decidirPedidoDeFut(fut.id, pedido.id, false));

    expect(await statusDe(fut, forasteiro.jogador)).toBeNull();
  });

  // O guard é `requireFutAdmin`, que responde 404 para quem não gerencia — e
  // 404, não 403, porque quem não administra não precisa saber que o id existe.
  it("quem não gerencia o fut não decide nada", async () => {
    const { fut, pedido } = await comPedido();
    const intruso = await criarJogadorComConta();
    await logarComo(intruso.conta);

    await expect(decidirPedidoDeFut(fut.id, pedido.id, true)).rejects.toThrow();
    const [depois] = await db.select().from(matchDayJoinRequests);
    expect(depois.status).toBe("pending");
  });

  // `requestId` vem do cliente: sem o escopo por fut, quem organiza um fut
  // aprovaria o pedido pendente de outro.
  it("não decide pedido de outro fut", async () => {
    const { pedido } = await comPedido();
    const outroDono = await criarJogadorComConta();
    const outroFut = await criarFut({ createdByPlayerId: outroDono.jogador.id });
    await logarComo(outroDono.conta);

    await esperaRedirect(decidirPedidoDeFut(outroFut.id, pedido.id, true));

    const [depois] = await db.select().from(matchDayJoinRequests);
    expect(depois.status).toBe("pending");
  });
});

describe("link do fut", () => {
  async function comLink(extra: Partial<Record<string, string>> = {}) {
    const dono = await criarJogadorComConta();
    const fut = await criarFut({ createdByPlayerId: dono.jogador.id });
    await logarComo(dono.conta);
    const form = new FormData();
    form.set("maxUses", extra.maxUses ?? "");
    await esperaRedirect(gerarLinkDoFutAction(fut.id, form));
    const [link] = await db.select().from(matchDayInviteLinks);
    return { dono, fut, link };
  }

  it("quem abre o link entra na lista", async () => {
    const { fut, link } = await comLink();
    const convidado = await criarJogadorComConta();
    await logarComo(convidado.conta);

    expect(await esperaRedirect(resgatarLinkDoFut(link.token))).toBe(`/fut/${fut.id}?ok=fut-entrou`);
    expect(await statusDe(fut, convidado.jogador)).toBe("in");
  });

  // O resgate revalida o estado do fut, e não só a validade do token: o link
  // vive sete dias e o sorteio acontece no meio deles.
  it("link de fut já sorteado não entra ninguém", async () => {
    const { fut, link } = await comLink();
    await db.update(matchDays).set({ status: "teams_drawn" }).where(eq(matchDays.id, fut.id));
    const convidado = await criarJogadorComConta();
    await logarComo(convidado.conta);

    expect(await esperaRedirect(resgatarLinkDoFut(link.token))).toBe(
      `/fut/${fut.id}?erro=fut-entrada-fechada`,
    );
    expect(await statusDe(fut, convidado.jogador)).toBeNull();
  });

  it("reabrir o link não gasta uso duas vezes", async () => {
    const { fut, link } = await comLink({ maxUses: "1" });
    const convidado = await criarJogadorComConta();
    await logarComo(convidado.conta);

    await esperaRedirect(resgatarLinkDoFut(link.token));
    await esperaRedirect(resgatarLinkDoFut(link.token));

    const [depois] = await db.select().from(matchDayInviteLinks);
    expect(depois.usesCount).toBe(1);
    expect(await statusDe(fut, convidado.jogador)).toBe("in");
  });

  it("token que não existe não entra em fut nenhum", async () => {
    const { conta } = await criarJogadorComConta();
    await logarComo(conta);

    expect(await esperaRedirect(resgatarLinkDoFut("nao-existe"))).toBe(
      "/futs?erro=link-invalido",
    );
  });

  it("gerar link novo revoga o anterior", async () => {
    const { dono, fut, link } = await comLink();
    await logarComo(dono.conta);
    const form = new FormData();
    form.set("maxUses", "");
    await esperaRedirect(gerarLinkDoFutAction(fut.id, form));

    const [velho] = await db
      .select()
      .from(matchDayInviteLinks)
      .where(eq(matchDayInviteLinks.id, link.id));
    expect(velho.revokedAt).not.toBeNull();

    const convidado = await criarJogadorComConta();
    await logarComo(convidado.conta);
    expect(await esperaRedirect(resgatarLinkDoFut(link.token))).toBe("/futs?erro=link-invalido");
  });
});
