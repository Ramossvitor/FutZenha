// Service worker do FutZenha. Existe por um único motivo: receber push — o
// registro dele é também o pré-requisito de instalar o app. Nada de cache
// offline aqui de propósito: servir HTML velho de cache é o tipo de bug que
// ninguém consegue reproduzir, e o app é inútil sem rede de qualquer forma.
//
// JS puro, servido de public/ (escopo "/" nativo). O next.config.ts manda
// no-cache para este arquivo — sem isso o browser segura a versão velha por
// até 24h.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  // Payload defensivo: push sem corpo (ou corpo que não é JSON) ainda precisa
  // mostrar ALGO — exibir notificação é obrigação de userVisibleOnly.
  let dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch {
    /* corpo ilegível — usa os defaults */
  }
  event.waitUntil(
    self.registration.showNotification(dados.title || "FutZenha", {
      body: dados.body || "",
      icon: "/icon-192.png",
      badge: "/badge.png",
      data: { href: dados.href || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = (event.notification.data && event.notification.data.href) || "/";
  // Reusa uma janela aberta em vez de empilhar abas — no app instalado só
  // existe uma janela mesmo, e navegar nela é o comportamento esperado.
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((janelas) => {
      const aberta = janelas[0];
      if (aberta) {
        return aberta.focus().then((j) => ("navigate" in j ? j.navigate(href) : undefined));
      }
      return self.clients.openWindow(href);
    }),
  );
});
