import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import { Avatar } from "./avatar";
import { Eyebrow } from "./card";
import { ChipDeTitulo } from "./chip-de-titulo";
import { pinturaDoNome } from "./nome-jogador";
import { Nota } from "./nota";

/**
 * O cabeçalho de quem é o assunto da tela: avatar, apelido gigante, nome de
 * batismo, os badges de status e a nota.
 *
 * Hoje quem desenha isto é só /jogador/[slug]. Mora em `components/ui/` — e não
 * colocado na rota — porque é onde os três cosméticos de slot único aparecem
 * juntos como o comprador os vê: moldura no avatar, cor no apelido, título ao
 * lado. Quando a prévia do inventário existir, ela tem que ser ESTE componente,
 * não uma cópia: uma prévia que não fosse o desenho de verdade mentiria
 * justamente sobre o que ela existe para mostrar.
 *
 * Sem props de configuração enquanto o consumidor for um só. O rótulo da nota e
 * a linha de baixo foram genéricos por um tempo, para telas que nunca vieram —
 * quando a segunda chegar, ela diz o que precisa variar.
 *
 * O avatar não é opcional aqui de propósito. Ele é o suporte da moldura
 * comprada — sem ele um dos cosméticos não tem onde aparecer.
 *
 * ── Só o título fica ────────────────────────────────────────────────────────
 *
 * Os três são comprados e param em lugares diferentes, e a diferença é o CUSTO
 * de cada um em largura. O título é texto de tamanho imprevisível: ao lado do
 * nome numa linha de ranking ele empurraria a nota para fora da tela no celular
 * — este cabeçalho é o único lugar onde ele cabe. O badge em destaque é uma
 * imagem de 16px e a cor do nome não ocupa espaço nenhum, então os dois cabem em
 * qualquer linha e viajam com o `NomeJogador` (que os carrega em lote, com
 * `lerCosmeticosDoNome`). A moldura vai junto do avatar, onde quer que ele vá.
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
  /** Os três cosméticos que pintam o cabeçalho, quando equipados. As duas cores em `#rrggbb`. */
  moldura?: string | null;
  corDoNome?: string | null;
  titulo?: { nome: string } | null;
  className?: string;
}) {
  const pintura = pinturaDoNome(corDoNome);
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
          {/* A cor comprada substitui o `text-fg`, não se soma a ele — e é o
              mesmo helper das listas, para o cabeçalho e a linha de ranking não
              divergirem no dia em que a regra da cor mudar. */}
          <h1
            style={pintura.style}
            className={cx(
              "font-display text-[28px] leading-none font-black font-stretch-125% tracking-[-.015em] uppercase",
              pintura.className,
            )}
          >
            {apelido ?? nome.split(" ")[0]}
          </h1>
          {titulo && <ChipDeTitulo nome={titulo.nome} />}
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
