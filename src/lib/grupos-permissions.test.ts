import { describe, expect, it } from "vitest";
import {
  podeConvidarParaGrupo,
  podeCriarFutNoGrupo,
  podeEntrarNoGrupo,
  podeGerenciarGrupo,
  podePromover,
  podeRemoverMembro,
  podeSairDoGrupo,
  podeVerGrupo,
} from "./grupos-permissions";

const admin = { playerId: 10, isPlatformAdmin: false };
const organizador = { playerId: 20, isPlatformAdmin: false };
const membro = { playerId: 30, isPlatformAdmin: false };
const deFora = { playerId: 40, isPlatformAdmin: false };
const plataforma = { playerId: 99, isPlatformAdmin: true };

const privado = { visibility: "private" } as const;
const publico = { visibility: "public" } as const;

describe("podeGerenciarGrupo", () => {
  it("só o admin do grupo gerencia", () => {
    expect(podeGerenciarGrupo(admin, "admin")).toBe(true);
    expect(podeGerenciarGrupo(organizador, "organizer")).toBe(false);
    expect(podeGerenciarGrupo(membro, "member")).toBe(false);
    expect(podeGerenciarGrupo(deFora, null)).toBe(false);
  });

  it("admin da plataforma é fallback, como em fut", () => {
    expect(podeGerenciarGrupo(plataforma, null)).toBe(true);
  });
});

describe("podeCriarFutNoGrupo", () => {
  it("admin e organizador criam fut do grupo", () => {
    expect(podeCriarFutNoGrupo(admin, "admin")).toBe(true);
    expect(podeCriarFutNoGrupo(organizador, "organizer")).toBe(true);
  });

  it("membro não cria fut do grupo", () => {
    expect(podeCriarFutNoGrupo(membro, "member")).toBe(false);
  });

  // O ataque, e a razão de esta função existir: qualquer jogador logado já cria
  // fut avulso, e o `groupId` chega pelo <select> do formulário. Sem o
  // `false` para quem não é membro, bastava trocar o valor no POST para criar
  // fut dentro de um grupo alheio e injetar gols, presenças e V/E/D no
  // ranking de gente que nunca ouviu falar de você.
  it("quem não é membro NÃO cria fut no grupo", () => {
    expect(podeCriarFutNoGrupo(deFora, null)).toBe(false);
  });
});

describe("podeConvidarParaGrupo", () => {
  it("admin e organizador convidam; membro e quem está de fora, não", () => {
    expect(podeConvidarParaGrupo(admin, "admin")).toBe(true);
    expect(podeConvidarParaGrupo(organizador, "organizer")).toBe(true);
    expect(podeConvidarParaGrupo(membro, "member")).toBe(false);
    expect(podeConvidarParaGrupo(deFora, null)).toBe(false);
  });
});

describe("podePromover", () => {
  const alvoMembro = { papelAtual: "member" as const, ehOAtor: false };

  it("o admin promove um membro", () => {
    expect(podePromover(admin, "admin", alvoMembro)).toBe(true);
  });

  // O ataque: organizador que promove organizador é uma fábrica de
  // organizadores, e o admin perde o controle de quem cria fut no grupo dele.
  it("organizador não promove ninguém", () => {
    expect(podePromover(organizador, "organizer", alvoMembro)).toBe(false);
  });

  // O ataque: rebaixar o admin por aqui e assumir o grupo sem passar por
  // transferirAdministracao, que é a única rota com a ordem correta
  // (rebaixa antes de promover) para não furar o índice único parcial.
  it("ninguém mexe no papel do admin por esta porta", () => {
    expect(podePromover(admin, "admin", { papelAtual: "admin", ehOAtor: false })).toBe(false);
    expect(podePromover(plataforma, null, { papelAtual: "admin", ehOAtor: false })).toBe(false);
  });

  // Espelha setPlatformAdmin, que também recusa auto-rebaixamento: o grupo
  // ficaria sem quem administra.
  it("o admin não se rebaixa sozinho", () => {
    expect(podePromover(admin, "admin", { papelAtual: "admin", ehOAtor: true })).toBe(false);
  });

  it("não promove quem não é membro", () => {
    expect(podePromover(admin, "admin", { papelAtual: null, ehOAtor: false })).toBe(false);
  });
});

describe("podeRemoverMembro", () => {
  it("o admin remove membro e organizador", () => {
    expect(podeRemoverMembro(admin, "admin", { papelAtual: "member", ehOAtor: false })).toBe(true);
    expect(podeRemoverMembro(admin, "admin", { papelAtual: "organizer", ehOAtor: false })).toBe(true);
  });

  it("não remove o admin nem a si mesmo", () => {
    expect(podeRemoverMembro(admin, "admin", { papelAtual: "admin", ehOAtor: false })).toBe(false);
    expect(podeRemoverMembro(admin, "admin", { papelAtual: "admin", ehOAtor: true })).toBe(false);
  });

  it("organizador não remove ninguém", () => {
    expect(podeRemoverMembro(organizador, "organizer", { papelAtual: "member", ehOAtor: false }))
      .toBe(false);
  });
});

describe("podeSairDoGrupo", () => {
  it("membro e organizador saem quando querem", () => {
    expect(podeSairDoGrupo("member")).toBe(true);
    expect(podeSairDoGrupo("organizer")).toBe(true);
  });

  // O ataque: grupo órfão, com futs marcados que ninguém encerra e fila de
  // pedidos que ninguém aprova. O admin transfere e depois sai.
  it("o admin não sai sem transferir", () => {
    expect(podeSairDoGrupo("admin")).toBe(false);
  });

  it("quem não é membro não tem de onde sair", () => {
    expect(podeSairDoGrupo(null)).toBe(false);
  });
});

describe("podeVerGrupo", () => {
  it("grupo público é visível para qualquer um", () => {
    expect(podeVerGrupo(deFora, publico, null)).toBe(true);
  });

  it("membro enxerga o próprio grupo privado", () => {
    expect(podeVerGrupo(membro, privado, "member")).toBe(true);
  });

  // O ataque: varrer /grupo/1, /grupo/2, ... e ler a lista de membros de todo
  // grupo privado da plataforma. Por isso o guard responde 404, e não 403.
  it("grupo privado é invisível para quem está de fora", () => {
    expect(podeVerGrupo(deFora, privado, null)).toBe(false);
  });

  it("admin da plataforma enxerga tudo", () => {
    expect(podeVerGrupo(plataforma, privado, null)).toBe(true);
  });
});

describe("podeEntrarNoGrupo", () => {
  const publicoAberto = { visibility: "public", joinPolicy: "open" } as const;
  const publicoSobPedido = { visibility: "public", joinPolicy: "request" } as const;
  const privadoAberto = { visibility: "private", joinPolicy: "open" } as const;
  const privadoSobPedido = { visibility: "private", joinPolicy: "request" } as const;

  it("público + aberto entra direto", () => {
    expect(podeEntrarNoGrupo(publicoAberto, null)).toBe("entra-direto");
  });

  it("público + sob pedido abre solicitação", () => {
    expect(podeEntrarNoGrupo(publicoSobPedido, null)).toBe("pede-entrada");
  });

  it("privado só entra por convite", () => {
    expect(podeEntrarNoGrupo(privadoSobPedido, null)).toBe("so-convite");
  });

  // O ataque, e a razão de a visibilidade ser testada antes da política: um
  // grupo público com entrada livre que vira privado continua com
  // join_policy = 'open' gravado. Olhar a política primeiro deixaria qualquer um
  // entrar direto num grupo que o admin acabou de fechar.
  it("privado com política 'open' de herança continua fechado", () => {
    expect(podeEntrarNoGrupo(privadoAberto, null)).toBe("so-convite");
  });

  it("quem já é membro não entra de novo, em nenhuma das quatro combinações", () => {
    expect(podeEntrarNoGrupo(publicoAberto, "member")).toBe("ja-membro");
    expect(podeEntrarNoGrupo(publicoSobPedido, "member")).toBe("ja-membro");
    expect(podeEntrarNoGrupo(privadoAberto, "organizer")).toBe("ja-membro");
    expect(podeEntrarNoGrupo(privadoSobPedido, "admin")).toBe("ja-membro");
  });
});
