import { db } from "@/db";
import { Card, CardBody, CardHeader, Eyebrow } from "@/components/ui/card";
import { HairlineList, HairlineRow } from "@/components/ui/hairline-list";
import { getAjustes } from "@/lib/zenha-config";

// A tabela de ganho da zenha, com os valores VIGENTES.
//
// É um componente async, e não um bloco de JSX estático como o resto de
// corpos.tsx, por um motivo específico: estes números são editáveis pelo admin
// da plataforma (tabela zenha_config). Escrevê-los à mão aqui — ou importá-los
// de zenha.ts, que só tem os PADRÕES — faria o guia mentir no dia seguinte ao
// primeiro ajuste, e mentir justamente para quem abriu o guia para conferir
// quanto vale aparecer.
//
// É o mesmo princípio que já vale para os prazos: corpos.tsx importa
// PRAZO_AVALIACAO_HORAS em vez de escrever "36 horas". Aqui a fonte da verdade
// mora no banco, então a leitura precisa acontecer no render.
//
// Funciona porque /guia é Server Component e corpos.tsx não é `"use client"`:
// um elemento async dentro do Record é renderizado no servidor como qualquer
// outro.
export async function ValoresDaZenha() {
  const ajustes = await getAjustes(db);

  const linhas: { rotulo: string; valor: string; nota: string }[] = [
    {
      rotulo: "Participação",
      valor: `${ajustes.participacao}`,
      nota: "por ir ao fut e cumprir a avaliação",
    },
    {
      rotulo: "Nota que sobe",
      valor: `${ajustes.nota_por_decimo} / décimo`,
      nota: "subir 0,3 paga o triplo de subir 0,1",
    },
    {
      rotulo: "Nota mantida em 10,0",
      valor: `${ajustes.manter_no_teto}`,
      nota: "de lá não há para onde subir",
    },
    {
      rotulo: "Melhor em campo",
      valor: `${ajustes.mvp}`,
      nota: "dividido quando o título empata",
    },
    {
      rotulo: `${ajustes.streak_tamanho} futs seguidos`,
      valor: `${ajustes.streak_premio}`,
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
              <li key={l.rotulo}>
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
        <strong className="text-fg">{ajustes.min_contas_para_pagar} pessoas com conta</strong>{" "}
        em campo, e acontecer depois da estreia da economia. E cada um recebe por no máximo{" "}
        <strong className="text-fg">
          {ajustes.max_futs_pagos_semana} {ajustes.max_futs_pagos_semana === 1 ? "fut" : "futs"}
        </strong>{" "}
        por semana — jogar mais é ótimo, mas o excedente não paga.
      </p>
    </>
  );
}
