import { describe, expect, it } from "vitest";
import { modeloDoAviso } from "./email-avisos";

// A decisão de "este aviso vira e-mail?", sem banco e sem rede. É a peça deste
// fluxo que mais merece teste: um tipo entrando na allowlist por descuido manda
// e-mail para o elenco inteiro, e um saindo dela cala um aviso sem que nada
// falhe.

const base = { para: "ze@example.com", avisosPorEmail: true } as const;

describe("modeloDoAviso", () => {
  it("os avisáveis escolhidos viram e-mail", () => {
    for (const type of [
      "fut_convite",
      "pelada_lembrete_vespera",
      "deletion_vote_open",
      "group_join_request",
    ] as const) {
      expect(modeloDoAviso({ ...base, type }), type).not.toBeNull();
    }
  });

  it("os de dinheiro viram e-mail", () => {
    for (const type of ["recarga_confirmada", "recarga_estornada", "loja_compra"] as const) {
      expect(modeloDoAviso({ ...base, type }), type).not.toBeNull();
    }
  });

  // O outro lado da allowlist, e o que a protege de crescer sozinha: estes
  // existem na caixa de entrada e NÃO foram escolhidos para virar e-mail.
  it("tipo fora da allowlist não vira e-mail", () => {
    for (const type of [
      "fut_encerrado",
      "fut_encerrado_no_grupo",
      "zenha_creditada",
      "mvp_do_fut",
      "skill_changed",
      "pelada_criada",
      "pelada_times_sorteados",
      "fut_pedido",
      "group_invitation",
      "group_role_changed",
      "multiplicador_devolvido",
    ] as const) {
      expect(modeloDoAviso({ ...base, type }), type).toBeNull();
    }
  });

  it("sem endereço não vira e-mail, mesmo em tipo da allowlist", () => {
    expect(modeloDoAviso({ ...base, type: "fut_convite", para: null })).toBeNull();
  });

  // O toggle de /perfil.
  it("quem desligou os avisos não recebe os avisáveis", () => {
    expect(modeloDoAviso({ ...base, type: "fut_convite", avisosPorEmail: false })).toBeNull();
    expect(
      modeloDoAviso({ ...base, type: "pelada_lembrete_vespera", avisosPorEmail: false }),
    ).toBeNull();
  });

  // A razão de `transacional` existir: comprovante de valor pago não é aviso que
  // se desliga, e o estorno é trabalho esperando um humano.
  it("os transacionais ignoram o toggle", () => {
    for (const type of ["recarga_confirmada", "recarga_estornada", "loja_compra"] as const) {
      expect(modeloDoAviso({ ...base, type, avisosPorEmail: false }), type).not.toBeNull();
    }
  });

  it("nem o transacional sai sem endereço", () => {
    expect(modeloDoAviso({ ...base, type: "recarga_confirmada", para: null })).toBeNull();
  });

  it("todo modelo tem rótulo de botão e rodapé não vazios", () => {
    for (const type of [
      "fut_convite",
      "pelada_lembrete_vespera",
      "deletion_vote_open",
      "group_join_request",
      "recarga_confirmada",
      "recarga_estornada",
      "loja_compra",
    ] as const) {
      const modelo = modeloDoAviso({ ...base, type })!;
      expect(modelo.rotulo.length, type).toBeGreaterThan(0);
      expect(modelo.rodape.length, type).toBeGreaterThan(0);
    }
  });

  // O rodapé é onde quem não esperava o e-mail vai procurar a origem. Um texto
  // só para todos mentiria para metade deles — o admin que recebe um pedido de
  // entrada não foi convidado para nada.
  it("cada tipo explica a própria origem", () => {
    const convite = modeloDoAviso({ ...base, type: "fut_convite" })!;
    const pedido = modeloDoAviso({ ...base, type: "group_join_request" })!;
    expect(convite.rodape).not.toBe(pedido.rodape);
    expect(pedido.rodape).toContain("administra este grupo");
  });

  // Só quem respeita o toggle pode anunciar descadastro — ver o listUnsubscribe
  // em despacharEmailsDeAvisos.
  it("só o não-transacional é desligável", () => {
    expect(modeloDoAviso({ ...base, type: "fut_convite" })!.transacional).toBeUndefined();
    expect(modeloDoAviso({ ...base, type: "recarga_confirmada" })!.transacional).toBe(true);
  });
});
