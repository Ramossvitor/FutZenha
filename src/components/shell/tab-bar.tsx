import type { Session } from "@/lib/session";
import { abas } from "./nav-items";
import { NavLink } from "./nav-link";

/**
 * As abas de baixo, no celular.
 *
 * `fixed`, e não `sticky`, por causa do PWA instalado no iPhone. No WebKit,
 * elemento fixo é camada presa ao viewport, corrigida na thread de scroll
 * inclusive fora do intervalo válido — o bounce do rubber-band. Já o sticky é
 * composto DENTRO da camada que rola, com a correção limitada a esse intervalo:
 * durante o quique o conteúdo continua se movendo e a barra fica pintada onde
 * estava, ou seja, solta no meio da tela por cima dos botões. No Safari cada
 * colapso da barra de URL força um repaint que disfarça isso; em standalone não
 * há barra de URL nenhuma, e o desalinhamento fica. O teclado é a segunda
 * metade: o iOS não encolhe o viewport de layout ao abri-lo, e `fixed` é o que
 * participa do reancoramento ao viewport visual.
 *
 * ARMADILHA: nenhum ancestral desta nav pode ganhar `transform`, `filter`,
 * `backdrop-filter`, `will-change` ou `contain: paint`. Qualquer um deles vira
 * o bloco contentor do `fixed` e traz o bug de volta, pior. Hoje não há nenhum
 * no caminho — quem guarda isso é o e2e/tab-bar.spec.ts.
 *
 * Fora do fluxo, a barra não reserva mais o próprio espaço: a reserva é o
 * `padding-bottom` do <body>, em globals.css, e sai da MESMA --tabbar-h que dá
 * a altura aqui. É a variável que manda nas duas pontas, para não haver como
 * dessincronizar. Telas com botão fixo no rodapé (o "enviar avaliação", por
 * exemplo) descontam essa mesma faixa.
 *
 * O padding de baixo soma a safe-area do iPhone. Não ligamos o
 * `viewport-fit=cover`, então hoje esse valor é zero; a conta fica escrita para
 * o dia em que ligar, sem precisar caçar o lugar.
 */
export function TabBar({ session }: { session: Session | null }) {
  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-0 bottom-0 z-30 flex h-[var(--tabbar-h)] items-stretch gap-1 border-t border-line bg-nav px-2 pt-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))] lg:hidden"
    >
      {abas(session !== null).map((item) => (
        <NavLink
          key={item.href}
          href={item.href}
          label={item.label}
          icone={item.icone}
          exato={item.exato}
          forma="aba"
        />
      ))}
    </nav>
  );
}
