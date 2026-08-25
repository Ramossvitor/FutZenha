import { Suspense, type ReactNode } from "react";
import { db } from "@/db";
import { Card, CardBody, CardHeader, Eyebrow } from "@/components/ui/card";
import { HairlineList, HairlineRow } from "@/components/ui/hairline-list";
import { Skeleton } from "@/components/ui/skeleton";
import { cx } from "@/lib/cx";
import { getAjustes } from "@/lib/zenha-config";

// A tabela de ganho da zenha, com os valores VIGENTES.
//
// A leitura acontece no render, e não em constante importada, por um motivo
// específico: estes números são editáveis pelo admin da plataforma (tabela
// zenha_config). Escrevê-los à mão aqui — ou importá-los de zenha.ts, que só
// tem os PADRÕES — faria o guia mentir no dia seguinte ao primeiro ajuste, e
// mentir justamente para quem abriu o guia para conferir quanto vale aparecer.
//
// É o mesmo princípio que já vale para os prazos: corpos.tsx importa
// PRAZO_AVALIACAO_HORAS em vez de escrever "36 horas". Aqui a fonte da verdade
// mora no banco, então a leitura precisa acontecer no render.

/**
 * A fronteira de streaming do guia — e o único `<Suspense>` do app.
 *
 * Ele é a condição para /guia poder ficar FORA do route group que carrega o
 * loading.tsx (o porquê disso está lá, em `(esqueleto)/loading.tsx`): sem
 * boundary nenhum acima, um `await` solto aqui faria o React segurar o
 * documento INTEIRO até o banco responder. O guia é a única página pública de
 * conteúdo do app, aberta por link mandado no grupo e às vezes com o servidor
 * frio — e o que ela mostraria nesse meio tempo seria uma tela em branco, já
 * que o skeleton de página não a cobre mais.
 *
 * Com o `<Suspense>` aqui, a página inteira sai no primeiro flush, com os `id=`
 * de todos os 18 capítulos já com caixa de layout, e só esta tabela chega
 * depois. É o que torna o salto de âncora do Chromium em `/guia#a-nota`
 * determinístico em vez de corrida — ver o teste em e2e/guia.spec.ts.
 *
 * Subir o `await` para a `page.tsx` ou para um `guia/layout.tsx` não substitui
 * isto: quem suspende passa a ser a página, e o documento volta a esperar.
 */
export function ValoresDaZenha() {
  return (
    <Suspense fallback={<Tabela numeros={CARREGANDO} />}>
      <ValoresVigentes />
    </Suspense>
  );
}

async function ValoresVigentes() {
  const ajustes = await getAjustes(db);

  return (
    <Tabela
      numeros={{
        participacao: ajustes.participacao,
        notaPorDecimo: ajustes.nota_por_decimo,
        manterNoTeto: ajustes.manter_no_teto,
        mvp: ajustes.mvp,
        streakTamanho: ajustes.streak_tamanho,
        streakPremio: ajustes.streak_premio,
        minContas: ajustes.min_contas_para_pagar,
        // O plural depende do próprio número, então ele viaja junto: o fallback
        // não tem como saber se escreveria "fut" ou "futs".
        futsPagos: `${ajustes.max_futs_pagos_semana} ${
          ajustes.max_futs_pagos_semana === 1 ? "fut" : "futs"
        }`,
      }}
    />
  );
}

type Numeros = {
  participacao: ReactNode;
  notaPorDecimo: ReactNode;
  manterNoTeto: ReactNode;
  mvp: ReactNode;
  streakTamanho: ReactNode;
  streakPremio: ReactNode;
  minContas: ReactNode;
  futsPagos: ReactNode;
};

/**
 * O molde é UM só, e o fallback o preenche com `Barra` no lugar de cada número.
 *
 * Não é economia de código: o que estraga o salto de âncora não é o conteúdo
 * chegar tarde, é ele chegar com altura diferente da que o fallback reservou.
 * "As zenhas" é o 10º de 18 capítulos — os oito de baixo sobem ou descem junto
 * com a diferença, e `corpos.tsx` linka `#o-multiplicador` de dentro do texto.
 *
 * Com um molde só, a altura bate por construção e não por chute: os rótulos e
 * as notas são literais (nenhum vem do banco) e o fallback os escreve de
 * verdade, a prosa do `<p>` é escrita uma vez para os dois lados, e o que sobra
 * de dinâmico é sempre um número de um a quatro dígitos dentro da própria linha
 * de texto.
 */
function Tabela({ numeros: n }: { numeros: Numeros }) {
  // O `id` existe para ser a key: no fallback o rótulo é um <Barra />, não um
  // texto, então ele não serve para identificar a linha nos dois lados.
  const linhas: { id: string; rotulo: ReactNode; valor: ReactNode; nota: string }[] = [
    {
      id: "participacao",
      rotulo: "Participação",
      valor: n.participacao,
      nota: "por ir ao fut e cumprir a avaliação",
    },
    {
      id: "nota-que-sobe",
      rotulo: "Nota que sobe",
      valor: <>{n.notaPorDecimo} / décimo</>,
      nota: "subir 0,3 paga o triplo de subir 0,1",
    },
    {
      id: "nota-no-teto",
      rotulo: "Nota mantida em 10,0",
      valor: n.manterNoTeto,
      nota: "de lá não há para onde subir",
    },
    {
      id: "mvp",
      rotulo: "Melhor em campo",
      valor: n.mvp,
      nota: "dividido quando o título empata",
    },
    {
      id: "sequencia",
      rotulo: <>{n.streakTamanho} futs seguidos</>,
      valor: n.streakPremio,
      nota: "e a contagem recomeça",
    },
  ];

  return (
    <>
      <Card>
        <CardHeader>
          <Eyebrow>quanto vale hoje</Eyebrow>
        </CardHeader>
        <CardBody>
          <HairlineList as="ul">
            {linhas.map((l) => (
              <li key={l.id}>
                <HairlineRow>
                  <span className="flex-1">
                    <span className="block text-[13.5px] text-fg">{l.rotulo}</span>
                    <span className="block text-[12px] text-fg-4">{l.nota}</span>
                  </span>
                  <span className="font-display text-[14px] font-bold text-fg tabular-nums">
                    {l.valor}
                  </span>
                </HairlineRow>
              </li>
            ))}
          </HairlineList>
        </CardBody>
      </Card>
      {/* As duas condições do fut moram aqui, e não no texto estático do
          capítulo, pelo mesmo motivo da tabela: são ajustes, e um número escrito
          à mão lá mentiria assim que o admin mexesse neles. */}
      <p>
        Um fut só paga se for de grupo, tiver pelo menos{" "}
        <strong className="text-fg">{n.minContas} pessoas com conta</strong> em campo, e acontecer
        depois da estreia da economia. E cada um recebe por no máximo{" "}
        <strong className="text-fg">{n.futsPagos}</strong> por semana — jogar mais é ótimo, mas
        o excedente não paga.
      </p>
    </>
  );
}

// As larguras saem da ordem de grandeza de cada ajuste (os tetos estão em
// zenha.ts): quatro dígitos para o que é preço, um ou dois para o que é
// contagem. Não precisam ser exatas — precisam não mudar a quebra de linha.
const CARREGANDO: Numeros = {
  participacao: <Barra className="w-[3ch]" />,
  notaPorDecimo: <Barra className="w-[2ch]" />,
  manterNoTeto: <Barra className="w-[2ch]" />,
  mvp: <Barra className="w-[3ch]" />,
  streakTamanho: <Barra className="w-[1ch]" />,
  streakPremio: <Barra className="w-[3ch]" />,
  minContas: <Barra className="w-[1ch]" />,
  futsPagos: <Barra className="w-[5ch]" />,
};

/**
 * O número que ainda não chegou, sem mexer na altura da linha que o abriga.
 *
 * `h-[1em]` e não altura fixa: a barra tem que caber DENTRO da linha do texto
 * que substitui, e cada uma delas tem um `text-[…]` diferente. `align-middle`
 * pelo mesmo motivo — na linha de base, uma caixa de 1em sobe mais que o
 * ascendente da fonte e passa a ser ELA quem manda na altura do line box.
 */
function Barra({ className }: { className?: string }) {
  return <Skeleton as="span" className={cx("inline-block h-[1em] align-middle", className)} />;
}
