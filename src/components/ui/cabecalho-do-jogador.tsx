import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import type { ItemDaLoja, TokenDeItem } from "@/lib/loja-catalogo";
import { Avatar } from "./avatar";
import { Eyebrow } from "./card";
import { Nota } from "./nota";
import { Selo } from "./selo";
import { CLASSES_DO_TOKEN } from "./tokens-de-item";

/**
 * O cabeçalho de quem é o assunto da tela: avatar, apelido gigante, nome de
 * batismo, os badges de status e a nota.
 *
 * Hoje quem desenha isto é só /jogador/[id]. Mora em `components/ui/` — e não
 * colocado na rota — porque é a vitrine dos quatro slots da loja: é o único
 * lugar em que moldura, cor do nome e título aparecem juntos como o comprador
 * os vê. Quando a prévia do inventário existir, ela tem que ser ESTE
 * componente, não uma cópia: uma prévia que não fosse o desenho de verdade
 * mentiria justamente sobre o que ela existe para mostrar.
 *
 * Sem props de configuração enquanto o consumidor for um só. O rótulo da nota e
 * a linha de baixo foram genéricos por um tempo, para telas que nunca vieram —
 * quando a segunda chegar, ela diz o que precisa variar.
 *
 * O avatar não é opcional aqui de propósito. Ele é o suporte da moldura
 * comprada — sem ele um dos quatro slots da loja não tem onde aparecer.
 *
 * ── Por que o título comprado mora aqui e não no NomeJogador ────────────────
 *
 * O `NomeJogador` desenha a pessoa em ranking, escalação, lista de presença,
 * membros do grupo e MVP — cinco telas com cinco consultas diferentes, nenhuma
 * delas lendo `zenha_equipados`. Aceitar um título lá obrigaria as cinco a
 * carregar o item ou a passar `null`, e o `null` é como as cópias divergiram
 * antes. Título é vaidade de vitrine: aparece onde a pessoa é o assunto, não em
 * toda linha em que o nome dela é citado.
 */
export function CabecalhoDoJogador({
  nome,
  apelido,
  nota,
  badges,
  moldura,
  corDoNome,
  titulo,
  className,
}: {
  nome: string;
  apelido: string | null;
  nota: number;
  /** Os badges de STATUS, montados por quem chama: goleiro, você, sem conta. */
  badges?: ReactNode;
  /** Os três cosméticos que pintam o cabeçalho, quando equipados. */
  moldura?: TokenDeItem | null;
  corDoNome?: TokenDeItem | null;
  titulo?: ItemDaLoja | null;
  className?: string;
}) {
  return (
    <header className={cx("flex items-start gap-3.5", className)}>
      {/* O avatar é de iniciais porque não existe foto no banco — e é aqui que a
          foto entra quando existir, sem mexer no resto da página. */}
      <Avatar nome={nome} tamanho="lg" moldura={moldura} className="mt-1" />
      <div className="min-w-0 flex-1">
        {/* `items-baseline` e `flex-wrap`: o título é texto comprado, de tamanho
            imprevisível, ao lado de um apelido de 28px. Alinhar pelo centro o
            deixaria boiando, e sem quebra ele espremeria o apelido no celular. */}
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1.5">
          <h1
            className={cx(
              "font-display text-[28px] leading-none font-black font-stretch-125% tracking-[-.015em] uppercase",
              // A cor comprada substitui o `text-fg`, não se soma a ele: os
              // sete tokens já passam de 4,5:1 contra as superfícies do app.
              corDoNome ? CLASSES_DO_TOKEN[corDoNome].texto : "text-fg",
            )}
          >
            {apelido ?? nome.split(" ")[0]}
          </h1>
          {titulo && <Selo item={titulo} />}
        </div>
        <p className="mt-1.5 text-[14px] text-fg-2">{nome}</p>
        {badges && <div className="mt-2 flex flex-wrap gap-1.5">{badges}</div>}
      </div>
      <div className="shrink-0 text-right">
        <Eyebrow>nota</Eyebrow>
        <Nota valor={nota} tamanho="hero" className="mt-1 block" />
      </div>
    </header>
  );
}
