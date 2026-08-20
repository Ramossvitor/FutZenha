import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // O domínio se chamava "pelada" e virou "fut". As rotas velhas não podem
  // simplesmente sumir: elas estão gravadas em `notifications.href` de todo
  // aviso já emitido, e correram o mundo em push, e-mail e mensagem de
  // WhatsApp — nenhum UPDATE alcança um link já colado num grupo.
  //
  // Fica em 307 (`permanent: false`) de propósito. O 308 é cacheado pelo
  // browser e pela edge praticamente para sempre: se a troca precisar ser
  // revertida, quem já pegou o 308 fica preso pedindo /futs, e não há conserto
  // do lado do servidor. Não há SEO a preservar (o app é atrás de login), então
  // o único ganho do 308 é latência — dá para colher depois, com o rename
  // assentado.
  async redirects() {
    return [
      // A ESPECÍFICA VEM ANTES DA GENÉRICA: sem esta linha, "/peladas/:path*"
      // mandaria /peladas/nova para /futs/nova, que não existe (a rota nova é
      // /futs/novo, porque "fut" é masculino) — 404 em vez de redirect.
      { source: "/peladas/nova", destination: "/futs/novo", permanent: false },
      // Os dois padrões são necessários: ":path*" não casa o caminho sem
      // sufixo. Mesmo motivo já documentado no matcher do proxy.ts.
      { source: "/peladas", destination: "/futs", permanent: false },
      { source: "/peladas/:path*", destination: "/futs/:path*", permanent: false },
      { source: "/pelada/:id", destination: "/fut/:id", permanent: false },
      { source: "/pelada/:id/:path*", destination: "/fut/:id/:path*", permanent: false },
      { source: "/admin/peladas", destination: "/admin/futs", permanent: false },
    ];
  },
  // O `X-Powered-By: Next.js` não protege nada e diz o que estamos rodando.
  poweredByHeader: false,
  async headers() {
    return [
      {
        // Vale para tudo. O Next aplica TODAS as entradas que casam, então a
        // regra de /sw.js abaixo continua valendo por cima desta.
        source: "/(.*)",
        headers: [
          // Clickjacking. É a falta que mais pesava: sem isto, o app inteiro
          // entra num <iframe> de outro site, e os botões de presença, de
          // exclusão e do painel de admin viram alvo de clique roubado. O
          // `frame-ancestors` do CSP é a versão moderna e o X-Frame-Options
          // cobre o browser que não a implementa — as duas dizem a mesma coisa.
          { key: "X-Frame-Options", value: "DENY" },
          // O navegador para de adivinhar o tipo do que servimos. Importa no
          // .ics de /fut/[id]/agenda.ics, cujo conteúdo é texto livre do
          // usuário: sem nosniff, um corpo que "pareça" HTML pode ser tratado
          // como HTML na mesma origem.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Link de convite e de grupo carregam token na URL e correm no
          // WhatsApp. Sem isto, clicar num link externo a partir de uma dessas
          // páginas mandaria a URL inteira — token incluso — no `Referer`.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Nada aqui usa câmera, microfone nem localização. Declarar isso
          // fecha a porta para o que um script injetado poderia pedir.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          // Dois anos, subdomínios incluídos. A Vercel já serve só HTTPS; o
          // header é o que impede o primeiro request de uma sessão nova sair em
          // claro. `preload` é intencional e tem custo: só volta atrás por
          // remoção na lista, então vale porque o domínio é dedicado ao app.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Content-Security-Policy",
            // `unsafe-inline` em script-src é o preço de não ter nonce ainda: o
            // Next injeta scripts inline de bootstrap, e sem nonce por request
            // (receita em next/dist/docs/01-app/02-guides/content-security-policy.md)
            // não há como listá-los. Isso NÃO torna a CSP inútil aqui — o app
            // não tem `dangerouslySetInnerHTML` nem `eval` em lugar nenhum, e o
            // que esta política fecha é outra coisa: script de origem externa,
            // <base> forjada, <object>/<embed>, envio de formulário para fora e
            // enquadramento em iframe.
            //
            // `connect-src 'self'` basta: as duas chamadas externas do projeto
            // (Resend e Google OAuth) saem do SERVIDOR, nunca do browser.
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "connect-src 'self'",
              // O manifest e o service worker são nossos, servidos de /public.
              "manifest-src 'self'",
              "worker-src 'self'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              "upgrade-insecure-requests",
            ].join("; "),
          },
        ],
      },
      {
        // O browser respeita Cache-Control no service worker: com o default de
        // public/ ele seguraria o sw.js velho por até 24h, e um push handler
        // corrigido só chegaria no dia seguinte. No-cache força revalidar a
        // cada registro.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
