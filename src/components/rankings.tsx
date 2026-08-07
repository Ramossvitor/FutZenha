import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { HairlineList, HairlineRow } from "@/components/ui/hairline-list";
import { Meter } from "@/components/ui/meter";
import { Nota, NotaVariacao } from "@/components/ui/nota";
import { Podium } from "@/components/ui/podium";
import { cx } from "@/lib/cx";
import { posicoes } from "@/lib/posicao";
import {
  getAttendanceStats,
  getAvailableYears,
  getPlayerRecords,
  getSkillRanking,
  getTopScorers,
} from "@/lib/stats";

/** Mínimo de jogos para entrar no ranking de aproveitamento. */
const MIN_JOGOS = 3;

export const ABAS = [
  { chave: "notas", label: "Notas" },
  { chave: "artilharia", label: "Artilharia" },
  { chave: "aproveitamento", label: "Aproveitamento" },
  { chave: "presenca", label: "Presença" },
] as const;

export type AbaDeRanking = (typeof ABAS)[number]["chave"];

export function abaValida(v: string | string[] | undefined): AbaDeRanking {
  return typeof v === "string" && ABAS.some((a) => a.chave === v) ? (v as AbaDeRanking) : "notas";
}

export function anoValido(v: string | string[] | undefined): number | undefined {
  return typeof v === "string" && /^\d{4}$/.test(v) ? Number(v) : undefined;
}

/** Monta o href preservando a outra dimensão do filtro. */
function href(base: string, aba: AbaDeRanking, ano?: number) {
  const q = new URLSearchParams();
  if (aba !== "notas") q.set("aba", aba);
  if (ano) q.set("ano", String(ano));
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

function Pilula({ ativo, children, ...rest }: { ativo: boolean } & React.ComponentProps<typeof Link>) {
  return (
    <Link
      {...rest}
      aria-current={ativo ? "page" : undefined}
      className={cx(
        "shrink-0 rounded-ctl border px-3 py-1.5 font-display text-[12px] font-bold font-stretch-112% whitespace-nowrap transition-colors",
        ativo
          ? "border-accent-edge bg-accent text-on-accent"
          : "border-line-strong bg-surface text-fg-2 hover:border-line-hover hover:text-fg",
      )}
    >
      {children}
    </Link>
  );
}

function Posicao({ n }: { n: number }) {
  return (
    <span className="w-6 shrink-0 font-display text-[12px] font-extrabold text-fg-4" data-num>
      {n}º
    </span>
  );
}

function NomeDoJogador({ apelido, nome }: { apelido: string | null; nome: string }) {
  // Apelido manda: é como o grupo chama a pessoa. O nome vai embaixo, miúdo,
  // para quem só conhece de um jeito conseguir achar.
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate font-display text-[14.5px] leading-[1.2] font-bold text-fg">
        {apelido ?? nome}
      </span>
      {apelido && <span className="block truncate text-[11.5px] text-fg-4">{nome}</span>}
    </span>
  );
}

/**
 * Os quatro rankings, servindo três rotas: /rankings (escopo = grupo do
 * contexto), /grupo/[id]/ranking (escopo = grupo da URL) e a artilharia.
 *
 * Antes eram três páginas com consultas quase iguais e resultados que
 * divergiam — /rankings nem tinha artilharia, e o mínimo de jogos era uma
 * constante copiada em duas delas.
 *
 * As abas vão por searchParams, e não por estado: assim a tela continua sem
 * JavaScript, e cada aba tem URL própria para mandar no zap.
 */
export async function Rankings({
  base,
  aba,
  ano,
  groupId,
  destaquePlayerId,
}: {
  /** A rota que hospeda, para os links das abas. */
  base: string;
  aba: AbaDeRanking;
  ano?: number;
  groupId?: number;
  /** Realça a própria linha de quem está lendo. */
  destaquePlayerId?: number;
}) {
  const escopo = { year: ano, groupId };

  const [notas, artilheiros, records, presenca, anos] = await Promise.all([
    aba === "notas" ? getSkillRanking({ groupId }) : Promise.resolve([]),
    aba === "artilharia" ? getTopScorers(escopo) : Promise.resolve([]),
    aba === "aproveitamento" ? getPlayerRecords(escopo, MIN_JOGOS) : Promise.resolve([]),
    aba === "presenca"
      ? getAttendanceStats(escopo)
      : Promise.resolve({ totalDays: 0, perPlayer: [] }),
    // getAvailableYears só aceita groupId — passar `year` aqui devolveria só o
    // próprio ano e o filtro deixaria de existir depois do primeiro clique.
    getAvailableYears({ groupId }),
  ]);

  // A nota é estado atual, não acumulado de temporada — não faz sentido
  // perguntar "qual era a nota em 2024".
  const temFiltroDeAno = aba !== "notas";

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Rankings" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 lg:mx-0 lg:px-0">
        {ABAS.map((a) => (
          <Pilula key={a.chave} ativo={a.chave === aba} href={href(base, a.chave, ano)}>
            {a.label}
          </Pilula>
        ))}
      </nav>

      {temFiltroDeAno && anos.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <Pilula ativo={!ano} href={href(base, aba)}>
            Geral
          </Pilula>
          {anos.map((y) => (
            <Pilula key={y} ativo={ano === y} href={href(base, aba, y)}>
              {y}
            </Pilula>
          ))}
        </div>
      )}

      {aba === "notas" && (
        <>
          <Banner tom="info">
            A nota é estado atual, não temporada — por isso não tem filtro de ano. Todo mundo começa
            em 5,0, e a variação mostrada é a da última pelada apurada, somando todos os grupos.
          </Banner>
          <HairlineList
            as="ol"
            vazio={
              <EmptyState
                titulo="Ninguém com nota ainda"
                descricao="A nota aparece depois que a primeira pelada for encerrada e avaliada."
              />
            }
          >
            {notas.map((n, i) => (
              <HairlineRow as="li" key={n.playerId} destaque={n.playerId === destaquePlayerId}>
                <Posicao n={posicoes(notas, (x) => x.skill)[i]} />
                <NomeDoJogador apelido={n.nickname} nome={n.name} />
                <NotaVariacao valor={n.variacao} />
                <Nota valor={n.skill} tamanho="lg" className="min-w-[3.5rem] text-right" />
              </HairlineRow>
            ))}
          </HairlineList>
        </>
      )}

      {aba === "artilharia" && (
        <>
          {artilheiros.length >= 3 && (
            <Podium
              itens={artilheiros.slice(0, 3).map((a, i) => ({
                posicao: posicoes(artilheiros, (x) => x.total)[i],
                nome: a.nickname ?? a.name,
                valor: a.total,
              }))}
            />
          )}
          <HairlineList
            as="ol"
            vazio={
              <EmptyState
                titulo="Nenhum gol registrado"
                descricao={
                  ano
                    ? `Ninguém marcou em ${ano} — ou as peladas ainda não foram encerradas.`
                    : "Os gols entram no ranking quando a pelada é encerrada."
                }
              />
            }
          >
            {artilheiros.map((a, i) => (
              <HairlineRow as="li" key={a.playerId} destaque={a.playerId === destaquePlayerId}>
                <Posicao n={posicoes(artilheiros, (x) => x.total)[i]} />
                <NomeDoJogador apelido={a.nickname} nome={a.name} />
                <span
                  className="font-display text-[22px] leading-none font-black font-stretch-125% text-fg"
                  data-num
                >
                  {a.total}
                </span>
                <span className="font-display text-[10px] font-bold tracking-[.1em] text-fg-4 uppercase">
                  {a.total === 1 ? "gol" : "gols"}
                </span>
              </HairlineRow>
            ))}
          </HairlineList>
        </>
      )}

      {aba === "aproveitamento" && (
        <>
          <Banner tom="info">
            Vitória vale 100%, empate 50%. Mínimo de {MIN_JOGOS} jogos para entrar.
          </Banner>
          {records.length === 0 ? (
            <EmptyState
              titulo="Sem jogos suficientes"
              descricao={`Ninguém alcançou ${MIN_JOGOS} jogos${ano ? ` em ${ano}` : ""} ainda.`}
            />
          ) : (
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[19rem] border-collapse text-[13px]">
                <caption className="sr-only">
                  Aproveitamento por jogador{ano ? ` em ${ano}` : ""}
                </caption>
                <thead>
                  <tr className="[&>th]:border-b [&>th]:border-line [&>th]:bg-surface-2 [&>th]:px-2 [&>th]:py-2 [&>th]:font-display [&>th]:text-[9px] [&>th]:font-extrabold [&>th]:tracking-[.12em] [&>th]:text-fg-4 [&>th]:uppercase">
                    <th scope="col" className="text-left">
                      #
                    </th>
                    <th scope="col" className="text-left">
                      Jogador
                    </th>
                    <th scope="col">J</th>
                    <th scope="col">V</th>
                    <th scope="col">E</th>
                    <th scope="col">D</th>
                    <th scope="col" className="text-right">
                      %
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r, i) => (
                    <tr
                      key={r.playerId}
                      className={cx(
                        "[&>td]:border-b [&>td]:border-line-soft [&>td]:px-2 [&>td]:py-2 [&>td]:text-center last:[&>td]:border-0",
                        r.playerId === destaquePlayerId && "bg-accent-tint",
                      )}
                      data-num
                    >
                      <td className="text-left font-display font-extrabold text-fg-4">
                        {posicoes(records, (x) => x.winRate)[i]}º
                      </td>
                      <td className="text-left font-display font-bold text-fg">
                        {r.nickname ?? r.name}
                      </td>
                      <td className="text-fg-2">{r.gamesPlayed}</td>
                      <td className="text-accent-ink">{r.wins}</td>
                      <td className="text-fg-3">{r.draws}</td>
                      <td className="text-danger-ink">{r.losses}</td>
                      <td className="text-right font-display text-[15px] font-black">
                        {(r.winRate * 100).toFixed(0)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}

      {aba === "presenca" && (
        <>
          <Banner tom="info">
            {presenca.totalDays} pelada{presenca.totalDays === 1 ? "" : "s"} encerrada
            {presenca.totalDays === 1 ? "" : "s"}
            {ano ? ` em ${ano}` : ""}.
          </Banner>
          <HairlineList
            as="ol"
            vazio={
              <EmptyState
                titulo="Nenhuma presença registrada"
                descricao="A presença conta a partir da primeira pelada encerrada."
              />
            }
          >
            {presenca.perPlayer.map((p, i) => (
              <HairlineRow as="li" key={p.playerId} destaque={p.playerId === destaquePlayerId}>
                <Posicao n={posicoes(presenca.perPlayer, (x) => x.attended)[i]} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-[14.5px] font-bold text-fg">
                    {p.nickname ?? p.name}
                  </span>
                  <Meter
                    valor={p.attended}
                    total={presenca.totalDays}
                    className="mt-1.5"
                    rotulo={`${p.attended} de ${presenca.totalDays} peladas`}
                  />
                </span>
                <span className="text-right">
                  <span
                    className="block font-display text-[17px] leading-none font-black font-stretch-112% text-fg"
                    data-num
                  >
                    {p.attended}
                  </span>
                  <span className="block font-display text-[10px] font-bold text-fg-4">
                    de {presenca.totalDays}
                  </span>
                </span>
              </HairlineRow>
            ))}
          </HairlineList>
        </>
      )}

      {aba === "notas" && notas.length > 0 && (
        <p className="text-[11.5px] leading-[1.45] text-fg-4">
          <Badge tom="dashed">só quem tem conta ativa</Badge> Quem joga sem conta aparece na
          escalação e na artilharia, mas não recebe nota.
        </p>
      )}
    </div>
  );
}
