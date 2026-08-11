import type { MetadataRoute } from "next";

// O manifest é o que torna o site instalável — pré-requisito do push no iOS
// (que só funciona em app adicionado à Tela de Início) e do CTA de instalação.
// As cores repetem o themeColor do layout: a janela standalone abre no canvas
// escuro em vez de piscar branco.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FutZenha",
    short_name: "FutZenha",
    description: "A pelada organizada: presença, times, artilharia e rankings.",
    start_url: "/",
    display: "standalone",
    background_color: "#0B0E0D",
    theme_color: "#0B0E0D",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
