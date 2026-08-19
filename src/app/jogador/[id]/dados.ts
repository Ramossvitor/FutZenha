import "server-only";
import { listarGruposDoSeletor, listarMeusGrupos, type MeuGrupo } from "@/lib/grupos";
import { gruposVisiveisNoPerfil, podeFiltrarPerfilPorGrupo } from "@/lib/grupos-permissions";
import { getJogador, type PerfilJogador } from "@/lib/jogadores";
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

export type DadosDoPerfil = {
  jogador: PerfilJogador;
  /** O que o visitante pode saber que existe. Lista da seção "Grupos". */
  gruposVisiveis: MeuGrupo[];
  /** Os de `gruposVisiveis` por onde ele também pode recortar os números. */
  gruposFiltraveis: MeuGrupo[];
  grupoSelecionado: MeuGrupo | null;
  numeros: NumerosDoPerfil;
};

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
  const [jogador, gruposDoAlvo, gruposDoVisitante] = await Promise.all([
    getJogador(alvoId),
    listarMeusGrupos(alvoId),
    listarGruposDoSeletor(visitante.playerId),
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
