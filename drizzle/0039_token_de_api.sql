-- O token de API do relógio: três colunas em `users`, e só isso.
--
-- `api_token_hash` guarda o SHA-256 do token — nunca o token. Ele é mostrado
-- uma vez, na geração, e não é recuperável: vazar o banco não vaza credencial.
-- A UNIQUE é a busca (`where hash = $1`) e também a garantia de que um token
-- só aponta para uma conta. As duas datas são o que o perfil mostra: quando
-- foi gerado e quando foi usado pela última vez — a prova de que o Atalho do
-- Apple Watch está chegando ao servidor.
--
-- Nada aqui toca `token_version`, de propósito: trocar o token não pode
-- deslogar o celular, e trocar a senha não mexe no relógio (que não é sessão —
-- quem quer cortá-lo, revoga no perfil). Ver o comentário das colunas em
-- src/db/schema.ts e a leitura em src/lib/sessao-por-token.ts.
ALTER TABLE "users" ADD COLUMN "api_token_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "api_token_criado_em" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "api_token_usado_em" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_api_token_hash_unique" UNIQUE("api_token_hash");