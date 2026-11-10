# Opex Care — servidor (login admin e usuários)

Gerencia as contas de quem compra o Opex Care: o administrador cria usuários para a equipe (atendentes e financeiro) e controla o acesso.

## Perfis
| Perfil | Agenda | Clientes | Financeiro | Gerencia usuários |
|---|---|---|---|---|
| admin | ✅ | ✅ | ✅ | ✅ |
| financeiro | ✅ | ✅ | ✅ | — |
| atendente | ✅ | ✅ | — | — |

## Configuração (variáveis de ambiente no Netlify)
- `TOKEN_SECRET`: segredo longo e aleatório para assinar as sessões. **Obrigatório.**
- `ADMIN_LOGIN` e `ADMIN_PASSWORD`: criam o primeiro administrador, só se ainda não existir nenhum.

## Rotas (`/api/admin/...`)
- `POST /login` — `{ login, password }` → `{ token, user }`
- `GET /users` — lista usuários (token de admin)
- `POST /users` — `{ login, password, name, role, unit }`
- `PATCH /users/:id` — `{ role?, name?, unit?, active?, password? }`

Senhas são guardadas com scrypt. Tokens valem 12 horas.

## Testes
```
npm install
npm test
```

## Pendências
- Ligar o login de atendentes à extensão (hoje a extensão ainda valida licença pelo servidor antigo).
- Rotas do financeiro (fluxo de caixa e Google Sheets).
- Publicação: o Netlify precisa estar com a proteção de acesso desligada para o site ser público.
