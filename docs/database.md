# Banco de dados

## Modelo lógico inicial

```text
Organization
  |-- User
  |-- Depot
  |-- Vehicle
  |-- Customer
  |-- ServiceOrder ---- Customer
  |-- RoutePlan ------- Vehicle / User(driver) / Depot
  |       |-- RouteStop ---- ServiceOrder
  |-- OptimizationRun
  |-- AuditLog
```

## Entidades

### `Organization`

Tenant da aplicação. Toda entidade operacional pertence a uma organização.

### `User`

Usuários do sistema. Papéis previstos: proprietário, administrador, operador de tráfego, motorista e consulta.

### `Depot`

Ponto de saída e retorno dos veículos. Uma organização pode ter várias bases, com uma marcada como padrão.

### `Vehicle`

Veículo, placa, capacidade de peso/volume, status e disponibilidade.

### `Customer`

Destinatário/remetente reutilizável em várias ordens.

### `ServiceOrder`

Uma entrega ou coleta. Guarda prioridade, status, data, janela de horário, duração de atendimento, carga, endereço e coordenadas.

### `RoutePlan`

Rota de um veículo em uma data. Possui revisão, status, métricas, polilinha e vínculo opcional com motorista.

### `RouteStop`

Sequência executável da rota. Inclui início/fim no depósito e paradas de atendimento, com horários planejados/reais e métricas por trecho.

### `OptimizationRun`

Registro técnico de cada chamada ao motor de otimização, incluindo provedor, entrada, saída e erro. É essencial para auditoria e diagnóstico.

### `AuditLog`

Registro de ações sensíveis e mudanças de estado.

## Convenções

- IDs em UUID.
- Datas e horas armazenadas em UTC.
- Fuso padrão da interface: `America/Sao_Paulo`.
- Coordenadas em `Decimal(10,7)`.
- Valores de peso/volume em `Decimal`.
- Exclusão de registros operacionais importantes deve ser evitada; use status de cancelamento.
- Índices compostos priorizam `organizationId`, data e status.

## Migrações

Desenvolvimento:

```bash
pnpm db:migrate
```

Produção:

```bash
pnpm db:deploy
```

Nunca use `prisma db push` como processo normal de produção.
