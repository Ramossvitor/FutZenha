// O checklist da tela de encerrar.
//
// Encerrar é o ponto de não retorno do produto: a escalação congela para
// sempre, os números entram nos rankings e a rodada de avaliação abre com
// prazo correndo. O checklist existe para que a pessoa veja o que vai
// acontecer antes de clicar, e não depois.
//
// Puro de propósito — quem chama busca os números no Postgres e passa prontos,
// como o resto de src/lib. Assim dá para testar cada combinação sem banco.

import { MIN_GRUPO_AVALIACAO } from "./lineup";

export type JogoParaEncerrar = {
  /** 1, 2, 3… na ordem em que aparecem na tela. */
  ordem: number;
  ladoA: number;
  ladoB: number;
};

export type ItemDoChecklist = {
  chave: string;
  tom: "ok" | "alerta" | "neutro";
  titulo: string;
  detalhe: string;
};

export type Checklist = {
  itens: ItemDoChecklist[];
  /** Espelha exatamente a regra que confirmarEncerramento aplica no servidor. */
  podeEncerrar: boolean;
};

/**
 * Quem confirmou presença e não entrou em nenhum jogo — a lista "vão contar
 * falta" da tela de encerrar, e exatamente o conjunto que o
 * marcarFaltasAutomaticas grava como `no_show` no encerramento.
 *
 * Mora aqui, e não inline na página, porque a prévia e o servidor têm que dizer
 * a mesma coisa: com a regra copiada em dois lugares, mudar um faria a tela
 * prometer o que o encerramento não cumpre, e o teste que compara os dois
 * passaria mesmo assim se tivesse a própria cópia.
 *
 * Fut sem jogo lançado não marca falta em ninguém (ver
 * confirmarEncerramento) — por isso `temJogo` zera a lista inteira.
 */
export function quemViraFalta({
  temJogo,
  confirmados,
  escalados,
}: {
  temJogo: boolean;
  confirmados: number[];
  escalados: Iterable<number>;
}): number[] {
  if (!temJogo) return [];
  const emCampo = new Set(escalados);
  return confirmados.filter((playerId) => !emCampo.has(playerId));
}

function plural(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

function listar(nomes: string[]): string {
  if (nomes.length === 1) return nomes[0];
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/**
 * @param jogos TODOS os jogos do fut, inclusive os que não têm nenhuma
 *   linha de escalação — um jogo sem ninguém sai com `ladoA` e `ladoB` zerados
 *   e é justamente o caso que trava o encerramento. Filtrar antes esconderia o
 *   bloqueio e a pessoa levaria um erro que a tela jurava não existir.
 * @param avaliaveis Quantos jogadores vão realmente receber nota — o tamanho
 *   de `gruposElegiveis()`, que já aplica o mínimo de grupo por lado.
 * @param comContaEmCampo Quantos escalados têm conta ativa, elegíveis ou não.
 *   Vem junto com `avaliaveis` porque a checagem do `gruposElegiveis` é POR
 *   LADO: com um lado de 5 contas e outro de 2, `avaliaveis` sai 5 e sozinho
 *   não dá para saber que 2 pessoas ficaram de fora. A diferença entre os dois
 *   é exatamente quem joga com conta e mesmo assim não recebe nota.
 * @param semConta Apelidos de quem está escalado sem conta ativa.
 */
export function montarChecklist({
  jogos,
  avaliaveis,
  comContaEmCampo,
  semConta,
}: {
  jogos: JogoParaEncerrar[];
  avaliaveis: number;
  comContaEmCampo: number;
  semConta: string[];
}): Checklist {
  const itens: ItemDoChecklist[] = [];

  const vazios = jogos.filter((j) => j.ladoA === 0 || j.ladoB === 0);

  if (jogos.length === 0) {
    itens.push({
      chave: "jogos",
      tom: "alerta",
      titulo: "Nenhum jogo lançado",
      detalhe:
        "Dá para encerrar assim, mas o fut não entra em placar, artilharia nem avaliação. Só a presença conta.",
    });
  } else {
    itens.push({
      chave: "jogos",
      tom: "ok",
      titulo: `${plural(jogos.length, "jogo lançado", "jogos lançados")}`,
      detalhe: "Os placares entram nos rankings assim que você encerrar.",
    });
  }

  if (vazios.length > 0) {
    const quais = listar(vazios.map((j) => `jogo ${j.ordem}`));
    itens.push({
      chave: "lado-vazio",
      tom: "alerta",
      titulo:
        vazios.length === 1
          ? `O ${quais} está com um lado vazio`
          : `${quais} estão com um lado vazio`,
      detalhe: "Não dá para encerrar assim. Corrige a escalação acima.",
    });
  }

  // Quem tem conta, jogou, e ainda assim não recebe nota: caiu num lado que não
  // fechou o mínimo. Some com `avaliaveis` para dar o total com conta em campo.
  const foraDaAvaliacao = comContaEmCampo - avaliaveis;

  if (avaliaveis === 0) {
    itens.push({
      chave: "avaliacao",
      tom: "alerta",
      titulo: "Ninguém vai ser avaliado",
      detalhe: `A avaliação precisa de ${MIN_GRUPO_AVALIACAO} contas ativas do mesmo lado. O fut conta para placar, artilharia e presença — mas não mexe em nota nenhuma.`,
    });
  } else if (foraDaAvaliacao > 0) {
    itens.push({
      chave: "avaliacao",
      tom: "alerta",
      titulo: `${plural(avaliaveis, "conta ativa vai", "contas ativas vão")} ser avaliada${avaliaveis === 1 ? "" : "s"}`,
      detalhe: `A checagem é por lado: ${plural(foraDaAvaliacao, "conta ficou", "contas ficaram")} num lado com menos de ${MIN_GRUPO_AVALIACAO} contas ativas e não recebe nota. Joga, marca gol e conta presença do mesmo jeito.`,
    });
  } else {
    itens.push({
      chave: "avaliacao",
      tom: "ok",
      titulo: `${plural(avaliaveis, "conta ativa", "contas ativas")} em campo`,
      detalhe: `Todo lado tem ${MIN_GRUPO_AVALIACAO} ou mais — a avaliação vale.`,
    });
  }

  if (semConta.length > 0) {
    itens.push({
      chave: "sem-conta",
      tom: "neutro",
      titulo:
        semConta.length === 1
          ? `${semConta[0]} está sem conta`
          : `${plural(semConta.length, "jogador está", "jogadores estão")} sem conta`,
      detalhe:
        semConta.length === 1
          ? "Joga e marca gol, mas não avalia nem é avaliado."
          : `${listar(semConta)} jogam e marcam gol, mas não avaliam nem são avaliados.`,
    });
  }

  return { itens, podeEncerrar: vazios.length === 0 };
}
