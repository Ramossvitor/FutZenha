import type { ReactNode } from "react";
import { desc, eq } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { Banner, BannerDaQuery } from "@/components/ui/banner";
import { SubmitButton } from "@/components/ui/button";
import { Card, CardBody, PageHeader, Section } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select } from "@/components/ui/field";
import { HairlineList, HairlineRow } from "@/components/ui/hairline-list";
import { db } from "@/db";
import { players, zenhaConfig } from "@/db/schema";
import {
  CATALOGO,
  ID_DO_MULTIPLICADOR,
  chaveDePreco,
  itemDaChaveDePreco,
  itensAVenda,
  precoVigente,
} from "@/lib/loja-catalogo";
import { requirePlatformAdmin } from "@/lib/require-platform-admin";
import { AJUSTES, CHAVES_DE_AJUSTE, comSobrescritas, ehChaveDeAjuste } from "@/lib/zenha";
import { lerSobrescritas } from "@/lib/zenha-config";
import { salvarAjustes } from "./actions";

export const metadata = { title: "Zenhas" };

const LOCAIS = {
  "ajuste-recusado":
    "Um dos valores não foi aceito e NADA foi salvo — nem os outros campos da seção. Confira o campo destacado e envie de novo.",
};

/** Como cada prateleira se chama no campo de preço. */
const ROTULO_DO_SLOT = {
  badge: "Badge",
  moldura: "Moldura",
  cor_do_nome: "Cor do nome",
  titulo: "Título",
} as const;

export default async function AdminZenhasPage({ searchParams }: PageProps<"/admin/zenhas">) {
  await requirePlatformAdmin();
  const { erro, ok, campo } = await searchParams;
  // A chave do campo recusado volta pela query para a tela poder destacá-lo. O
  // texto do erro NÃO volta por lá: mensagem é sempre slug (ver mensagens.ts).
  const recusado = typeof campo === "string" ? campo : null;

  const [sobrescritas, auditoria] = await Promise.all([
    lerSobrescritas(db),
    // A segunda consulta existe porque `lerSobrescritas` devolve só chave e
    // valor — que é tudo de que a economia precisa. Quem alterou e quando é
    // assunto desta tela e de mais ninguém, então a leitura das colunas de
    // auditoria fica aqui em vez de engordar a API que o motor consome.
    db
      .select({
        chave: zenhaConfig.chave,
        valor: zenhaConfig.valor,
        atualizadoEm: zenhaConfig.atualizadoEm,
        quem: players.name,
      })
      .from(zenhaConfig)
      .leftJoin(players, eq(zenhaConfig.atualizadoPorPlayerId, players.id))
      .orderBy(desc(zenhaConfig.atualizadoEm)),
  ]);
  const ajustes = comSobrescritas(sobrescritas);
  const aVenda = itensAVenda().filter((item) => item.id !== ID_DO_MULTIPLICADOR);

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        titulo="Zenhas"
        descricao="Quanto cada coisa paga e quanto cada item custa. Os valores valem para a plataforma inteira."
      />

      <BannerDaQuery erro={erro} ok={ok} locais={LOCAIS} />

      {/* A garantia central do desenho, e por isso a primeira coisa da tela:
          quem mexe nestes números precisa saber o que eles NÃO fazem. Não existe
          reprocessamento a rodar — o ledger é append-only e o preço pago fica
          congelado no inventário —, e é justamente essa ausência que torna este
          painel seguro de usar. */}
      <Banner tom="aviso">
        Mudança vale <strong>dali para frente</strong>. Nada do que já foi pago é recalculado, o
        preço de quem já comprou continua sendo o da compra, e o multiplicador já comprado mantém o
        fator da época.
      </Banner>

      <form action={salvarAjustes}>
        <Section titulo="Ganhos e regras">
          <Card>
            <CardBody className="flex flex-col gap-5">
              <div className="grid gap-4 sm:grid-cols-2">
                {CHAVES_DE_AJUSTE.map((chave) => {
                  const def = AJUSTES[chave];
                  return (
                    <CampoDeNumero
                      key={chave}
                      chave={chave}
                      rotulo={def.rotulo}
                      ajuda={def.descricao}
                      vigente={ajustes[chave]}
                      padrao={def.padrao}
                      valores={def.valores}
                      aceita={
                        def.valores
                          ? `Aceita ${def.valores.join(", ")}.`
                          : `Aceita de ${def.min} a ${def.max}.`
                      }
                      recusado={recusado === chave}
                    />
                  );
                })}
              </div>
              <SubmitButton className="self-start" labelPending="Salvando…">
                Salvar ganhos e regras
              </SubmitButton>
            </CardBody>
          </Card>
        </Section>
      </form>

      {/* Formulário separado, e não um só para a tela inteira: cada botão salva
          o que está à vista dele. Com um formulário único, mexer num prêmio
          reenviaria de quebra os vinte e quatro preços da loja — e um valor
          recusado lá embaixo derrubaria a alteração que o admin veio fazer. */}
      <form action={salvarAjustes}>
        <Section titulo="Preços da loja">
          <Card>
            <CardBody className="flex flex-col gap-5">
              <p className="text-[13px] leading-[1.5] text-fg-3">
                O multiplicador de nota não está nesta lista: o preço dele é o primeiro degrau da
                escada sobre <strong className="text-fg">Preço do multiplicador</strong>, ali em
                cima. Um campo aqui seria um segundo lugar para o mesmo número — e o daqui não
                cobraria nada.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                {aVenda.map((item) => (
                  <CampoDeNumero
                    key={item.id}
                    chave={chaveDePreco(item.id)}
                    rotulo={item.nome}
                    ajuda={item.slot ? ROTULO_DO_SLOT[item.slot] : "Consumível"}
                    vigente={precoVigente(item.id, sobrescritas)}
                    padrao={item.preco}
                    recusado={recusado === chaveDePreco(item.id)}
                  />
                ))}
              </div>
              <SubmitButton className="self-start" labelPending="Salvando…">
                Salvar preços
              </SubmitButton>
            </CardBody>
          </Card>
        </Section>
      </form>

      <Section
        titulo="Sobrescrito hoje"
        acao={
          <span className="font-display text-[11px] font-bold tracking-[.08em] text-fg-4 uppercase">
            {auditoria.length}
          </span>
        }
      >
        <p className="text-[12.5px] leading-[1.45] text-fg-3">
          Só o que saiu do padrão aparece aqui — chave sem linha vale o número do código, e é assim
          que ela acompanha sozinha uma mudança futura.
        </p>
        <HairlineList
          as="ul"
          vazio={
            <EmptyState
              titulo="Tudo no padrão"
              descricao="Ninguém mexeu em nenhum valor da economia até agora."
            />
          }
        >
          {auditoria.map((linha) => (
            <HairlineRow as="li" key={linha.chave}>
              <span className="min-w-0 flex-1 font-display text-[14px] font-bold text-fg">
                {rotuloDaChave(linha.chave)}
              </span>
              <Badge tom="accent">{linha.valor}</Badge>
              <span className="text-[12.5px] text-fg-4">
                padrão {padraoDaChave(linha.chave) ?? "—"}
              </span>
              <span className="text-[12.5px] text-fg-3">
                {linha.quem ?? "conta removida"} ·{" "}
                {linha.atualizadoEm.toLocaleDateString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "2-digit",
                })}
              </span>
            </HairlineRow>
          ))}
        </HairlineList>
      </Section>
    </div>
  );
}

/**
 * Um número da economia, com o vigente escrito e o padrão de placeholder.
 *
 * A caixa "voltar ao padrão" existe porque apagar a sobrescrita não é digitar
 * um número — é apagar a linha. Ela também é o único lugar da tela que mostra
 * QUAL é o padrão sem o admin ter de esvaziar o campo para descobrir.
 */
function CampoDeNumero({
  chave,
  rotulo,
  ajuda,
  vigente,
  padrao,
  valores,
  aceita,
  recusado,
}: {
  chave: string;
  rotulo: string;
  ajuda: ReactNode;
  vigente: number;
  padrao: number;
  /** Quando o ajuste só aceita uma lista fechada — hoje, o fator. */
  valores?: readonly number[];
  /**
   * A faixa do campo, escrita. Aparece só na recusa, e é o que o admin precisa
   * ver ali — o `erro` do Field toma o lugar da `ajuda`, então sem isto a
   * mensagem diria que o número não serve sem dizer qual serviria. Sai da
   * definição do ajuste, não de um texto à mão.
   */
  aceita?: string;
  recusado: boolean;
}) {
  const id = `campo-${chave}`;
  return (
    <Field
      htmlFor={id}
      label={rotulo}
      ajuda={ajuda}
      erro={recusado ? `Este valor não foi aceito. ${aceita ?? ""}`.trim() : undefined}
    >
      <div className="flex flex-col gap-1.5">
        {valores ? (
          <Select
            id={id}
            name={chave}
            defaultValue={String(vigente)}
            aria-invalid={recusado || undefined}
          >
            {valores.map((v) => (
              <option key={v} value={v}>
                {v}%
              </option>
            ))}
          </Select>
        ) : (
          <Input
            id={id}
            name={chave}
            type="number"
            inputMode="numeric"
            step={1}
            defaultValue={vigente}
            placeholder={String(padrao)}
            aria-invalid={recusado || undefined}
          />
        )}
        <label className="flex items-center gap-2 text-[12px] text-fg-4">
          <input
            type="checkbox"
            name={`padrao:${chave}`}
            className="size-4 accent-[var(--accent)]"
          />
          Voltar ao padrão ({padrao})
        </label>
      </div>
    </Field>
  );
}

/**
 * O nome de uma chave gravada.
 *
 * Devolve a chave crua no caso que não deveria existir e existe: a linha órfã de
 * um ajuste que saiu do código ou de um preço reorganizado. `salvarAjuste` já
 * ignora chave desconhecida na escrita e a leitura descarta o valor — mostrá-la
 * aqui é o que dá ao admin como perceber a sujeira e limpá-la.
 */
function rotuloDaChave(chave: string): string {
  if (ehChaveDeAjuste(chave)) return AJUSTES[chave].rotulo;
  const item = itemDaChaveDePreco(chave);
  return item ? `Preço · ${CATALOGO[item].nome}` : chave;
}

function padraoDaChave(chave: string): number | null {
  if (ehChaveDeAjuste(chave)) return AJUSTES[chave].padrao;
  const item = itemDaChaveDePreco(chave);
  return item ? CATALOGO[item].preco : null;
}
