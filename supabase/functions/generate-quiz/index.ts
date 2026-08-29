import { withSupabase } from "npm:@supabase/server@^1";

const ALLOWED_DIFFICULTIES = new Set(["Fácil", "Médio", "Difícil"]);
const DEFAULT_MODEL = "gemini-3.6-flash";
const DEFAULT_DAILY_LIMIT = 50;

function cleanText(value: unknown, maxLength: number, required = false): string {
  if (typeof value !== "string") {
    if (required) throw new Error("Os dados do simulado estão incompletos.");
    return "";
  }
  const text = value.trim();
  if ((required && !text) || text.length > maxLength) {
    throw new Error("Os dados do simulado estão incompletos ou são muito extensos.");
  }
  return text;
}

function validateRequest(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pedido de simulado inválido.");
  }
  const input = value as Record<string, unknown>;
  const quantity = Number(input.quantity);
  const difficulty = cleanText(input.difficulty, 16, true);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
    throw new Error("A quantidade deve ficar entre 1 e 10 questões.");
  }
  if (!ALLOWED_DIFFICULTIES.has(difficulty)) {
    throw new Error("A dificuldade escolhida é inválida.");
  }
  return {
    subjectName: cleanText(input.subjectName, 120, true),
    topic: cleanText(input.topic, 240),
    difficulty,
    quantity,
    examName: cleanText(input.examName, 160),
    boardName: cleanText(input.boardName, 120),
  };
}

function validateQuestions(value: unknown, expectedQuantity: number) {
  if (!Array.isArray(value) || value.length !== expectedQuantity) {
    throw new Error("A IA retornou uma quantidade diferente da solicitada.");
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Questão ${index + 1} inválida.`);
    }
    const question = item as Record<string, unknown>;
    const prompt = cleanText(question.pergunta, 4000, true);
    const explanation = cleanText(question.explicacao, 8000, true);
    if (!Array.isArray(question.opcoes) || question.opcoes.length !== 4) {
      throw new Error(`Alternativas da questão ${index + 1} inválidas.`);
    }
    const options = question.opcoes.map((option) => cleanText(option, 2000, true));
    const correctIndex = Number(question.resposta_correta_index);
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
      throw new Error(`Resposta da questão ${index + 1} inválida.`);
    }
    const difficulty = cleanText(question.dificuldade, 16, true);
    if (!ALLOWED_DIFFICULTIES.has(difficulty)) {
      throw new Error(`Dificuldade da questão ${index + 1} inválida.`);
    }
    return {
      pergunta: prompt,
      opcoes: options,
      resposta_correta_index: correctIndex,
      explicacao: explanation,
      dificuldade: difficulty,
    };
  });
}

function buildPrompt(input: ReturnType<typeof validateRequest>): string {
  const destination = input.examName
    ? `o concurso "${input.examName}"`
    : "concursos públicos no Brasil";
  const topic = input.topic ? `, com foco no tema "${input.topic}"` : "";
  const board = input.boardName ? ` e no estilo da banca "${input.boardName}"` : "";
  return `Gere ${input.quantity} questões de múltipla escolha, nível ${input.difficulty}, sobre a matéria "${input.subjectName}"${topic}. As questões devem ser relevantes para ${destination}${board}.`;
}

const responseSchema = (quantity: number) => ({
  type: "array",
  minItems: quantity,
  maxItems: quantity,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["pergunta", "opcoes", "resposta_correta_index", "explicacao", "dificuldade"],
    properties: {
      pergunta: { type: "string" },
      opcoes: { type: "array", minItems: 4, maxItems: 4, items: { type: "string" } },
      resposta_correta_index: { type: "integer", minimum: 0, maximum: 3 },
      explicacao: { type: "string" },
      dificuldade: { type: "string", enum: ["Fácil", "Médio", "Difícil"] },
    },
  },
});

function readDailyLimit(): number {
  const configured = Number(Deno.env.get("AI_DAILY_QUESTION_LIMIT"));
  return Number.isInteger(configured) && configured >= 10 && configured <= 500
    ? configured
    : DEFAULT_DAILY_LIMIT;
}

async function refundQuota(
  supabaseAdmin: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ error: unknown }> },
  userId: string,
  quantity: number,
) {
  const { error } = await supabaseAdmin.rpc("refund_ai_daily_quota", {
    target_user_id: userId,
    target_questions: quantity,
  });
  if (error) console.error("Failed to refund AI quota");
}

export default {
  fetch: withSupabase({ auth: "user" }, async (request, context) => {
    if (request.method !== "POST") {
      return Response.json({ error: "Método não permitido." }, { status: 405 });
    }

    let reservation: { userId: string; quantity: number } | null = null;
    try {
      const apiKey = Deno.env.get("GEMINI_API_KEY")?.trim();
      if (!apiKey) {
        return Response.json(
          { error: "A inteligência artificial ainda não foi ativada pelo administrador." },
          { status: 503 },
        );
      }

      const input = validateRequest(await request.json());
      const userId = String(context.userClaims?.id || context.userClaims?.sub || "");
      if (!/^[0-9a-f-]{36}$/i.test(userId)) {
        return Response.json({ error: "Não foi possível identificar sua conta." }, { status: 401 });
      }

      const dailyLimit = readDailyLimit();
      const { data: quotaRows, error: quotaError } = await context.supabaseAdmin.rpc(
        "reserve_ai_daily_quota",
        {
          target_user_id: userId,
          target_questions: input.quantity,
          daily_limit: dailyLimit,
        },
      );
      if (quotaError || !Array.isArray(quotaRows) || !quotaRows[0]) {
        console.error("Failed to reserve AI quota");
        return Response.json({ error: "Não foi possível conferir seu limite diário agora." }, { status: 503 });
      }
      const quota = quotaRows[0];
      if (!quota.allowed) {
        return Response.json(
          { error: `Seu limite diário de ${dailyLimit} questões foi atingido. Tente novamente amanhã.` },
          { status: 429 },
        );
      }
      reservation = { userId, quantity: input.quantity };

      const model = Deno.env.get("GEMINI_MODEL")?.trim() || DEFAULT_MODEL;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);

      let response: Response;
      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey,
            },
            signal: controller.signal,
            body: JSON.stringify({
              systemInstruction: {
                parts: [{
                  text: "Você elabora questões para concursos públicos no Brasil. Produza conteúdo correto, claro e sem dados pessoais. Responda somente no formato JSON solicitado.",
                }],
              },
              contents: [{ role: "user", parts: [{ text: buildPrompt(input) }] }],
              generationConfig: {
                responseMimeType: "application/json",
                responseJsonSchema: responseSchema(input.quantity),
              },
            }),
          },
        );
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        console.error("Gemini request failed", { status: response.status });
        await refundQuota(context.supabaseAdmin, reservation.userId, reservation.quantity);
        reservation = null;
        const status = response.status === 429 ? 429 : 502;
        const message = status === 429
          ? "O limite temporário da IA foi atingido. Aguarde um pouco e tente novamente."
          : "A IA não conseguiu gerar o simulado agora. Tente novamente em instantes.";
        return Response.json({ error: message }, { status });
      }

      const result = await response.json();
      const text = result?.candidates?.[0]?.content?.parts
        ?.map((part: { text?: unknown }) => typeof part.text === "string" ? part.text : "")
        .join("")
        .trim();
      if (!text) throw new Error("A IA não retornou conteúdo.");

      const questions = validateQuestions(JSON.parse(text), input.quantity);
      reservation = null;
      return Response.json({
        questions,
        quota: {
          remaining: Number(quota.remaining),
          limit: dailyLimit,
        },
      });
    } catch (error) {
      if (reservation) await refundQuota(context.supabaseAdmin, reservation.userId, reservation.quantity);
      if (error instanceof DOMException && error.name === "AbortError") {
        return Response.json({ error: "A IA demorou demais para responder. Tente novamente." }, { status: 504 });
      }
      if (error instanceof SyntaxError) {
        return Response.json({ error: "A IA retornou uma resposta inesperada. Tente novamente." }, { status: 502 });
      }
      const message = error instanceof Error ? error.message : "Não foi possível gerar o simulado.";
      const isInputError = /inválid|incomplet|extens|quantidade|dificuldade/i.test(message);
      if (!isInputError) console.error("Quiz generation failed", { message });
      return Response.json(
        { error: isInputError ? message : "Não foi possível gerar o simulado agora." },
        { status: isInputError ? 400 : 502 },
      );
    }
  }),
};
