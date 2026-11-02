# Meu controle de gastos

Primeira versão de um sistema pessoal com React, TypeScript, Material UI, FastAPI, SQLAlchemy, Alembic e PostgreSQL.

Permite cadastrar, editar e excluir lançamentos, consultar um mês e acompanhar seu total. Use **Editar** nas tabelas para alterar descrição, valor, data e categoria; o tipo de entrada ou saída e a identificação original do CSV são preservados. A aba de categorias permite criar e renomear categorias; categorias com gastos associados não podem ser excluídas. A interface mostra carregamento, erros e meses sem lançamentos. A moeda é BRL.

## Executar localmente

Pré-requisitos: Docker Desktop com Compose, Node.js 18.20 ou superior e npm. Python 3.12 ou superior é necessário apenas para executar o backend fora do Docker e rodar os testes.

Na raiz, execute:

```powershell
docker compose up --build -d
```

Isso inicia PostgreSQL e API, aplicando migrações pendentes. O código em `backend/app` fica monitorado pelo Uvicorn: ao salvar uma alteração Python, a API reinicia automaticamente. Os dados ficam no volume `postgres_data`. As credenciais do Compose são exclusivamente para desenvolvimento local. O banco do projeto usa a porta 5433 no computador para evitar conflito com o PostgreSQL já instalado na porta 5432.

Após alterar `compose.yaml`, `Dockerfile` ou dependências, recrie a API:

```powershell
docker compose up --build -d api
```

Para aplicar uma nova migração enquanto os serviços estão em execução:

```powershell
docker compose exec api alembic upgrade head
```

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

## Lançamentos e categoria Devendo

Use a categoria **Devendo** nos gastos pessoais pagos com a conta do BB e nas entradas que devolvem esse dinheiro. Não é necessário vincular uma devolução a um gasto específico.

Dentro de Devendo, escolha o tipo **Gasto pessoal** ou **Salário** no cadastro, na edição, na prévia do CSV ou nas partes de um pagamento dividido. A aba Devendo separa dois grupos:

- **Gastos pessoais a devolver:** reúne todos os meses; as saídas menos as devoluções formam o valor a devolver ao BB.
- **Salário a repassar:** mostra os recebimentos e repasses para sua conta pessoal no mês escolhido. Recebimentos menos repasses formam o valor ainda a repassar naquele mês. Esse grupo também pode incluir bolsa ou outros rendimentos próprios que passam pela conta.

Recebimentos e repasses do tipo Salário ficam fora dos números de saídas, devoluções e valor a devolver dos gastos pessoais. Os dois tipos continuam visíveis em Todos os Lançamentos e excluídos dos gastos da rotina. A classificação é manual e não altera a identificação original do CSV.

Na tabela de gastos pessoais de Devendo, use **Ocultar** para retirar uma linha da visualização padrão. A escolha é salva e continua valendo após atualizar a página. Marque **Mostrar ocultos** para consultar essas linhas e usar **Restaurar**. A ocultação não marca dívidas como pagas, não muda os totais e não remove registros de Todos os Lançamentos.

A interface apresenta três tabelas:

- **Devendo:** gastos pessoais de todos os meses e salário a repassar por mês, em grupos separados.
- **Demais lançamentos — mês selecionado:** entradas e saídas do mês sem a categoria Devendo.
- **Todos os lançamentos — mês selecionado:** lista completa para conferência, incluindo Devendo. Os filtros de descrição, tipo e categoria afetam somente esta tabela.

O resumo mensal e o gráfico da rotina usam a categoria para separar os valores de Devendo. O saldo do mês considera todas as entradas e saídas registradas no período, sem representar o saldo bancário acumulado.

### Dividir um pagamento

Use **Dividir** em uma saída para distribuí-la entre duas ou mais categorias. Por exemplo, um aluguel pago por R$ 1.800 pode ser dividido em R$ 1.500 de `Aluguel` e R$ 300 de `Devendo`. A soma das partes precisa ser exatamente igual ao pagamento original. Cada parte aparece nas tabelas com a referência ao mesmo pagamento; o original não é somado novamente, e sua identificação do CSV fica preservada para evitar duplicatas.

Use **Editar divisão** para redistribuir os valores ou adicionar/remover partes. A edição normal de uma parte permite alterar descrição e categoria; valor e data ficam protegidos para manter a soma e a data do pagamento. Ao excluir uma parte, a confirmação informa que o pagamento dividido inteiro será excluído. Uma devolução posterior deve entrar na categoria `Devendo`, como nos demais casos.

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

Esta versão é local e não possui autenticação. Antes de disponibilizar online, implementar login, autorização por usuário e configuração segura de implantação. Edição de gastos, paginação e relatórios por categoria ficam para as próximas versões.

O escopo inicial está em `docs/primeira-versao.md`. O arquivo original `READ.ME` foi preservado.
