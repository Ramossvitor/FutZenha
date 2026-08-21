import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { zenhaEquipados, zenhaInventario } from "@/db/schema";
import { listarGruposDoSeletor, listarMeusGrupos, type MeuGrupo } from "@/lib/grupos";
import { gruposVisiveisNoPerfil, podeFiltrarPerfilPorGrupo } from "@/lib/grupos-permissions";
import { getJogador, type PerfilJogador } from "@/lib/jogadores";
import { CATALOGO, ehIdDeItem, type ItemDaLoja } from "@/lib/loja-catalogo";
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
 * O que a pessoa comprou e deixou equipado, já traduzido de `item_id` para a
 * entrada do catálogo.
 *
 * Um campo por slot, e não uma lista solta, porque cada slot tem um lugar
 * diferente no cabeçalho — o `zenhaSlotEnum` do banco é o mesmo `SlotDeExibicao`
 * do catálogo justamente para essa tradução não ter que adivinhar nada.
 *
 * `selos` é lista mesmo com a PK composta `(player_id, slot)` limitando a UM
 * badge equipado: quem varre as linhas do banco já as recebe em array, e é o
 * formato que a tela aceita sem mudar de forma se o dia do segundo badge
 * chegar.
 */
export type VitrineDoJogador = {
  moldura: ItemDaLoja | null;
  corDoNome: ItemDaLoja | null;
  titulo: ItemDaLoja | null;
  selos: ItemDaLoja[];
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
 * Os cosméticos equipados do jogador.
 *
 * Sem filtro de privacidade nenhum, e é uma decisão: item comprado é vitrine —
 * a pessoa pagou zenha para que os outros vejam. O que continua protegido é o
 * que sempre foi (as estrelas recebidas, os grupos privados alheios); nada aqui
 * conta quanto ela pagou nem o que ela tem guardado no inventário.
 *
 * O `item_id` é text SEM FK de propósito (o catálogo é código — ver
 * src/lib/loja-catalogo.ts), então esta é a fronteira onde um id que o catálogo
 * não conhece precisa morrer CALADO. A regra da casa é nunca apagar entrada, só
 * aposentar; se ela for quebrada um dia, o preço tem que ser um badge que
 * sumiu, e não o perfil inteiro em 500.
 *
 * O slot vem da linha de `zenha_equipados`, e não de `item.slot`: é a coluna da
 * PK, e é ela que garante um item por slot. Se um item mudar de slot no
 * catálogo depois de equipado, obedecer a linha mantém a promessa "um título,
 * uma moldura" — obedecer o catálogo abriria a porta para dois títulos.
 */
async function carregarVitrine(playerId: number): Promise<VitrineDoJogador> {
  const linhas = await db
    .select({ slot: zenhaEquipados.slot, itemId: zenhaInventario.itemId })
    .from(zenhaEquipados)
    .innerJoin(zenhaInventario, eq(zenhaInventario.id, zenhaEquipados.inventarioId))
    .where(eq(zenhaEquipados.playerId, playerId));

  const vitrine: VitrineDoJogador = { moldura: null, corDoNome: null, titulo: null, selos: [] };
  for (const linha of linhas) {
    // O id que o catálogo não conhece morre aqui, sem log e sem erro — é a
    // decisão explicada acima, e ela precisa ser visível na linha que a executa.
    if (!ehIdDeItem(linha.itemId)) continue;
    const item = CATALOGO[linha.itemId];
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
      case "badge":
        vitrine.selos.push(item);
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
