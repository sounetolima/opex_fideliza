# Opex Fideliza — licenças e painel do administrador

Clone do painel de licenças do Opex Agent, adaptado para o Opex Fideliza (versão Light).

- `/admin`: painel com licenças, pedidos, bloqueio, computadores, senha do cliente e **nome da empresa e logo por cliente**.
- `/api/verify`, `/api/login`, `/api/release`: usados pela extensão. Devolvem a marca (nome e logo) do cliente.
- `/api/order`: pedido vindo do site (fica pendente até o administrador aprovar).

## Variáveis de ambiente (Netlify)
- `TOKEN_SECRET`: segredo longo para assinar a sessão do painel.
- `ADMIN_PASSWORD`: senha do primeiro acesso. Depois que entrar, troque em "Alterar senha".

## Testes
    npm test

## Pastas
- `public/` e `netlify/`: painel de licenças e API (site `opex-care-licencas`).
- `site/`: site de vendas (site `opex-fideliza-site`, diretório base `site`). Gerado por `node tools/build-site.js site`.
- `extension/`: código da extensão do Chrome (versão enviada à Chrome Web Store).
- `public/download/opex-care.zip`: extensão para instalação manual.
