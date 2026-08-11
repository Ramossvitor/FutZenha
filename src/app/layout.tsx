import type { Metadata, Viewport } from "next";
import { trocarGrupo } from "@/app/grupos/actions";
import { logout } from "@/app/login/actions";
import { PainelDeGrupo } from "@/components/shell/painel-de-grupo";
import { marcarCtaPwaClicado, marcarPwaInstalado } from "@/app/pwa/actions";
import { CtaInstalarIos } from "@/components/push/cta-instalar-ios";
import { DetectorStandalone } from "@/components/push/detector-standalone";
import { RegistrarSw } from "@/components/push/registrar-sw";
import { Sidebar } from "@/components/shell/sidebar";
import { TabBar } from "@/components/shell/tab-bar";
import { TopBar } from "@/components/shell/top-bar";
import { CamadaDeComemoracao } from "@/components/ui/comemoracao";
import { getGrupoAtual } from "@/lib/grupo-atual";
import { listarGruposDoSeletor } from "@/lib/grupos";
import { getMovimento } from "@/lib/movimento";
import { contarNaoLidas } from "@/lib/notifications";
import { agendarProcessamento } from "@/lib/pendencias";
import { agendarDespachoDePush } from "@/lib/push-envio";
import { getSession } from "@/lib/session";
import { siteUrl } from "@/lib/site-url";
import { archivo, instrumentSans } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: "FutZenha", template: "%s — FutZenha" },
  description: "O fut organizado: presença, times, artilharia e rankings.",
  openGraph: {
    title: "FutZenha",
    description: "Confirma presença, vê os times sorteados e acompanha a artilharia do fut.",
    siteName: "FutZenha",
    locale: "pt_BR",
    type: "website",
  },
};

// Os dois valores para a barra do navegador combinarem com o canvas em cada
// tema — sem isso o topo do Chrome no Android fica branco em cima do app escuro.
//
// Duas chaves que ESTA versão do Next aceita e que estão de fora de propósito
// (ver o tipo em next/dist/lib/metadata/types/extra-types.d.ts e a doc em
// next/dist/docs/01-app/03-api-reference/04-functions/generate-viewport.md):
//
// - `viewportFit: "cover"` — o env(safe-area-inset-*) do tab-bar.tsx já está
//   escrito esperando por ele, mas ligar aqui é escopo próprio: o conteúdo
//   passa a correr sob a status bar (TopBar precisaria de inset no topo) e, em
//   landscape no iPhone, sob o notch — pegaria o px-4 do <main>, as sangrias
//   `-mx-4` do rating-form e dos rankings, e o px-2 da própria nav. É auditoria
//   de safe-area em todas as páginas, não uma linha.
// - `interactiveWidget` — só o Chromium implementa; o WebKit ignora. Não faria
//   nada pelo iOS, e mudaria o comportamento do teclado no Android, onde nada
//   está quebrado.
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
  // A lista do seletor entra aqui porque é aqui que o painel dela mora, e em
  // paralelo com o resto porque isto roda em TODA navegação: em série somaria
  // um round-trip ao caminho crítico de cada uma.
  const [grupo, naoLidas, grupos, movimento] = await Promise.all([
    getGrupoAtual(),
    session ? contarNaoLidas(session.player.id) : Promise.resolve(0),
    session ? listarGruposDoSeletor(session.player.id) : Promise.resolve([]),
    getMovimento(),
  ]);
  const temSeletor = grupos.length > 0;

  // Prazos vencidos são aplicados depois da resposta, no máximo 1× por minuto
  // por instância. O cron diário é só a rede de segurança para quando o site
  // fica sem tráfego.
  agendarProcessamento();
  // Push pendente sai no mesmo esquema — e as actions sensíveis a tempo furam
  // o throttle com agendarDespachoDePush(true).
  agendarDespachoDePush();

  return (
    <html
      lang="pt-BR"
      // Vem do cookie, no servidor, e não de um efeito no cliente: com o valor
      // chegando depois do primeiro paint, quem desligou as animações veria
      // justamente um frame delas antes de sumirem. Quem resolve o atributo em
      // `--mov` é o globals.css.
      data-motion={movimento}
      className={`${archivo.variable} ${instrumentSans.variable} h-full antialiased`}
    >
      {/* A TabBar é `fixed` e não ocupa espaço no fluxo: o que reserva a faixa
          dela é o `padding-bottom` do <body>, que sai da mesma --tabbar-h que
          dá a altura da nav e que os rodapés fixos descontam. A variável, a
          conta e a reserva estão em globals.css, na camada base. */}
      <body className="flex min-h-full flex-col">
        <div className="flex min-h-full flex-1 lg:gap-0">
          <Sidebar
            session={session}
            grupo={grupo}
            temSeletor={temSeletor}
            naoLidas={naoLidas}
            aoSair={logout}
          />

          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar
              session={session}
              grupo={grupo}
              temSeletor={temSeletor}
              naoLidas={naoLidas}
            />
            {/* 3xl no celular e no tablet, 5xl a partir do desktop: a tela de
                encerrar tem um trilho de 20rem ao lado do conteúdo, e em 768px
                sobrava menos de 26rem para os dois lados do jogo. */}
            <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5 lg:max-w-5xl lg:px-8 lg:py-8">
              {children}
            </main>
            {/* Entre o conteúdo e as abas: gruda logo acima da faixa que a
                TabBar cobre (via --tabbar-h) — o lugar mais visto do app sem
                roubar o topo. */}
            {session && (
              <CtaInstalarIos
                instalado={session.pwaInstaladoEm !== null}
                aoRegistrarClique={marcarCtaPwaClicado}
              />
            )}
            <TabBar session={session} />
          </div>
        </div>

        {/* Fora do <aside> e do <header> de propósito: os dois somem por
            `display:none` no breakpoint, e popover em subárvore não renderizada
            não abre. No fim do <body> ele também vem depois dos dois chips na
            ordem do documento, que é o que o anchor positioning exige da âncora.
            Não mexe no flex daqui: fechado é `display:none`, aberto vai para o
            top layer. */}
        {temSeletor && (
          <PainelDeGrupo grupo={grupo} grupos={grupos} aoTrocarGrupo={trocarGrupo} />
        )}

        {/* Filha direta do <body>, e FORA do <div> lá de cima, de propósito: a
            camada se centraliza com um `transform`, e a TabBar é `fixed` dentro
            daquele <div>. Ancestral com transform vira bloco contentor do fixed
            e traz de volta o bug do quique no iOS — ver o comentário do
            tab-bar.tsx. Aqui, o único ancestral comum das duas é o <body>. */}
        <CamadaDeComemoracao />

        <RegistrarSw />
        {session && (
          <DetectorStandalone
            jaMarcado={session.pwaInstaladoEm !== null}
            aoDetectar={marcarPwaInstalado}
          />
        )}
      </body>
    </html>
  );
}
