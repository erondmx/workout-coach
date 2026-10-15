# FitBurn Coach

Web app de treino (PWA) com coach por LLM (Claude). Node + Express, sem banco: tudo em `/data/db.json`.

## Rodar local

```bash
npm install
APP_PASSWORD=sua-senha OPENROUTER_API_KEY=sk-or-... npm start   # http://localhost:3000
npm test
```

## Deploy na VPS Hostinger (Traefik)

Use `docker-compose.vps.yml` (build direto do GitHub + labels do Traefik) como projeto Docker no hPanel e defina `APP_PASSWORD` e `OPENROUTER_API_KEY` nas variáveis do projeto.

## Deploy genérico (Docker)

1. Copie a pasta para a VPS (git ou `scp -r`), sem `node_modules`/`data`.
2. `cp .env.example .env` e preencha `APP_PASSWORD` e `OPENROUTER_API_KEY`.
3. Descubra como o n8n é exposto (Traefik, Caddy ou nginx) e use o mesmo proxy:
   - **Caddy/nginx no host:** descomente `ports: ["127.0.0.1:3100:3000"]` no compose e aponte
     `treino.seudominio.com` para `127.0.0.1:3100` (Caddy: `treino.seudominio.com { reverse_proxy 127.0.0.1:3100 }`).
   - **Traefik/proxy em rede Docker:** adicione ao serviço a rede externa do proxy
     (`networks: [proxy]` + bloco `networks: proxy: external: true`) e os labels do roteador, como no n8n.
4. Crie o registro DNS (A) do subdomínio para o IP da VPS. **Use HTTPS**: o cookie de sessão vira `Secure` automaticamente atrás do proxy.
5. `docker compose up -d --build`

Backup: o volume `workout_data` (arquivo `db.json`). Atualizar: `git pull && docker compose up -d --build`.

## iPhone

Abra a URL no Safari → Compartilhar → **Adicionar à Tela de Início**. Abre em tela cheia, como app.
Obs.: iOS não vibra pelo navegador; o fim do descanso toca um beep (toque em qualquer botão antes para liberar o áudio).

## Como o coach funciona

`POST /api/coach` envia ao modelo: o plano atual, cargas, progresso de hoje, histórico dos últimos treinos e a conversa.
O modelo responde em texto e pode chamar a ferramenta `update_day`; o servidor valida (ids, séries, descanso)
e só então grava. O plano anterior fica salvo e o botão "Desfazer último ajuste" restaura.
Via OpenRouter, modelo padrão `anthropic/claude-sonnet-5.5` com raciocínio baixo (`COACH_MODEL`, `COACH_REASONING`).
