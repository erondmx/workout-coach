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

## Regra de progressão de carga (e a base)

O app avalia as **reps feitas em cada série** contra a faixa prescrita (ex.: 12–15) e sugere a carga do próximo treino:

| Pior série do treino | Sugestão |
|---|---|
| Todas as séries no topo da faixa (ou acima) | subir **um degrau** de carga |
| Dentro da faixa | manter e buscar o topo |
| Abaixo da faixa | manter; 2 treinos seguidos → descer um degrau |
| Abaixo de 70% do mínimo da faixa (ex.: 4 reps para 12) | descer um degrau já |

Degrau = salto real da academia: máquina/polia/barra 5 kg; halteres 1 kg (< 10 kg) ou 2 kg.

**O que a literatura sustenta** (e o que não):
- *Dupla progressão* (manter a carga e subir reps até o topo da faixa em todas as séries, então subir a carga) é uma convenção de treinadores, sem estudo que valide esse protocolo específico. Plotkin et al. (2022, PeerJ), 8 semanas em treinados: progredir por carga **ou** por repetições foram estratégias viáveis, sem diferença relevante de hipertrofia. https://peerj.com/articles/14142
- ACSM (2009): aumentar a carga em 2–10% quando o praticante consegue 1–2 reps acima do alvo. Nosso "degrau" é um salto discreto da máquina, não uma porcentagem. https://www.sportgeneeskunde.com/wp-content/uploads/ACSM-Position-Stand-Progression-Models-in-Resistance-Training-for-Healthy-Adults.pdf
- Reps feitas vs. alvo como medida de esforço: a escala RIR (reps em reserva) de Zourdos et al. (2016) e sua aplicação por Helms et al. (2016) usam exatamente a ideia de ajustar a carga pelo quão perto da falha a série ficou. https://pubmed.ncbi.nlm.nih.gov/30747900/ · https://openrepository.aut.ac.nz/items/92cefeac-7c32-44f1-bfbc-f48f4a5dd8cf/full
- Proximidade da falha: meta-análise de Refalo et al. (2023) não achou vantagem relevante de treinar até a falha vs. perto dela para hipertrofia; as séries precisam ser desafiadoras, não necessariamente extremas. https://pmc.ncbi.nlm.nih.gov/articles/PMC9935748
- Estimar RIR de cabeça é impreciso (mais ainda em séries longas), o que reforça usar as reps registradas em vez de "achismo".

**Limites honestos:** os cortes numéricos (70% do mínimo, 2 treinos seguidos, 1 degrau) são decisões de engenharia coerentes com esses princípios, **não** limiares validados em estudo. Ajuste em `lib.js` (`assessSets`/`suggest`) se achar agressivo ou conservador demais. O app não substitui um profissional de educação física.

## Fotos de aparelhos

No chat do coach, o botão de câmera anexa até 4 fotos (reduzidas no celular para ~1024 px). Cada exercício tem o link
"Não achei o aparelho", que abre o chat já indicando qual exercício. O modelo (com visão) descreve o que identificou,
diz se serve e escolhe entre `substitute_today` (só hoje: o card mostra "Hoje, no lugar de…" e esse exercício **não** entra
no histórico de progressão, pois a carga é de outra máquina) ou `update_day` (troca definitiva, com id novo e "Desfazer").
As fotos não são gravadas no servidor (só a contagem no chat) e vão ao provedor do modelo (OpenRouter): evite mostrar rostos.
O reconhecimento de aparelhos por foto pode errar; o coach é instruído a admitir incerteza e a recomendar ler as instruções da máquina.

## Carga por série e semáforo

A carga é registrada **por série**: ao marcar uma série, o app guarda a carga que está no campo naquele momento.
Se você mudar de 30 para 35 kg na 3ª série, fica "30, 30, 35, 35". A avaliação considera só as séries feitas na
**carga final** (as reps com 30 kg não são cobradas dos 35 kg) e avisa a mudança.

Cada exercício mostra um semáforo ao vivo (regras do app, sem LLM): verde = subir (com a carga sugerida e botão Aplicar),
amarelo = manter, vermelho = reduzir. Subir só aparece com todas as séries no topo da faixa ou com reps 2+ acima do topo.
O coach (LLM) recebe reps, cargas por série e o semáforo, e comenta; a decisão de carga é da regra e sua.
