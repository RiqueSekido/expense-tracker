# Primeira versão

Aplicação pessoal local para registrar gastos e acompanhar o total mensal.

## Escopo

- Cadastrar gastos com descrição, valor em reais, data e categoria.
- Listar gastos do mês selecionado, do mais recente ao mais antigo.
- Mostrar o total mensal e quantidade de lançamentos.
- Excluir um gasto com confirmação.
- Exibir estados de carregamento, lista vazia e falhas da API.

## Organização proposta

- `frontend/`: React e TypeScript.
- `backend/`: FastAPI, validações Pydantic e persistência SQLAlchemy.
- PostgreSQL como banco e Alembic para migrações.

Uma requisição segue este caminho: formulário → API → validação → sessão do banco → resposta → atualização da interface.

## Contrato previsto

- `GET /api/health`: disponibilidade da API.
- `POST /api/expenses`: cria um gasto.
- `GET /api/expenses?month=2026-10`: lista gastos do mês.
- `GET /api/expenses/summary?month=2026-10`: total e quantidade do mês.
- `DELETE /api/expenses/{id}`: exclui um gasto.

Valores monetários serão representados por `Decimal` em Python, `NUMERIC` no PostgreSQL e strings decimais no JSON, evitando arredondamentos binários no armazenamento. Datas de gastos não terão horário. O filtro mensal usará início inclusivo e início do próximo mês exclusivo.

## Limites iniciais

A primeira versão será de uso local, com uma única moeda (BRL) e sem autenticação. Antes de publicar para uso online, será necessário implementar login e isolamento dos gastos por usuário. Não serão incluídos cartões, parcelas, recorrências ou integração bancária nesta etapa.

## Verificação prevista

- Testes de validação de valores e datas, filtro mensal, totais e exclusão.
- Verificação de tipos e build do frontend.
- Teste manual do fluxo completo com PostgreSQL.
