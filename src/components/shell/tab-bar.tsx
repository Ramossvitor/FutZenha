import type { Session } from "@/lib/session";
import { abas } from "./nav-items";
import { NavLink } from "./nav-link";

/**
 * As abas de baixo, no celular.
 *
 * A altura vai para a variável --tabbar-h no layout, porque telas com botão
 * fixo no rodapé (o "enviar avaliação", por exemplo) precisam saber quanto
 * espaço reservar — senão o botão fica por baixo justamente na hora do toque.
 *
 * O padding de baixo soma a safe-area do iPhone. Não ligamos o
 * `viewport-fit=cover`, então hoje esse valor é zero; a conta fica escrita para
 * o dia em que ligar, sem precisar caçar o lugar.
 */
export function TabBar({ session }: { session: Session | null }) {
  return (
    <nav
      aria-label="Navegação principal"
      className="sticky bottom-0 z-30 flex items-stretch gap-1 border-t border-line bg-nav px-2 pt-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))] lg:hidden"
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
