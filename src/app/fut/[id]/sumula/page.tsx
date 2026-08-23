import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { BannerDaQuery } from "@/components/ui/banner";
import { LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { requireOperadorSumula } from "@/lib/require-operador-sumula";
import {
  marcarPodeDesfazer,
  montarLinhaDoTempo,
  sumulaDisponivel,
  tempoAtras,
} from "@/lib/sumula";
import { carregarSumula } from "./dados";
import { PainelSumula, type JogoAberto } from "./painel";

// Mensagens que merecem texto mais direto nesta tela; as demais vêm do
// dicionário global (src/lib/mensagens.ts).
const LOCAIS = {
  "dados-invalidos": "Não deu para registrar — atualize a página e tente de novo.",
};

export default async function SumulaPage({ params, searchParams }: PageProps<"/fut/[id]/sumula">) {
  const { id: idParam } = await params;
  const { erro, ok } = await searchParams;
  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();

  // 404 para quem não opera — inclusive id inexistente (mesma regra do guard
  // de admin). Delegado entra; o papel decide o alcance do desfazer.
  const { matchDay, ehAdminDoFut } = await requireOperadorSumula(id);

  // Antes do sorteio não há lado para creditar gol; encerrado, a correção é
  // assunto do /gerenciar (com a janela de 24h de lá). A mesma regra que decide
  // os links e o iniciarJogo — ver src/lib/sumula.ts.
  if (!sumulaDisponivel(matchDay)) redirect(`/fut/${id}`);

  const dados = await carregarSumula(matchDay, ehAdminDoFut);
  const nomeDoTime = new Map(dados.teamList.map((t) => [t.id, t.name]));

  let jogo: JogoAberto | null = null;
  if (dados.aberto) {
    const aberto = dados.aberto;
    // O recorte do delegado — o lançamento ativo mais recente de cada lado —
    // resolvido pela mesma função que o teste unitário cobre, para a UI só
    // oferecer o que a action aceitaria.
    const lancamentos = marcarPodeDesfazer(dados.lancamentoRows, ehAdminDoFut);
    jogo = {
      id: aberto.id,
      scoreA: aberto.scoreA,
      scoreB: aberto.scoreB,
      timeA: nomeDoTime.get(aberto.teamAId) ?? "",
      timeB: nomeDoTime.get(aberto.teamBId) ?? "",
      emAndamentoHa: tempoAtras(aberto.segundosEmAndamento ?? 0),
      ladoA: dados.lineupRows
        .filter((m) => m.side === "A")
        .map((m) => ({ playerId: m.playerId, rotulo: m.apelido ?? m.nome })),
      ladoB: dados.lineupRows
        .filter((m) => m.side === "B")
        .map((m) => ({ playerId: m.playerId, rotulo: m.apelido ?? m.nome })),
      // Gols e trocas de lado numa lista só, ordenada pelo relógio do banco —
      // o id não serve de relógio entre duas tabelas (ver montarLinhaDoTempo).
      eventos: montarLinhaDoTempo(
        lancamentos.map((l) => ({
          id: l.id,
          criadoEm: l.criadoEm,
          lado: l.side,
          autor: l.autorApelido ?? l.autorNome,
          lancadoPor: l.lancadoPorApelido ?? l.lancadoPor,
          tempoAtras: tempoAtras(l.segundosAtras),
          desfeito: l.desfeito,
          desfeitoPor: l.desfeitoPorApelido ?? l.desfeitoPor,
          podeDesfazer: l.podeDesfazer,
        })),
        dados.trocaRows.map((t) => ({
          id: t.id,
          criadoEm: t.criadoEm,
          jogador: t.jogadorApelido ?? t.jogadorNome,
          de: t.de,
          para: t.para,
          por: t.porApelido ?? t.porNome,
          tempoAtras: tempoAtras(t.segundosAtras),
        })),
      ),
    };
  }

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        titulo="Súmula ao vivo"
        selos={<Badge tom="outline">{formatDate(matchDay.date)}</Badge>}
        descricao={matchDay.location}
        acao={
          <LinkButton href={`/fut/${matchDay.id}`} variante="secondary" tamanho="sm">
            Página do fut
          </LinkButton>
        }
      />

      <BannerDaQuery erro={erro} ok={ok} locais={LOCAIS} />

      <PainelSumula
        matchDayId={matchDay.id}
        ehAdminDoFut={ehAdminDoFut}
        jogo={jogo}
        times={dados.teamList.map((t) => ({ id: t.id, nome: t.name }))}
        jogosAnteriores={dados.gameList
          .filter((g) => g.id !== dados.aberto?.id)
          .map((g) => ({
            id: g.id,
            timeA: nomeDoTime.get(g.teamAId) ?? "",
            timeB: nomeDoTime.get(g.teamBId) ?? "",
            scoreA: g.scoreA,
            scoreB: g.scoreB,
          }))}
        operadores={dados.operadores.map((o) => ({
          playerId: o.playerId,
          rotulo: o.apelido ?? o.nome,
          delegadoPor: o.delegadoPor,
        }))}
        candidatos={dados.candidatos.map((c) => ({
          playerId: c.playerId,
          rotulo: c.apelido ?? c.nome,
        }))}
      />
    </div>
  );
}
