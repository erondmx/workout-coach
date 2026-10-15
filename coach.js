import { sanitizeDay, DAYS } from './lib.js';

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
- "rest" é só número de segundos (ex.: "60"). Exercícios de cardio usam isCardio=true e sets=1.
- Explique no texto, em 1-2 frases, o que mudou e por quê.
- Use o histórico de cargas e séries para decidir progressão (ex.: bateu todas as séries com folga duas vezes → suba carga ou reps).`;

const TOOLS = [
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
  return `PLANO ATUAL (JSON):\n${JSON.stringify(db.plan)}\n\nCARGAS ATUAIS (kg por id de exercício):\n${JSON.stringify(db.weights)}\n\nPROGRESSO DE HOJE (${db.progress.date}, dia ${db.progress.day}):\n${JSON.stringify(db.progress.sets)}\n\nÚLTIMOS TREINOS (séries feitas por id e cargas):\n${JSON.stringify(recent)}`;
}

// Retorna { reply, changes: [{day, day_plan, reason}] }. Não altera o db.
export async function askCoach(db, userMessage) {
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
        { role: 'user', content: userMessage },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const msg = (await r.json()).choices?.[0]?.message;
  if (!msg) throw new Error('resposta vazia do modelo');

  let reply = typeof msg.content === 'string' ? msg.content : '';
  const changes = [];
  const rejected = [];
  for (const call of msg.tool_calls || []) {
    if (call.function?.name !== 'update_day') continue;
    let args = {};
    try {
      args = JSON.parse(call.function.arguments || '{}');
    } catch {
      rejected.push('argumentos inválidos');
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
  return { reply: reply || 'Ok!', changes };
}
