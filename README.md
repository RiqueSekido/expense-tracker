# Meu controle de gastos

Primeira versão de um sistema pessoal com React, TypeScript, Material UI, FastAPI, SQLAlchemy, Alembic e PostgreSQL.

Permite cadastrar e excluir gastos, consultar um mês e acompanhar seu total. A interface mostra carregamento, erros e meses sem lançamentos. A moeda é BRL.

## Executar localmente

Pré-requisitos: Docker Desktop com Compose, Node.js 18.20 ou superior e npm. Python 3.12 ou superior é necessário apenas para executar o backend fora do Docker e rodar os testes.

Na raiz, execute:

```powershell
docker compose up --build -d
```

Isso inicia PostgreSQL e API, aplicando a migração inicial. Os dados ficam no volume `postgres_data`. As credenciais do Compose são exclusivamente para desenvolvimento local. O banco do projeto usa a porta 5433 no computador para evitar conflito com o PostgreSQL já instalado na porta 5432.

Em outro terminal:

```powershell
cd frontend
npm install
npm run dev
```

Abra http://localhost:5173. A documentação interativa da API está em http://localhost:8050/docs.

Para parar os serviços sem apagar os dados:

```powershell
docker compose down
```

## Backend fora do Docker

Com um PostgreSQL disponível:

```powershell
cd backend
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
$env:DATABASE_URL = 'postgresql+psycopg://expenses:expenses@localhost:5433/expenses'
.\.venv\Scripts\alembic.exe upgrade head
.\.venv\Scripts\uvicorn.exe app.main:app --reload --env-file .env
```

Se usar `--env-file .env`, copie primeiro `.env.example` para `.env`. A configuração do Alembic lê variáveis do ambiente; para uma conexão diferente, defina `DATABASE_URL` no terminal antes da migração. O endereço padrão é o mostrado acima.

## Verificar

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q
```

Os testes usam SQLite em memória, substituindo a dependência de sessão do banco. Eles verificam validação, precisão dos totais, filtro mensal, passagem de ano e exclusão. O comportamento específico do PostgreSQL deve ser conferido também com o Compose.

```powershell
cd frontend
npm run build
```

Esse comando verifica os tipos e gera a versão de produção da interface.

Teste manual: registre `0,10` e `0,20` no mesmo mês, confira o total `R$ 0,30`, mude de mês e exclua um lançamento. Atualize a página para confirmar a persistência.

## Como o projeto funciona

- `frontend/src/App.tsx`: formulário, filtro mensal e estados da interface.
- `frontend/src/api.ts`: contrato TypeScript e requisições HTTP.
- `backend/app/schemas.py`: validação de entrada e formato das respostas.
- `backend/app/main.py`: endpoints e consultas.
- `backend/app/database.py`: sessão SQLAlchemy entregue às rotas por `Depends`.
- `backend/migrations/`: histórico versionado da estrutura do banco.

Dinheiro usa `Decimal` no Python e `NUMERIC(12, 2)` no banco. Na API, valores são strings decimais; a interface converte apenas para apresentação. Totais são calculados pelo banco.

As rotas usam `def` com acesso síncrono ao banco. O efeito React carrega os dados ao mudar o mês e cancela requisições anteriores para evitar resultados de um mês substituírem os de outro.

## Próximas etapas

Esta versão é local e não possui autenticação. Antes de disponibilizar online, implementar login, autorização por usuário e configuração segura de implantação. Edição de gastos, categorias personalizadas, paginação e relatórios por categoria ficam para as próximas versões.

O escopo inicial está em `docs/primeira-versao.md`. O arquivo original `READ.ME` foi preservado.
