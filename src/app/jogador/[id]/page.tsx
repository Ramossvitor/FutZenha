import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { LinkButton } from "@/components/ui/button";
import { CabecalhoDoJogador } from "@/components/ui/cabecalho-do-jogador";
import { Section } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { HairlineList, HairlineRowLink } from "@/components/ui/hairline-list";
import { IconeLuva, IconeSeta } from "@/components/ui/icons";
import { Pilula } from "@/components/ui/pilula";
import { ImagemDoItem } from "@/components/ui/imagem-do-item";
import { StatGrid, StatTile } from "@/components/ui/stat";
import { WhatsAppShareButton } from "@/components/ui/whatsapp-share-button";
import { papelLabel } from "@/lib/grupos-permissions";
import { getJogador } from "@/lib/jogadores";
import { requirePlayer } from "@/lib/require-player";
import { getSession } from "@/lib/session";
import { siteUrl } from "@/lib/site-url";
import { carregarPerfil } from "./dados";

export const dynamic = "force-dynamic";

/**
 * O título repete a checagem de sessão, e não é redundância.
 *
 * `generateMetadata` roda **antes** do corpo da página e não é abortado pelo
 * redirect do `requirePlayer()` de lá: sem este teste, a resposta para quem
 * está deslogado sairia com `<title>Rodrigo — FutZenha</title>` no HTML.
 * Quem varresse os ids montava a lista de nomes da plataforma inteira sem
 * nunca ter feito login. Mesmo buraco que /grupo/[id] documenta.
 */
export async function generateMetadata({ params }: PageProps<"/jogador/[id]">): Promise<Metadata> {
  const generico = { title: "Jogador" };

  const session = await getSession();
  if (!session) return generico;

  const { id } = await params;
  const playerId = Number(id);
  if (!Number.isInteger(playerId)) return generico;

  const jogador = await getJogador(playerId);
  return jogador ? { title: jogador.nickname ?? jogador.name } : generico;
}

/**
 * O perfil público de um jogador — a porta de entrada da parte "comunidade" do
 * FutZenha, e o lugar onde badges, foto e o resto vão morar.
 *
 * Qualquer jogador logado vê o perfil de qualquer outro: os números daqui já
 * são os mesmos dos rankings, e o nome já aparece em toda escalação. O que NÃO
 * entra é o que é do dono: as estrelas recebidas (que o anonimato de
 * src/lib/anonimato.ts protege) e os dados de conta ficam no /perfil.
 */
export default async function JogadorPage({ params, searchParams }: PageProps<"/jogador/[id]">) {
  const session = await requirePlayer();

  const { id } = await params;
  const playerId = Number(id);
  if (!Number.isInteger(playerId)) notFound();

  const { grupo } = await searchParams;
  const dados = await carregarPerfil(
    { playerId: session.player.id, isPlatformAdmin: session.isPlatformAdmin },
    playerId,
    grupo,
  );
  if (!dados) notFound();

  const { jogador, gruposVisiveis, gruposFiltraveis, grupoSelecionado, numeros, vitrine } = dados;
  const comoChamam = jogador.nickname ?? jogador.name;
  const souEu = session.player.id === jogador.id;

  return (
    <div className="flex flex-col gap-7">
      {/* O subtítulo sai sem o @username do /perfil: usuário é credencial de
          login, não cartão de visita. E o rótulo da nota é "nota", e não "sua
          nota" — a mesma nota, vista por outra pessoa. */}
      <CabecalhoDoJogador
        nome={jogador.name}
        apelido={jogador.nickname}
        nota={jogador.skill}
        moldura={vitrine.moldura?.cor}
        corDoNome={vitrine.corDoNome?.cor}
        titulo={vitrine.titulo}
        badges={
          <>
            {jogador.isGoalkeeper ? (
              <Badge tom="warn">
                <IconeLuva className="size-3" />
                goleiro
              </Badge>
            ) : (
              <Badge tom="outline">linha</Badge>
            )}
            {souEu && <Badge tom="accent">você</Badge>}
            {!jogador.active && <Badge tom="danger">fora das listas</Badge>}
            {!jogador.temConta && <Badge tom="dashed">sem conta</Badge>}
          </>
        }
      />

      {/* Linha própria, e não junto dos badges do cabeçalho: os de cima são o
          que o app afirma sobre o jogador (goleiro, sem conta) e estes são o
          que ele comprou. Misturar as duas fileiras faria a loja parecer que
          concede status — e o eyebrow é quem diz, em uma palavra, de onde eles
          vêm. A seção some inteira para quem não comprou nada.

          A ordem é a das VAGAS, escolhida por quem montou a vitrine, e não a de
          compra nem a de preço: a curadoria é o produto aqui. */}
      {vitrine.badges.length > 0 && (
        <Section titulo="Vitrine">
          <div className="flex flex-wrap gap-2">
            {vitrine.badges.map(({ item, destaque }) => (
              <span key={item.id} className="flex flex-col items-center gap-1">
                <ImagemDoItem
                  item={item}
                  tamanho="lg"
                  // O destaque ganha o anel de acento e, para quem não enxerga o
                  // anel, o texto só de leitor de tela: cor sozinha não conta
                  // história em print preto e branco nem para daltônico.
                  className={destaque ? "ring-2 ring-accent-edge" : undefined}
                />
                {destaque && (
                  <span className="eyebrow text-accent-ink">
                    destaque<span className="sr-only"> — aparece ao lado do nome nas listas</span>
                  </span>
                )}
              </span>
            ))}
          </div>
        </Section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <WhatsAppShareButton
          rotulo="Compartilhar perfil"
          texto={`Perfil de ${comoChamam} no FutZenha: ${siteUrl()}/jogador/${jogador.id}`}
        />
        {souEu && (
          <LinkButton variante="ghost" tamanho="sm" href="/perfil">
            Minha área privada
          </LinkButton>
        )}
      </div>

      {!jogador.temConta && (
        <Banner tom="info">
          {comoChamam} joga sem conta: aparece na escalação e nos gols de cada fut, mas os números
          e a nota só acumulam para quem tem conta ativa.
        </Banner>
      )}

      <Section
        titulo="Números"
        acao={<span className="eyebrow">só futs encerrados</span>}
      >
        {/* `gruposFiltraveis`, e não `gruposVisiveis`: a pílula de um grupo que
            o visitante enxerga mas não filtra (público de que ele não
            participa) cairia calada no geral, e um controle que não faz nada é
            pior do que controle nenhum. */}
        {gruposFiltraveis.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <Pilula ativo={!grupoSelecionado} href={`/jogador/${jogador.id}`}>
              Geral
            </Pilula>
            {gruposFiltraveis.map((g) => (
              <Pilula
                key={g.id}
                ativo={grupoSelecionado?.id === g.id}
                href={`/jogador/${jogador.id}?grupo=${g.id}`}
              >
                {g.name}
              </Pilula>
            ))}
          </div>
        )}

        {/* A nota não se move com o filtro, e dizer isso é obrigatório: não
            existe nota por grupo (ver getSkillRanking), então sem a ressalva o
            número gigante ao lado do nome do grupo insinuaria uma. */}
        {grupoSelecionado && (
          <Banner tom="info">
            Os números abaixo são só dos futs de {grupoSelecionado.name} — a nota é sempre geral,
            somando todos os grupos.
          </Banner>
        )}

        <StatGrid>
          <StatTile label="Gols" valor={numeros.gols} />
          <StatTile label="Jogos" valor={numeros.jogos} />
          <StatTile label="Presenças" valor={`${numeros.presencas}/${numeros.totalDays}`} />
          <StatTile
            label="V · E · D"
            valor={`${numeros.vitorias}·${numeros.empates}·${numeros.derrotas}`}
          />
          <StatTile
            label="Aprov."
            valor={
              numeros.aproveitamento === null
                ? "—"
                : `${Math.round(numeros.aproveitamento * 100)}%`
            }
          />
          <StatTile
            label="Artilharia"
            valor={numeros.posicaoArtilharia > 0 ? `${numeros.posicaoArtilharia}º` : "—"}
          />
          {/* MVP só com grupo escolhido: o título é apurado por rodada de
              grupo, e no escopo geral o número não significa nada. */}
          {numeros.titulosMvp !== null && (
            <StatTile
              label="MVP"
              valor={numeros.titulosMvp}
              nota={numeros.titulosMvp === 1 ? "vez" : "vezes"}
            />
          )}
        </StatGrid>
      </Section>

      <Section titulo="Grupos">
        <HairlineList
          as="ul"
          vazio={
            <EmptyState
              titulo="Nenhum grupo por aqui"
              // "por aqui", e nunca "não participa de nenhum": grupo privado de
              // que quem lê não participa foi filtrado, e a frase não pode
              // negar a existência do que ela está escondendo.
              descricao="Os grupos que vocês dois podem ver aparecem nesta lista."
            />
          }
        >
          {gruposVisiveis.map((g) => (
            <li key={g.id}>
              <HairlineRowLink href={`/grupo/${g.id}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-[14px] leading-[1.2] font-bold text-fg">
                    {g.name}
                  </span>
                  <span className="block text-[11.5px] text-fg-4">
                    {g.membros} {g.membros === 1 ? "pessoa" : "pessoas"}
                  </span>
                </span>
                {g.papel !== "member" && <Badge tom="accent">{papelLabel[g.papel]}</Badge>}
                <IconeSeta className="size-4 text-fg-dim" />
              </HairlineRowLink>
            </li>
          ))}
        </HairlineList>
      </Section>
    </div>
  );
}
