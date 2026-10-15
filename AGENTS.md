# Instruções do projeto

## Desenvolvimento e validação

- O frontend usa Vite. Com `npm run dev` em execução, alterações comuns de interface são atualizadas automaticamente pelo HMR. Não rode `npm run build` depois de cada ajuste visual; use o build quando o usuário pedir validação, antes de preparar uma versão de produção ou quando uma alteração de configuração/dependência exigir essa conferência.
- Builds podem demorar neste ambiente. Para mudanças pequenas, priorize a resposta rápida e informe se o build não foi executado.
- No Compose, o serviço `api` monta `./backend` dentro do container e o Uvicorn monitora `backend/app`. Alterações nos arquivos Python monitorados recarregam a API automaticamente.
- Alterações de schema precisam de migração. Aplique-as com `docker compose exec api alembic upgrade head` enquanto o Compose estiver ativo. Mudanças em dependências Python, Dockerfile ou configuração de build podem exigir reconstruir a imagem da API.
