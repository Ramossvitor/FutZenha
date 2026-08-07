import type { Metadata, Viewport } from "next";
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
      {/* --tabbar-h é contrato com as telas que têm botão fixo no rodapé: sem
          ele, o "enviar avaliação" fica por baixo das abas justamente na tela em
          que o toque importa. No desktop não há abas, então zera.

          A conta é a altura real da TabBar: 1px de borda + 6 de padding em cima
          + 56 do alvo de toque + 6 embaixo, mais a safe-area, que também entra
          no padding de lá. Medido no browser — chutar 64 deixava o botão 5px
          por baixo da barra. */}
      <body
        className="flex min-h-full flex-col lg:[--tabbar-h:0px]"
        style={
          { "--tabbar-h": "calc(69px + env(safe-area-inset-bottom))" } as React.CSSProperties
        }
      >
        <div className="flex min-h-full flex-1 lg:gap-0">
          <Sidebar session={session} grupo={grupo} naoLidas={naoLidas} />

          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar session={session} grupo={grupo} naoLidas={naoLidas} />
            <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5 lg:px-8 lg:py-8">
              {children}
            </main>
            <TabBar session={session} />
          </div>
        </div>
      </body>
    </html>
  );
}
