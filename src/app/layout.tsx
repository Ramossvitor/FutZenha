import type { Metadata, Viewport } from "next";
import { logout } from "@/app/login/actions";
import { Sidebar } from "@/components/shell/sidebar";
import { TabBar } from "@/components/shell/tab-bar";
import { TopBar } from "@/components/shell/top-bar";
import { getGrupoAtual } from "@/lib/grupo-atual";
import { contarNaoLidas } from "@/lib/notifications";
import { agendarProcessamento } from "@/lib/pendencias";
import { getSession } from "@/lib/session";
import { siteUrl } from "@/lib/site-url";
import { archivo, instrumentSans } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: "FutZenha", template: "%s — FutZenha" },
  description: "A pelada organizada: presença, times, artilharia e rankings.",
  openGraph: {
    title: "FutZenha",
    description: "Confirma presença, vê os times sorteados e acompanha a artilharia da pelada.",
    siteName: "FutZenha",
    locale: "pt_BR",
    type: "website",
  },
};

// Os dois valores para a barra do navegador combinarem com o canvas em cada
// tema — sem isso o topo do Chrome no Android fica branco em cima do app escuro.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4F6F2" },
    { media: "(prefers-color-scheme: dark)", color: "#0B0E0D" },
  ],
};

// Vale para todo segmento abaixo, páginas e Server Actions incluídas.
//
// Não é folga para request lento: é o que garante que o `connect_timeout: 30`
// do src/db/index.ts chegue a disparar. Herdando o default do plano, um compute
// do Neon acordando estoura o teto da função ANTES do driver desistir, e o que
// a pessoa vê é um 504 opaco em vez do src/app/error.tsx — que é justamente a
// tela que sabe dizer "confere antes de repetir".
export const maxDuration = 60;

// Ler a sessão aqui torna todas as páginas dinâmicas por request — escolha
// deliberada para mostrar quem está logado em qualquer página.
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await getSession();
  const [grupo, naoLidas] = await Promise.all([
    getGrupoAtual(),
    session ? contarNaoLidas(session.player.id) : Promise.resolve(0),
  ]);

  // Prazos vencidos são aplicados depois da resposta, no máximo 1× por minuto
  // por instância. O cron diário é só a rede de segurança para quando o site
  // fica sem tráfego.
  agendarProcessamento();

  return (
    <html
      lang="pt-BR"
      className={`${archivo.variable} ${instrumentSans.variable} h-full antialiased`}
    >
      {/* A altura da TabBar sai daqui como --tabbar-h e é o que segura o botão
          fixo do rodapé fora das abas — a declaração e a conta dela estão em
          globals.css, na camada base. */}
      <body className="flex min-h-full flex-col">
        <div className="flex min-h-full flex-1 lg:gap-0">
          <Sidebar session={session} grupo={grupo} naoLidas={naoLidas} aoSair={logout} />

          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar session={session} grupo={grupo} naoLidas={naoLidas} />
            {/* 3xl no celular e no tablet, 5xl a partir do desktop: a tela de
                encerrar tem um trilho de 20rem ao lado do conteúdo, e em 768px
                sobrava menos de 26rem para os dois lados do jogo. */}
            <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5 lg:max-w-5xl lg:px-8 lg:py-8">
              {children}
            </main>
            <TabBar session={session} />
          </div>
        </div>
      </body>
    </html>
  );
}
