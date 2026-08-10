// Substitui o pacote "server-only" nos testes (ver alias em vitest.config.mts).
// O pacote real lança fora do ambiente react-server; aqui ele vira no-op para
// os módulos de servidor poderem ser importados pelo vitest.
export {};
