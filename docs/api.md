# API inicial

Prefixo: `/api`

A documentação OpenAPI fica em `/docs` no ambiente local.

## Autenticação

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/auth/login` | Autentica e grava cookie HttpOnly. |
| `POST` | `/auth/logout` | Remove o cookie. |
| `GET` | `/auth/me` | Retorna o usuário autenticado. |

## Saúde

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/health` | Processo e conexão com PostgreSQL. |

## Dashboard

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/dashboard/summary?date=YYYY-MM-DD` | Indicadores operacionais da data. |

## Usuários

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/users` | Lista a equipe da organização. |
| `POST` | `/users` | Cria usuário e função. |
| `PATCH` | `/users/:id` | Atualiza função, senha ou situação. |

## Ordens

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/orders` | Lista com filtros de data, status e busca. |
| `POST` | `/orders` | Cria entrega/coleta e geocodifica quando possível. |
| `GET` | `/orders/:id` | Detalhe. |
| `PATCH` | `/orders/:id` | Atualiza dados/status. |
| `DELETE` | `/orders/:id` | Cancela uma ordem ainda não executada. |

## Veículos

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/vehicles` | Lista a frota. |
| `POST` | `/vehicles` | Cadastra veículo. |
| `PATCH` | `/vehicles/:id` | Atualiza veículo/disponibilidade. |

## Rotas

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/routes?date=YYYY-MM-DD` | Lista rotas da data. |
| `GET` | `/routes/:id` | Detalhe completo. |
| `POST` | `/routes/optimize` | Gera rotas para ordens pendentes. |
| `POST` | `/routes/:id/recalculate` | Reorganiza o trecho restante com urgência. |
| `PATCH` | `/routes/:routeId/stops/:stopId/status` | Atualiza execução de uma parada. |

## Mapas

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/maps/geocode` | Converte endereço em coordenadas. |
