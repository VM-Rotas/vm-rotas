# Frontend

## Organização

O frontend está em `apps/web` e usa Next.js com App Router.

```text
apps/web/
├── app/
│   ├── (protected)/
│   │   ├── dashboard/          # indicadores do dia
│   │   ├── orders/             # entregas e coletas
│   │   ├── routes/             # otimização, mapa e execução
│   │   ├── team/               # usuários e permissões
│   │   └── vehicles/           # frota
│   ├── login/
│   ├── globals.css
│   └── layout.tsx
├── components/                 # shell, mapa, badges e componentes visuais
├── lib/                        # cliente REST, formatação e tipos
└── public/
```

## Fluxos disponíveis

- Login e logout.
- Painel por data operacional.
- Cadastro, busca, filtro e cancelamento de ordens.
- Cadastro e disponibilidade da frota.
- Geração de rotas em modo local ou Google.
- Mapa real quando a chave do navegador está configurada.
- Visualização alternativa do roteiro quando o mapa não está configurado.
- Avanço do status das paradas.
- Inclusão de urgência e recálculo do trecho restante.
- Administração de equipe para proprietários e administradores.

## Responsividade

A navegação lateral vira menu móvel abaixo de 900 px. Tabelas se transformam em cartões em telas pequenas, e o detalhe da rota empilha mapa e paradas. O mesmo código atende computador e celular pelo navegador.

## Sessão

O navegador não guarda o JWT em `localStorage`. Todas as chamadas usam `credentials: include`, e a API mantém a sessão em cookie HttpOnly. Para produção, frontend e API devem usar HTTPS e preferencialmente subdomínios do mesmo domínio principal, por exemplo:

- `rotas.empresa.com.br`
- `api.rotas.empresa.com.br`
