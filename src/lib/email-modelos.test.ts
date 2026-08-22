import { describe, expect, it } from "vitest";
import {
  emailDeAvisoDeGrupo,
  emailDeConvitePlataforma,
  emailDeEventoDeAgenda,
  emailDeResetDeAcesso,
  emailDeResumoDoFut,
  escaparHtml,
  type TipoDeEventoDeAgenda,
} from "./email-modelos";
import { montarResumo } from "./resumo";

describe("escaparHtml", () => {
  it("escapa os cinco caracteres com significado em HTML", () => {
    expect(escaparHtml(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  });

  it("texto comum passa intacto", () => {
    expect(escaparHtml("Zé da Silva")).toBe("Zé da Silva");
  });
});

describe("emailDeConvitePlataforma", () => {
  const dados = {
    nome: "Zé <script>alert(1)</script>",
    token: "tok-abc123",
    emailDeDestino: "ze@gmail.com",
    expiraEm: new Date(2026, 7, 15),
  };

  it("html e texto levam o link do convite", () => {
    const email = emailDeConvitePlataforma(dados);
    // Sem NEXT_PUBLIC_SITE_URL no ambiente de teste, siteUrl() cai no localhost.
    expect(email.html).toContain("/convite/tok-abc123");
    expect(email.texto).toContain("/convite/tok-abc123");
  });

  // O nome vem de formulário de admin — texto livre. Sem escape, viraria markup
  // dentro do email de outra pessoa.
  it("escapa o nome no html e não deixa markup passar", () => {
    const email = emailDeConvitePlataforma(dados);
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });

  // O contrário do teste acima, e igualmente deliberado: a versão `texto` não é
  // HTML, então escapar ali entregaria "Zé &lt;script&gt;" na caixa de entrada.
  // É a "correção" de consistência mais provável de alguém tentar um dia.
  it("não escapa nada na versão texto", () => {
    const email = emailDeConvitePlataforma(dados);
    expect(email.texto).toContain("Zé <script>alert(1)</script>");
    expect(email.texto).not.toContain("&lt;");
    expect(email.texto).not.toContain("&amp;");
  });

  it("diz qual conta Google resgata e quando expira", () => {
    const email = emailDeConvitePlataforma(dados);
    expect(email.html).toContain("ze@gmail.com");
    expect(email.texto).toContain("ze@gmail.com");
    expect(email.html).toContain("15/08/2026");
  });

  it("assunto fixo de convite", () => {
    expect(emailDeConvitePlataforma(dados).assunto).toBe("Seu convite para o FutZenha");
  });
});

describe("emailDeResetDeAcesso", () => {
  const dados = {
    nome: "Zé <script>alert(1)</script>",
    token: "tok-reset9",
    emailDeDestino: "ze@gmail.com",
    expiraEm: new Date(2026, 7, 15),
  };

  it("leva o mesmo link de /convite, com o assunto de reset", () => {
    const email = emailDeResetDeAcesso(dados);
    expect(email.html).toContain("/convite/tok-reset9");
    expect(email.texto).toContain("/convite/tok-reset9");
    expect(email.assunto).toBe("Redefinir seu acesso ao FutZenha");
  });

  // A razão de este modelo existir: quem já tem conta não pode receber boas-vindas.
  it("não dá as boas-vindas a quem já é do app", () => {
    const email = emailDeResetDeAcesso(dados);
    expect(email.html).not.toContain("Você foi convidado");
    expect(email.texto).not.toContain("Você foi convidado");
  });

  it("escapa o nome no html mas não no texto", () => {
    const email = emailDeResetDeAcesso(dados);
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.texto).toContain("Zé <script>alert(1)</script>");
    expect(email.texto).not.toContain("&lt;");
  });
});

describe("emailDeAvisoDeGrupo", () => {
  // Os dois campos são texto livre de formulário: o nome do grupo e o nome de
  // quem convidou (session.player.name). Markup nos dois de propósito — com um
  // só, apagar o escape do outro passaria batido.
  const dados = {
    nomeDoGrupo: `Pelada <b>dos Amigos</b>`,
    quemConvidou: `Vitor <img src=x onerror=alert(1)>`,
  };

  it("aponta para a página de grupos, onde o aceite acontece", () => {
    const email = emailDeAvisoDeGrupo(dados);
    expect(email.html).toContain("/grupos");
    expect(email.texto).toContain("/grupos");
  });

  it("escapa o nome do grupo no html", () => {
    const email = emailDeAvisoDeGrupo(dados);
    expect(email.html).not.toContain("<b>dos Amigos</b>");
    expect(email.html).toContain("&lt;b&gt;dos Amigos&lt;/b&gt;");
  });

  it("escapa quem convidou no html", () => {
    const email = emailDeAvisoDeGrupo(dados);
    expect(email.html).not.toContain("<img src=x");
    expect(email.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("não escapa nada na versão texto", () => {
    const email = emailDeAvisoDeGrupo(dados);
    expect(email.texto).toContain(`Vitor <img src=x onerror=alert(1)>`);
    expect(email.texto).toContain(`Pelada <b>dos Amigos</b>`);
    expect(email.texto).not.toContain("&lt;");
  });

  it("assunto carrega o nome do grupo (sem escape: assunto não é HTML)", () => {
    expect(emailDeAvisoDeGrupo(dados).assunto).toBe(
      "Convite para o grupo Pelada <b>dos Amigos</b> no FutZenha",
    );
  });
});

describe("emailDeEventoDeAgenda", () => {
  // Nome de jogador e local do fut são texto livre de formulário. O apóstrofo e
  // o "e comercial" não são exóticos em nome de quadra — são o caso comum que
  // denuncia escape vazando para a versão texto.
  const FUT = {
    id: 7,
    date: "2026-08-22",
    startTime: "20:00:00",
    endTime: "22:00:00",
    location: "Arena D'Oeste & Cia",
    notes: null,
  };
  const dados = { nome: "Zé <script>alert(1)</script>", fut: FUT };
  const evento = (tipo: TipoDeEventoDeAgenda) => emailDeEventoDeAgenda({ ...dados, tipo });

  it("escapa nome e local no html", () => {
    const email = evento("convite");
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("Arena D&#39;Oeste &amp; Cia");
  });

  // Mesmo par de testes dos outros templates: o `texto` não é HTML, e entidade
  // ali chega crua na caixa de entrada ("Arena D&#39;Oeste").
  it("não escapa nada na versão texto", () => {
    for (const tipo of ["convite", "atualizacao", "saida", "fut-cancelado"] as const) {
      const email = evento(tipo);
      expect(email.texto).toContain("Arena D'Oeste & Cia");
      expect(email.texto).not.toContain("&#39;");
      expect(email.texto).not.toContain("&amp;");
      expect(email.texto).not.toContain("&quot;");
    }
    expect(evento("convite").texto).toContain("Zé <script>alert(1)</script>");
  });

  it("html e texto levam a data e o intervalo do fut", () => {
    const email = evento("convite");
    expect(email.html).toContain("das 20:00 às 22:00");
    expect(email.texto).toContain("das 20:00 às 22:00");
  });

  // Fut anterior ao campo de término: o e-mail fala da hora que existe, sem
  // inventar um fim nem repetir a preposição ("às 20:00 às 21:00").
  it("sem término declarado, fala só do começo", () => {
    const email = emailDeEventoDeAgenda({
      ...dados,
      tipo: "convite",
      fut: { ...FUT, endTime: null },
    });
    expect(email.texto).toContain("às 20:00");
    expect(email.texto).not.toContain("das 20:00");
  });

  // Cancelamento não oferece caminho de volta: o evento está saindo da agenda, e
  // no fut apagado a página do link nem existe mais.
  it("saída e fut cancelado não levam botão nem link do fut", () => {
    for (const tipo of ["saida", "fut-cancelado"] as const) {
      const email = evento(tipo);
      expect(email.html).not.toContain("/agenda/google");
      expect(email.html).not.toContain("/fut/7");
      expect(email.texto).not.toContain("/fut/7");
    }
  });

  // O botão passa pela nossa rota, que redireciona. O `not.toContain` do Google
  // é a regressão que o Resend apontou: link de domínio diferente do remetente
  // pesa em filtro de spam (ver src/app/fut/[id]/agenda/google/route.ts).
  it("convite e atualização levam o botão do Google e o link do fut", () => {
    for (const tipo of ["convite", "atualizacao"] as const) {
      const email = evento(tipo);
      expect(email.html).toContain("/fut/7/agenda/google");
      expect(email.html).not.toContain("calendar.google.com");
      expect(email.texto).toContain("/fut/7");
    }
  });

  it("cada tipo tem o seu assunto", () => {
    expect(evento("convite").assunto).toContain("Na agenda:");
    expect(evento("atualizacao").assunto).toContain("Fut atualizado:");
    expect(evento("saida").assunto).toContain("Fora da lista:");
    expect(evento("fut-cancelado").assunto).toContain("Cancelado:");
  });

  it("sem horário o assunto fala só da data", () => {
    const email = emailDeEventoDeAgenda({
      ...dados,
      tipo: "convite",
      fut: { ...FUT, startTime: null },
    });
    expect(email.assunto).not.toContain("às");
  });

  // O convite ramificado: quem foi posto na lista por outra pessoa recebe o
  // mesmo e-mail com o .ics, mas com outra história — quem foi, que não precisa
  // fazer nada, e por onde sair.
  describe("quando foi outra pessoa que confirmou", () => {
    const porOutro = (confirmadoPor: string | null) =>
      emailDeEventoDeAgenda({ ...dados, tipo: "convite", confirmadoPor });

    // O nome vem PRIMEIRO, e é o que importa: assunto longo é truncado na lista
    // de e-mails do celular, e o que a pessoa precisa ler antes de abrir é que
    // alguém a confirmou — não a data, que já está no corpo e no .ics.
    it("o assunto nomeia quem confirmou, antes de tudo", () => {
      expect(porOutro("Ana").assunto).toBe(
        "Ana confirmou você no fut de sábado, 22/08 das 20:00 às 22:00",
      );
    });

    it("html e texto dizem que não precisa fazer nada", () => {
      const email = porOutro("Ana");
      expect(email.html).toContain("não precisa fazer nada");
      expect(email.texto).toContain("não precisa fazer nada");
    });

    it("oferece o caminho para retirar o nome, na página do fut", () => {
      const email = porOutro("Ana");
      expect(email.html).toContain("Retire seu nome da lista");
      expect(email.html).toContain('href="http://localhost:3000/fut/7"');
      expect(email.texto).toContain("Retire seu nome da lista: http://localhost:3000/fut/7");
    });

    // Nome de jogador é texto livre de formulário, como o do destinatário — e
    // este vai no assunto E no corpo.
    it("escapa o nome de quem confirmou no html, e não no texto", () => {
      const email = porOutro("Zé <script>alert(1)</script>");
      expect(email.html).not.toContain("<script>");
      expect(email.html).toContain("&lt;script&gt;");
      expect(email.texto).toContain("Zé <script>alert(1)</script>");
    });

    // Nulo é quem entrou sozinha — a esmagadora maioria e todo o histórico.
    it("nulo devolve o convite de sempre, sem link de saída", () => {
      const email = porOutro(null);
      expect(email.assunto).toContain("Na agenda:");
      expect(email.html).not.toContain("Retire seu nome");
    });

    // Atualização fala de um evento que a pessoa já tem, e a inclusão já foi
    // avisada quando aconteceu; no cancelamento o assunto é a saída. Remoer a
    // autoria nos dois viraria cobrança.
    it("só o convite ramifica — os outros tipos ignoram quem confirmou", () => {
      for (const tipo of ["atualizacao", "saida", "fut-cancelado"] as const) {
        const email = emailDeEventoDeAgenda({ ...dados, tipo, confirmadoPor: "Ana" });
        expect(email.assunto).not.toContain("Ana");
        expect(email.html).not.toContain("Retire seu nome");
      }
    });
  });
});

describe("emailDeResumoDoFut", () => {
  const resumo = montarResumo({
    times: [
      { id: 1, name: "Verde", sortOrder: 0 },
      { id: 2, name: "Azul & Cia", sortOrder: 1 },
    ],
    jogos: [
      {
        id: 10,
        teamAId: 1,
        teamBId: 2,
        scoreA: 2,
        scoreB: 1,
        sortOrder: 0,
        startedAt: null,
        finishedAt: null,
      },
    ],
    gols: [
      { gameId: 10, playerId: 5, playerName: "Zé D'Ávila", nickname: null, quantity: 2, side: null },
      { gameId: 10, playerId: null, playerName: null, nickname: null, quantity: 1, side: "B" },
    ],
    escalacao: [
      { gameId: 10, playerId: 5, side: "A" },
      { gameId: 10, playerId: 6, side: "B" },
    ],
    elencos: [
      { teamId: 1, playerId: 5, name: "Zé D'Ávila", nickname: null, isGoalkeeper: false },
      { teamId: 2, playerId: 6, name: "Pedro <b>", nickname: null, isGoalkeeper: true },
    ],
  });

  const dados = {
    nome: "Zé",
    fut: { id: 7, date: "2026-08-13", location: "Arena D'Oeste" },
    resumo,
    href: "/avaliar/12",
    podeAvaliar: true,
    prazoHoras: 36,
  };

  it("html e texto levam o placar de cada jogo", () => {
    const email = emailDeResumoDoFut(dados);
    expect(email.html).toContain("2 × 1");
    expect(email.texto).toContain("Verde 2 x 1 Azul & Cia");
  });

  it("o assunto diz de que fut se trata", () => {
    expect(emailDeResumoDoFut(dados).assunto).toContain("13/08");
  });

  // Nome de time e local são texto livre de admin, e apelido é texto livre da
  // própria pessoa: sem escape, `<b>` viraria markup dentro do e-mail.
  it("escapa nome de time, de jogador e local no html", () => {
    const email = emailDeResumoDoFut(dados);
    expect(email.html).toContain("Pedro &lt;b&gt;");
    expect(email.html).toContain("Azul &amp; Cia");
    expect(email.html).toContain("Arena D&#39;Oeste");
    expect(email.html).not.toContain("Pedro <b>");
  });

  // A versão texto sai dos valores CRUS: derivá-la do html deixaria `&#39;` e
  // `&amp;` visíveis em cliente de texto puro.
  it("o texto leva os valores crus, sem entidade de html", () => {
    const email = emailDeResumoDoFut(dados);
    expect(email.texto).toContain("Zé D'Ávila");
    expect(email.texto).toContain("Arena D'Oeste");
    expect(email.texto).toContain("Pedro <b>");
    expect(email.texto).not.toContain("&#39;");
    expect(email.texto).not.toContain("&amp;");
  });

  it("o link vai no html e no texto", () => {
    const email = emailDeResumoDoFut(dados);
    expect(email.html).toContain("/avaliar/12");
    expect(email.texto).toContain("/avaliar/12");
  });

  it("o botão e a chamada mudam com podeAvaliar", () => {
    const avaliador = emailDeResumoDoFut(dados);
    expect(avaliador.html).toContain("Avaliar a rapaziada");
    expect(avaliador.html).toContain("36 horas");

    const espectador = emailDeResumoDoFut({
      ...dados,
      href: "/fut/7",
      podeAvaliar: false,
    });
    expect(espectador.html).toContain("Ver o fut");
    expect(espectador.html).not.toContain("36 horas");
    expect(espectador.texto).toContain("/fut/7");
  });

  it("gol sem autor aparece como tal, e fica fora da artilharia", () => {
    const email = emailDeResumoDoFut(dados);
    expect(email.texto).toContain("Gol contra / sem autor");
    // Só o Zé pontuou: dois gols dele, e o gol contra sem dono.
    expect(email.texto).toContain("Artilharia do dia:");
    expect(email.texto).toContain("- Zé D'Ávila: 2");
  });

  it("marca o goleiro no elenco", () => {
    expect(emailDeResumoDoFut(dados).texto).toContain("Pedro <b> (goleiro)");
  });

  // O que o resumo não tem, dito em vez de omitido.
  it("avisa que o MVP ainda não saiu e que o placar é corrigível", () => {
    const email = emailDeResumoDoFut(dados);
    expect(email.html).toContain("melhor em campo sai quando a avaliação fechar");
    expect(email.html).toContain("24 horas");
  });

  // A moldura tem o rodapé do convite cravado por padrão — este e-mail vai para
  // quem jogou, e "alguém convidou você" seria mentira.
  it("o rodapé é o de quem jogou, não o do convite", () => {
    const email = emailDeResumoDoFut(dados);
    expect(email.html).toContain("porque jogou este fut");
    expect(email.html).not.toContain("convidou você");
  });

  it("fut sem times nem artilharia ainda monta o e-mail", () => {
    const vazio = montarResumo({
      times: [],
      jogos: [
        {
          id: 1,
          teamAId: 9,
          teamBId: 8,
          scoreA: 0,
          scoreB: 0,
          sortOrder: 0,
          startedAt: null,
          finishedAt: null,
        },
      ],
      gols: [],
      escalacao: [],
      elencos: [],
    });
    const email = emailDeResumoDoFut({ ...dados, resumo: vazio });
    expect(email.html).toContain("Sem gols lançados");
    expect(email.texto).not.toContain("Artilharia do dia");
  });
});
