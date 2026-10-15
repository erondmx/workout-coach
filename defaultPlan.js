export const defaultPlan = {
  A: {
    title: "Treino A: Empurrar (Peito, Ombro, Tríceps) + HIIT",
    desc: "Mantenha o descanso entre 45s e 60s para manter a frequência cardíaca alta.",
    exercises: [
      { id: "a1", name: "Aquecimento: Elíptico ou Esteira", sets: 1, reps: "5 min (Ritmo Moderado)", isCardio: true },
      { id: "a2", name: "Supino Reto (Halteres ou Barra)", sets: 4, reps: "12 a 15 reps", rest: "60s" },
      { id: "a3", name: "Supino Inclinado com Halteres", sets: 3, reps: "12 reps", rest: "60s" },
      { id: "a4", name: "Desenvolvimento de Ombros (Halteres)", sets: 4, reps: "12 reps", rest: "60s" },
      { id: "a5", name: "Elevação Lateral", sets: 3, reps: "15 reps (Descanso curto)", rest: "45s" },
      { id: "a6", name: "Tríceps Pulley (Corda ou Barra)", sets: 3, reps: "15 reps", rest: "45s" },
      { id: "a7", name: "Tríceps Francês ou Testa", sets: 3, reps: "12 reps", rest: "45s" },
      { id: "a8", name: "🔥 Cardio HIIT Finalizador (Esteira/Elíptico/Boxe)", sets: 1, reps: "15 min (1 min forte / 1 min leve)", isCardio: true }
    ]
  },
  B: {
    title: "Treino B: Puxar (Costas, Bíceps) + Abdômen + Cardio",
    desc: "Costas são um grande grupo muscular e gastam muita energia. Foque na execução!",
    exercises: [
      { id: "b1", name: "Aquecimento: Mobilidade + Cardio Leve", sets: 1, reps: "5 min", isCardio: true },
      { id: "b2", name: "Puxada Alta na Polia (Frente)", sets: 4, reps: "12 a 15 reps", rest: "60s" },
      { id: "b3", name: "Remada Baixa no Triângulo", sets: 4, reps: "12 reps", rest: "60s" },
      { id: "b4", name: "Remada Curvada ou Serrote", sets: 3, reps: "12 reps", rest: "60s" },
      { id: "b5", name: "Crucifixo Inverso (Posterior de Ombro)", sets: 3, reps: "15 reps", rest: "45s" },
      { id: "b6", name: "Rosca Direta (Barra ou Halteres)", sets: 3, reps: "12 a 15 reps", rest: "45s" },
      { id: "b7", name: "Rosca Martelo", sets: 3, reps: "12 reps", rest: "45s" },
      { id: "b8", name: "Prancha Abdominal + Abdominal Supra", sets: 3, reps: "45s Prancha + 15 Abd", rest: "45s" },
      { id: "b9", name: "🔥 Cardio Constante (Inclinação/Elíptico)", sets: 1, reps: "20 min (Ritmo Moderado/Forte)", isCardio: true }
    ]
  },
  C: {
    title: "Treino C: Pernas Completo (Alto Gasto Calórico)",
    desc: "O treino de pernas é o que mais queima calorias no pós-treino (efeito EPOC).",
    exercises: [
      { id: "c1", name: "Aquecimento: Bicicleta ou Elíptico", sets: 1, reps: "5 min", isCardio: true },
      { id: "c2", name: "Agachamento Livre ou no Smith", sets: 4, reps: "12 reps", rest: "90s" },
      { id: "c3", name: "Leg Press 45º", sets: 4, reps: "12 a 15 reps", rest: "60s" },
      { id: "c4", name: "Cadeira Extensora", sets: 3, reps: "15 reps (Segura 1s em cima)", rest: "45s" },
      { id: "c5", name: "Stiff (com Barra ou Halteres)", sets: 4, reps: "12 reps", rest: "60s" },
      { id: "c6", name: "Mesa ou Cadeira Flexora", sets: 3, reps: "12 a 15 reps", rest: "45s" },
      { id: "c7", name: "Panturrilha no Leg Press ou em Pé", sets: 4, reps: "15 a 20 reps", rest: "45s" },
      { id: "c8", name: "🔥 Cardio Regenerativo/Queima", sets: 1, reps: "15 min (Caminhada Inclinada ou Elíptico)", isCardio: true }
    ]
  }
};
