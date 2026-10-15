import { sanitizeDay, sanitizeSwap, computeHints, computeAssess, DAYS } from './lib.js';

export const MODEL = process.env.COACH_MODEL || 'anthropic/claude-sonnet-5.5';
const EFFORT = process.env.COACH_REASONING || 'low';
const BASE_URL = (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');

const SYSTEM = `Você é o coach pessoal de musculação do usuário, falando em português do Brasil, de forma direta, motivadora e curta (no máximo uns 6 linhas, sem enrolação).
Objetivo do usuário: emagrecimento e definição, treino em 3 dias (A empurrar, B puxar, C pernas), academia comum.

Regras:
- O usuário relata o que fez, dificuldades, dores, falta de tempo ou equipamento. Responda ao relato e, quando fizer sentido, AJUSTE o plano usando a ferramenta update_day. Só ajuste quando houver motivo claro; não mexa no plano a troco de nada.
- Ajustes típicos: subir/baixar séries ou repetições (progressão), trocar exercício por dor/indisponibilidade, mudar descanso, encurtar treino por falta de tempo, mudar cardio.
- Dor aguda, tontura, dor no peito ou lesão: oriente a parar e procurar um profissional de saúde; não prescreva treino para tratar lesão. Nada de dieta restritiva extrema ou suplemento/medicação.
- Ao chamar update_day, envie o dia COMPLETO (todos os exercícios). Mantenha o mesmo id dos exercícios que permanecem (assim a carga registrada é preservada) e crie ids novos curtos (ex.: a9) só para exercícios novos.
- "rest" é só número de segundos (ex.: "60"). Exercícios de cardio usam isCardio=true e sets=1. Informe equip (machine/dumbbell/barbell) nos exercícios de força.
- Explique no texto, em 1-2 frases, o que mudou e por quê.
- FOTOS DE APARELHOS: o usuário pode mandar fotos da academia (e dizer qual exercício não achou, com o id). Descreva em 1 frase o que você identificou e quão seguro está; se a foto não permitir identificar, peça outra mais de perto ou o nome na placa, e NUNCA invente. Diga se o aparelho serve para o exercício/grupo muscular e como usar de forma resumida. Para trocar só por hoje (padrão, se o usuário não disse que é definitivo), use substitute_today; se ele pedir para trocar "para sempre", use update_day com um id NOVO para o exercício trocado (assim a carga do aparelho antigo não se mistura). Mantenha o mesmo grupo muscular e séries/reps parecidas. Lembre de ler as instruções do aparelho, começar leve e pedir ajuda a um instrutor se não souber usar. Não comente sobre pessoas que apareçam nas fotos.
- Use o histórico (séries, cargas, repetições feitas em cada série) para decidir progressão.
- O app já mostra na tela uma dica automática de carga por exercício (dupla progressão: todas as séries no topo da faixa de reps → subir um degrau; pior série abaixo de 70% do mínimo da faixa → descer um degrau; abaixo da faixa → manter, 2x seguidas → descer; dentro da faixa → manter e buscar o topo). Pesos reais da academia: máquinas e barra variam de 5 em 5 kg, halteres de 1 a 2 kg (nunca sugira cargas quebradas tipo 32,5 kg). Veja "SUGESTÕES AUTOMÁTICAS" abaixo e NÃO contradiga essas dicas sem motivo; mudanças de carga ficam por conta do usuário, você ajusta séries, repetições, exercícios e descanso.`;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'substitute_today',
      description: 'Substitui um exercício do plano por outro aparelho/movimento SÓ NO TREINO DE HOJE (o plano não muda).',
      parameters: {
        type: 'object',
        properties: {
          exercise_id: { type: 'string', description: 'id do exercício do plano a substituir' },
          name: { type: 'string', description: 'nome do exercício/aparelho substituto' },
          equip: { type: 'string', enum: ['machine', 'dumbbell', 'barbell'] },
          reason: { type: 'string' },
        },
        required: ['exercise_id', 'name', 'reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_day',
      description: 'Substitui o plano completo de um dia de treino (A, B ou C). Pode ser chamada uma vez por dia afetado.',
      parameters: {
        type: 'object',
        properties: {
          day: { type: 'string', enum: DAYS },
          title: { type: 'string' },
          desc: { type: 'string', description: 'Dica curta do dia' },
          reason: { type: 'string', description: 'Motivo do ajuste, em uma frase' },
          exercises: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                sets: { type: 'integer' },
                reps: { type: 'string' },
                rest: { type: 'string', description: 'segundos, ex.: "60"' },
                isCardio: { type: 'boolean' },
              equip: { type: 'string', enum: ['machine', 'dumbbell', 'barbell'], description: 'machine = máquina/polia (pesos de 5 em 5 kg); dumbbell = halteres; barbell = barra/Smith' },
              },
              required: ['id', 'name', 'sets', 'reps'],
            },
          },
        },
        required: ['day', 'exercises', 'reason'],
      },
    },
  },
];

function context(db) {
  const recent = db.history.slice(-8);
  const hints = Object.fromEntries(Object.entries(computeHints(db)).map(([id, h]) => [id, h.text]));
  const today = { séries: db.progress.sets, repsPorSerie: db.progress.setReps || {}, avaliação: Object.fromEntries(Object.entries(computeAssess(db)).map(([id, a]) => [id, a.text])) };
  return `PLANO ATUAL (JSON):\n${JSON.stringify(db.plan)}\n\nCARGAS ATUAIS (kg por id de exercício):\n${JSON.stringify(db.weights)}\n\nPROGRESSO DE HOJE (${db.progress.date}, dia ${db.progress.day}):\n${JSON.stringify(today)}\n\nÚLTIMOS TREINOS (séries feitas, cargas e reps por série, por id):\n${JSON.stringify(recent)}\n\nSUGESTÕES AUTOMÁTICAS DE CARGA (já exibidas ao usuário):\n${JSON.stringify(hints)}`;
}

// Retorna { reply, changes: [{day, day_plan, reason}] }. Não altera o db.
export async function askCoach(db, userMessage, images = []) {
  if (!process.env.OPENROUTER_API_KEY) {
    const e = new Error('OPENROUTER_API_KEY não configurada no servidor');
    e.status = 503;
    throw e;
  }
  const history = db.chat.slice(-20).map((m) => ({ role: m.role, content: m.text }));
  const r = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'X-Title': 'FitBurn Coach',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      reasoning: { effort: EFFORT },
      tools: TOOLS,
      messages: [
        { role: 'system', content: `${SYSTEM}\n\n${context(db)}` },
        ...history,
        { role: 'user', content: images.length ? [{ type: 'text', text: userMessage }, ...images.map((url) => ({ type: 'image_url', image_url: { url } }))] : userMessage },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const msg = (await r.json()).choices?.[0]?.message;
  if (!msg) throw new Error('resposta vazia do modelo');

  let reply = typeof msg.content === 'string' ? msg.content : '';
  const changes = [];
  const swaps = [];
  const rejected = [];
  for (const call of msg.tool_calls || []) {
    if (!['update_day', 'substitute_today'].includes(call.function?.name)) continue;
    let args = {};
    try {
      args = JSON.parse(call.function.arguments || '{}');
    } catch {
      rejected.push('argumentos inválidos');
      continue;
    }
    if (call.function.name === 'substitute_today') {
      try {
        swaps.push({ ...sanitizeSwap(db.plan, args), reason: String(args.reason || '') });
      } catch (err) {
        rejected.push(`troca: ${err.message}`);
      }
      continue;
    }
    const { day, reason, ...rest } = args;
    try {
      if (!DAYS.includes(day)) throw new Error('dia inválido');
      const base = db.plan[day];
      const plan = sanitizeDay({ title: base.title, desc: base.desc, ...rest });
      changes.push({ day, plan, reason: String(reason || '') });
    } catch (err) {
      rejected.push(`${day}: ${err.message}`);
    }
  }
  reply = reply.trim();
  if (!reply && changes.length) reply = changes.map((x) => `Treino ${x.day} ajustado: ${x.reason}`).join('\n');
  if (rejected.length) reply += `

(Não consegui aplicar um ajuste: ${rejected.join('; ')}. Tente pedir de novo.)`;
  return { reply: reply || 'Ok!', changes, swaps };
}
