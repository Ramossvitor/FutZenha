// Nome e cor dos times depois do sorteio: a action do /gerenciar (quem gerencia
// o fut) e a da súmula (quem opera, delegado inclusive) sobre a MESMA regra
// (src/lib/times-do-fut.ts) — renomear, recolorir, "sem colete", nome repetido,
// time de outro fut, fut encerrado e quem não pode.

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { matchDays, teams } from "@/db/schema";
import { NOME_DE_TIME_MAX } from "@/lib/regras";
import { ESCOLHA_OUTRA_COR, ESCOLHA_SEM_COLETE } from "@/lib/team-colors";
import { criarFut, criarJogadorComConta, logarComo } from "@/test/fixtures";
import { criarDelegado, montarSumula } from "@/test/fixtures-sumula";
import { esperaNotFound, esperaRedirect } from "@/test/navigation-fake";
import { editarTimeNaSumula } from "../sumula/actions";
import { editarTimeAction } from "./actions";

/** O form como o browser manda: o seletor livre vai SEMPRE, escolhido ou não. */
function formDeColete(nome: string, cor: string, corLivre = "#888888"): FormData {
  const form = new FormData();
  form.set("nome", nome);
  form.set("cor", cor);
  form.set("corLivre", corLivre);
  return form;
}

async function timeDoBanco(teamId: number) {
  const [time] = await db.select().from(teams).where(eq(teams.id, teamId));
  return time;
}

describe("editarTimeAction", () => {
  it("renomeia e recolore pela amostra, e avisa no ?ok=", async () => {
    const s = await montarSumula();

    const url = await esperaRedirect(
      editarTimeAction(s.fut.id, s.timeAId, formDeColete("Com Colete", "#f2740f")),
    );

    expect(url).toBe(`/fut/${s.fut.id}/gerenciar?ok=time-atualizado`);
    expect(await timeDoBanco(s.timeAId)).toMatchObject({ name: "Com Colete", cor: "#f2740f" });
    // O outro time fica como estava.
    expect(await timeDoBanco(s.timeBId)).toMatchObject({ name: "Branco", cor: "#e8edea" });
  });

  it("a cor livre só vale com 'outra' marcado, e vai ao banco em minúsculas", async () => {
    const s = await montarSumula();

    await esperaRedirect(
      editarTimeAction(s.fut.id, s.timeAId, formDeColete("Azulão", ESCOLHA_OUTRA_COR, "#1E90FF")),
    );
    expect((await timeDoBanco(s.timeAId)).cor).toBe("#1e90ff");

    // Amostra marcada + seletor livre mexido: a amostra manda.
    await esperaRedirect(
      editarTimeAction(s.fut.id, s.timeAId, formDeColete("Azulão", "#2f6fe0", "#1e90ff")),
    );
    expect((await timeDoBanco(s.timeAId)).cor).toBe("#2f6fe0");
  });

  it("'sem colete' grava cor nula", async () => {
    const s = await montarSumula();

    await esperaRedirect(
      editarTimeAction(s.fut.id, s.timeBId, formDeColete("Sem Colete", ESCOLHA_SEM_COLETE)),
    );

    expect(await timeDoBanco(s.timeBId)).toMatchObject({ name: "Sem Colete", cor: null });
  });

  it("recusa o nome do outro time — sem olhar caixa e espaço — mas aceita o próprio", async () => {
    const s = await montarSumula();

    const url = await esperaRedirect(
      editarTimeAction(s.fut.id, s.timeAId, formDeColete(" branco ", "#15181a")),
    );
    expect(url).toBe(`/fut/${s.fut.id}/gerenciar?erro=nome-de-time-repetido`);
    expect((await timeDoBanco(s.timeAId)).name).toBe("Preto");

    // Trocar só a cor (o nome fica, noutra caixa) não é repetição.
    await esperaRedirect(editarTimeAction(s.fut.id, s.timeAId, formDeColete("preto", "#16a868")));
    expect(await timeDoBanco(s.timeAId)).toMatchObject({ name: "preto", cor: "#16a868" });
  });

  it("recusa nome e cor fora do formato, com slug próprio, sem gravar", async () => {
    const s = await montarSumula();

    for (const form of [
      formDeColete("", "#15181a"),
      formDeColete("x".repeat(NOME_DE_TIME_MAX + 1), "#15181a"),
      formDeColete("Com\nColete", "#15181a"),
      formDeColete("Roxo", "roxo"),
      formDeColete("Roxo", ESCOLHA_OUTRA_COR, "purple"),
    ]) {
      expect(await esperaRedirect(editarTimeAction(s.fut.id, s.timeAId, form))).toBe(
        `/fut/${s.fut.id}/gerenciar?erro=nome-de-time-invalido`,
      );
    }
    expect(await timeDoBanco(s.timeAId)).toMatchObject({ name: "Preto", cor: "#15181a" });
  });

  it("recusa time de outro fut e id que não é inteiro", async () => {
    const s = await montarSumula();
    const outro = await criarFut({ status: "teams_drawn" });
    const [alheio] = await db
      .insert(teams)
      .values({ matchDayId: outro.id, name: "Verde", sortOrder: 0 })
      .returning();

    expect(
      await esperaRedirect(editarTimeAction(s.fut.id, alheio.id, formDeColete("Roubado", "#15181a"))),
    ).toBe(`/fut/${s.fut.id}/gerenciar?erro=dados-invalidos`);
    expect((await timeDoBanco(alheio.id)).name).toBe("Verde");

    expect(await esperaRedirect(editarTimeAction(s.fut.id, 1.5, formDeColete("X", "#15181a")))).toBe(
      `/fut/${s.fut.id}/gerenciar?erro=dados-invalidos`,
    );
  });

  it("recusa fut encerrado — a escalação é imutável, nome inclusive", async () => {
    const s = await montarSumula();
    await db.update(matchDays).set({ status: "finished" }).where(eq(matchDays.id, s.fut.id));

    const url = await esperaRedirect(
      editarTimeAction(s.fut.id, s.timeAId, formDeColete("Com Colete", "#f2740f")),
    );

    expect(url).toBe(`/fut/${s.fut.id}/gerenciar?erro=escalacao-travada`);
    expect((await timeDoBanco(s.timeAId)).name).toBe("Preto");
  });

  it("quem não gerencia o fut cai no 404", async () => {
    const s = await montarSumula();
    const { conta } = await criarJogadorComConta();
    await logarComo(conta);

    await esperaNotFound(
      editarTimeAction(s.fut.id, s.timeAId, formDeColete("Com Colete", "#f2740f")),
    );
    expect((await timeDoBanco(s.timeAId)).name).toBe("Preto");
  });
});

describe("editarTimeNaSumula", () => {
  it("quem recebeu a súmula renomeia pelo painel, com o ?ok= da tela dele", async () => {
    const s = await montarSumula();
    const { conta } = await criarDelegado(s.fut);
    await logarComo(conta);

    const url = await esperaRedirect(
      editarTimeNaSumula(s.fut.id, s.timeAId, formDeColete("Com Colete", "#f2740f")),
    );

    expect(url).toBe(`/fut/${s.fut.id}/sumula?ok=time-atualizado`);
    expect(await timeDoBanco(s.timeAId)).toMatchObject({ name: "Com Colete", cor: "#f2740f" });
  });

  it("as recusas voltam para a súmula, não para o /gerenciar", async () => {
    const s = await montarSumula();

    expect(
      await esperaRedirect(editarTimeNaSumula(s.fut.id, s.timeAId, formDeColete("Branco", "#15181a"))),
    ).toBe(`/fut/${s.fut.id}/sumula?erro=nome-de-time-repetido`);
    expect(
      await esperaRedirect(editarTimeNaSumula(s.fut.id, s.timeAId, formDeColete("", "#15181a"))),
    ).toBe(`/fut/${s.fut.id}/sumula?erro=nome-de-time-invalido`);
    expect(
      await esperaRedirect(editarTimeNaSumula(s.fut.id, Number.NaN, formDeColete("X", "#15181a"))),
    ).toBe(`/fut/${s.fut.id}/sumula?erro=dados-invalidos`);
  });

  // Ao contrário do /gerenciar, aqui não há guarda pré-transação: o guard do
  // operador não olha status, então a trava de fut encerrado do atualizarTime
  // (sob o lock) é a ÚNICA — e este é o único teste que passa por ela.
  it("recusa fut encerrado — a trava do atualizarTime é a única no caminho", async () => {
    const s = await montarSumula();
    await db.update(matchDays).set({ status: "finished" }).where(eq(matchDays.id, s.fut.id));

    const url = await esperaRedirect(
      editarTimeNaSumula(s.fut.id, s.timeAId, formDeColete("Com Colete", "#f2740f")),
    );

    expect(url).toBe(`/fut/${s.fut.id}/sumula?erro=escalacao-travada`);
    expect((await timeDoBanco(s.timeAId)).name).toBe("Preto");
  });

  it("quem não opera a súmula cai no 404", async () => {
    const s = await montarSumula();
    const { conta } = await criarJogadorComConta();
    await logarComo(conta);

    await esperaNotFound(
      editarTimeNaSumula(s.fut.id, s.timeAId, formDeColete("Com Colete", "#f2740f")),
    );
  });
});
