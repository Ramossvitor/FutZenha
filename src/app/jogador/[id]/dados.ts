import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { lojaItens, zenhaEquipados, zenhaInventario } from "@/db/schema";
import { listarGruposDoSeletor, listarMeusGrupos, type MeuGrupo } from "@/lib/grupos";
import { gruposVisiveisNoPerfil, podeFiltrarPerfilPorGrupo } from "@/lib/grupos-permissions";
import { getJogador, type PerfilJogador } from "@/lib/jogadores";
import type { ItemDaLoja } from "@/lib/item-da-loja";
import { lerVitrine, type BadgeNaVitrine } from "@/lib/loja";
import type { Ator } from "@/lib/permissions";
import { posicoes } from "@/lib/posicao";
import { getAttendanceStats, getMvpRanking, getPlayerRecords, getTopScorers } from "@/lib/stats";

export type NumerosDoPerfil = {
  gols: number;
  jogos: number;
  vitorias: number;
  empates: number;
  derrotas: number;
  /** null = não entrou em campo no escopo — "—" na tela, e não 0%. */
  aproveitamento: number | null;
  presencas: number;
  totalDays: number;
  /** 0 = fora da artilharia. */
  posicaoArtilharia: number;
  /** null = escopo geral. O MVP é métrica só de grupo (ver getMvpRanking). */
  titulosMvp: number | null;
};

/**
 * O que a pessoa comprou e escolheu mostrar.
 *
 * Um campo por slot para os três de vaga única, porque cada um tem um lugar
 * diferente no cabeçalho — o `zenhaSlotEnum` do banco é o mesmo
 * `SlotDeExibicao` do módulo puro justamente para essa tradução não ter que
 * adivinhar nada.
 *
 * `badges` é lista porque badge é COLEÇÃO: até cinco, na ordem das vagas que a
 * pessoa montou, com no máximo um marcado como destaque.
 */
export type VitrineDoJogador = {
  moldura: ItemDaLoja | null;
  corDoNome: ItemDaLoja | null;
  titulo: ItemDaLoja | null;
  badges: BadgeNaVitrine[];
};

export type DadosDoPerfil = {
  jogador: PerfilJogador;
  /** O que o visitante pode saber que existe. Lista da seção "Grupos". */
  gruposVisiveis: MeuGrupo[];
  /** Os de `gruposVisiveis` por onde ele também pode recortar os números. */
  gruposFiltraveis: MeuGrupo[];
  grupoSelecionado: MeuGrupo | null;
  numeros: NumerosDoPerfil;
  vitrine: VitrineDoJogador;
};

/**
 * Os cosméticos que o jogador está mostrando.
 *
 * Sem filtro de privacidade nenhum, e é uma decisão: item exibido é vitrine —
 * a pessoa pagou zenha para que os outros vejam, e escolheu, item por item, o
 * que deixar à mostra. O que continua protegido é o que sempre foi (as estrelas
 * recebidas, os grupos privados alheios); nada aqui conta quanto ela pagou nem o
 * que ela tem guardado no inventário.
 *
 * Duas consultas em paralelo porque são duas tabelas diferentes com regras
 * diferentes — slot único em `zenha_equipados`, coleção ordenada em
 * `zenha_vitrine` — e nenhuma depende da outra.
 *
 * O slot vem da linha de `zenha_equipados`, e não do tipo do item: é a coluna da
 * PK, e é ela que garante um item por slot. Se um item mudar de tipo no catálogo
 * depois de equipado, obedecer a linha mantém a promessa "um título, uma
 * moldura" — obedecer o catálogo abriria a porta para dois títulos. (O painel do
 * admin não deixa trocar o tipo justamente por isso; a defesa aqui é a segunda.)
 *
 * O item fora de venda continua sendo desenhado: quem comprou continua exibindo.
 * É a contrapartida de o admin poder retirar da vitrine sem apagar nada.
 */
async function carregarVitrine(playerId: number): Promise<VitrineDoJogador> {
  const [equipados, badges] = await Promise.all([
    db
      .select({
        slot: zenhaEquipados.slot,
        id: lojaItens.id,
        tipo: lojaItens.tipo,
        nome: lojaItens.nome,
        descricao: lojaItens.descricao,
        preco: lojaItens.preco,
        cor: lojaItens.cor,
        imagemHash: lojaItens.imagemHash,
        ativo: lojaItens.ativo,
      })
      .from(zenhaEquipados)
      .innerJoin(zenhaInventario, eq(zenhaInventario.id, zenhaEquipados.inventarioId))
      .innerJoin(lojaItens, eq(lojaItens.id, zenhaInventario.itemId))
      .where(eq(zenhaEquipados.playerId, playerId)),
    lerVitrine(db, playerId),
  ]);

  const vitrine: VitrineDoJogador = { moldura: null, corDoNome: null, titulo: null, badges };
  for (const linha of equipados) {
    // Nenhum dos três cosméticos de slot tem efeito — o check
    // `(tipo = 'consumivel') = (efeito is not null)` responde por isso.
    const item: ItemDaLoja = { ...linha, efeito: null };
    switch (linha.slot) {
      case "moldura":
        vitrine.moldura = item;
        break;
      case "cor_do_nome":
        vitrine.corDoNome = item;
        break;
      case "titulo":
        vitrine.titulo = item;
        break;
      default:
        // Slot novo no enum sem lugar no cabeçalho não compila: aqui o tipo de
        // `linha.slot` já está estreitado a `never`. Sem esta linha ele cairia
        // fora da tela em silêncio, e o defeito seria "comprei e não apareceu"
        // — o pior possível numa loja.
        linha.slot satisfies never;
        break;
    }
  }
  return vitrine;
}

/**
 * Tudo que o perfil público mostra. `undefined` = jogador não existe.
 *
 * Duas listas de grupo, e a diferença entre elas é uma regra: `gruposVisiveis`
 * responde `podeVerGrupo` em lote (grupo público é de todo mundo) e
 * `gruposFiltraveis` responde `podeVerRankingDoGrupo` (só quem é do grupo) —
 * ver podeFiltrarPerfilPorGrupo. Grupo público de que o visitante não participa
 * entra na primeira e fica de fora da segunda: ele pode saber que o alvo joga
 * ali, não ler o ranking daquele grupo um jogador por vez.
 *
 * O `?grupo=` só vale se o grupo estiver em `gruposFiltraveis`; qualquer outro
 * valor — grupo privado alheio, grupo público de que o visitante não participa,
 * grupo de que o alvo não participa, lixo — cai calado no escopo geral. É de
 * propósito que não seja 404: a mesma resposta para "não existe" e para "existe
 * mas você não pode saber" é o que impede a URL de virar um oráculo de
 * co-participação, na mesma linha do 404 do src/lib/require-grupo.ts.
 */
export async function carregarPerfil(
  visitante: Ator,
  alvoId: number,
  grupoParam: string | string[] | undefined,
): Promise<DadosDoPerfil | undefined> {
  const [jogador, gruposDoAlvo, gruposDoVisitante, vitrine] = await Promise.all([
    getJogador(alvoId),
    listarMeusGrupos(alvoId),
    listarGruposDoSeletor(visitante.playerId),
    // No mesmo lote das outras três: a vitrine não depende de permissão
    // nenhuma, e esperar o jogador para só então pedir os cosméticos
    // acrescentaria um ida-e-volta ao banco no caminho crítico da página.
    carregarVitrine(alvoId),
  ]);
  if (!jogador) return undefined;

  const idsDoVisitante = new Set(gruposDoVisitante.map((g) => g.id));
  const gruposVisiveis = gruposVisiveisNoPerfil(visitante, gruposDoAlvo, idsDoVisitante);
  const gruposFiltraveis = gruposVisiveis.filter((g) =>
    podeFiltrarPerfilPorGrupo(visitante, idsDoVisitante, g.id),
  );

  const pedido =
    typeof grupoParam === "string" && /^\d+$/.test(grupoParam) ? Number(grupoParam) : null;
  const grupoSelecionado = pedido ? (gruposFiltraveis.find((g) => g.id === pedido) ?? null) : null;

  const escopo = { groupId: grupoSelecionado?.id };
  const [artilheiros, records, presenca, mvps] = await Promise.all([
    getTopScorers(escopo),
    getPlayerRecords(escopo),
    getAttendanceStats(escopo),
    grupoSelecionado ? getMvpRanking({ groupId: grupoSelecionado.id }) : Promise.resolve(null),
  ]);

  // A lista inteira e um `.find()`, como faz o /perfil: é o que garante que
  // perfil e rankings contem a mesma história — uma consulta agregada por
  // jogador seria a segunda implementação das mesmas regras (fut encerrado, gol
  // desfeito, conta ativa) e divergiria em silêncio. E a posição na artilharia
  // precisa da lista inteira de qualquer jeito.
  const retro = records.find((r) => r.playerId === alvoId);
  // `índice + 1` diria 2º para o segundo de dois artilheiros empatados, e a aba
  // de artilharia — que usa posicoes() — diria 1º para os dois.
  const indiceArtilharia = artilheiros.findIndex((a) => a.playerId === alvoId);
  const posicaoArtilharia =
    indiceArtilharia < 0 ? 0 : posicoes(artilheiros, (a) => a.total)[indiceArtilharia];

  return {
    jogador,
    gruposVisiveis,
    gruposFiltraveis,
    grupoSelecionado,
    vitrine,
    numeros: {
      gols: artilheiros.find((a) => a.playerId === alvoId)?.total ?? 0,
      jogos: retro?.gamesPlayed ?? 0,
      vitorias: retro?.wins ?? 0,
      empates: retro?.draws ?? 0,
      derrotas: retro?.losses ?? 0,
      aproveitamento: retro?.winRate ?? null,
      presencas: presenca.perPlayer.find((p) => p.playerId === alvoId)?.attended ?? 0,
      totalDays: presenca.totalDays,
      posicaoArtilharia,
      titulosMvp: mvps ? (mvps.find((m) => m.playerId === alvoId)?.titulos ?? 0) : null,
    },
  };
}
