<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Regras do projeto

## Commits

Não faça commits (nem `git commit`, `git push`, `git merge`, `git rebase`) a menos que o usuário peça explicitamente. Ao terminar uma tarefa, deixe as alterações no working tree e apenas relate o que foi alterado.

## Branches

Implementações não devem ser feitas diretamente no branch default (`main`), salvo pedido explícito do usuário. Se a tarefa envolve alterar código e o usuário não disse para trabalhar na `main`:

1. Antes de editar, proponha o nome do branch a ser criado (ex.: `feat/nome-da-tarefa`, `fix/nome-do-bug`).
2. Inclua a criação do branch como primeiro passo do plano.
3. Só comece a implementar depois que o usuário aprovar o plano/branch.
