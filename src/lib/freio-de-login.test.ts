import { beforeEach, describe, expect, it } from "vitest";
import {
  esquecerFalhasDeLogin,
  JANELA_MS,
  MAX_CHAVES,
  permitirTentativaDeLogin,
  registrarFalhaDeLogin,
  reiniciarFreioDeLogin,
  TENTATIVAS_POR_JANELA,
} from "./freio-de-login";

// O relógio entra por parâmetro em toda função do módulo: sem isso, testar a
// janela exigiria esperar 60s de verdade ou mockar Date.now global.
const T0 = 1_700_000_000_000;

beforeEach(() => {
  reiniciarFreioDeLogin();
});

function falharVezes(chave: string, quantas: number, agora = T0): void {
  for (let i = 0; i < quantas; i++) registrarFalhaDeLogin(chave, agora);
}

describe("freio de login", () => {
  it("deixa passar quem nunca falhou", () => {
    expect(permitirTentativaDeLogin("du", T0)).toBe(true);
  });

  it("deixa passar exatamente o teto e barra a seguinte", () => {
    falharVezes("du", TENTATIVAS_POR_JANELA - 1);
    expect(permitirTentativaDeLogin("du", T0)).toBe(true);

    registrarFalhaDeLogin("du", T0);
    expect(permitirTentativaDeLogin("du", T0)).toBe(false);
  });

  it("o bloqueio é de uma chave só — não derruba as outras contas", () => {
    falharVezes("du", TENTATIVAS_POR_JANELA);
    expect(permitirTentativaDeLogin("du", T0)).toBe(false);
    expect(permitirTentativaDeLogin("outra-pessoa", T0)).toBe(true);
  });

  it("solta quando a janela passa", () => {
    falharVezes("du", TENTATIVAS_POR_JANELA);
    expect(permitirTentativaDeLogin("du", T0 + JANELA_MS - 1)).toBe(false);
    expect(permitirTentativaDeLogin("du", T0 + JANELA_MS)).toBe(true);
  });

  // O caso que a janela FIXA deixaria passar, e que é a razão de o módulo
  // guardar instantes em vez de um contador com marco de início: 10 falhas no
  // fim de uma janela e 10 no começo da seguinte seriam 20 em segundos.
  it("é janela deslizante: não libera o dobro do teto na virada", () => {
    // Espaçadas em 1s — é o espaçamento que torna o teste capaz de distinguir
    // janela deslizante de janela fixa. Com todas no mesmo instante, as duas
    // implementações se comportariam igual e o teste não provaria nada.
    for (let i = 0; i < TENTATIVAS_POR_JANELA; i++) {
      registrarFalhaDeLogin("du", T0 + i * 1_000);
    }
    expect(permitirTentativaDeLogin("du", T0 + (TENTATIVAS_POR_JANELA - 1) * 1_000)).toBe(false);

    // Só a PRIMEIRA falha venceu: abre exatamente uma vaga, não dez.
    const primeiraVenceu = T0 + JANELA_MS;
    expect(permitirTentativaDeLogin("du", primeiraVenceu)).toBe(true);
    registrarFalhaDeLogin("du", primeiraVenceu);
    expect(permitirTentativaDeLogin("du", primeiraVenceu)).toBe(false);
  });

  it("acertar a senha tira a chave do radar na hora", () => {
    falharVezes("du", TENTATIVAS_POR_JANELA);
    expect(permitirTentativaDeLogin("du", T0)).toBe(false);

    esquecerFalhasDeLogin("du");
    expect(permitirTentativaDeLogin("du", T0)).toBe(true);
  });

  // Martelar nomes aleatórios não pode trocar um problema de CPU por um de
  // memória. A poda é grosseira de propósito (ver o comentário do módulo); o
  // que este teste garante é que ela ACONTECE e que o freio segue funcionando
  // para quem chega depois dela.
  it("não cresce sem limite com chaves diferentes", () => {
    for (let i = 0; i <= MAX_CHAVES; i++) registrarFalhaDeLogin(`nome-${i}`, T0);

    falharVezes("du", TENTATIVAS_POR_JANELA);
    expect(permitirTentativaDeLogin("du", T0)).toBe(false);
  });

  it("a poda descarta o que já venceu antes de esvaziar tudo", () => {
    // Estas envelhecem e devem sair na poda...
    for (let i = 0; i <= MAX_CHAVES; i++) registrarFalhaDeLogin(`velha-${i}`, T0);
    // ...disparada por uma falha nova, já fora da janela das anteriores.
    const depois = T0 + JANELA_MS;
    falharVezes("du", TENTATIVAS_POR_JANELA, depois);

    // A chave nova sobreviveu à poda: ela é a única dentro da janela.
    expect(permitirTentativaDeLogin("du", depois)).toBe(false);
  });
});
