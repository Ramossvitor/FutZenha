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
  async headers() {
    return [
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
