import { NextRequest, NextResponse } from "next/server";
import { buildAIPrompt } from "@/lib/building/prompt-parser";

interface AIResponse {
  storeys?: number;
  style?: string;
  roof?: string;
  width?: number;
  depth?: number;
  shape?: string;
  rooms?: string[];
}

export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json();

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
    }

    const systemPrompt = buildAIPrompt(prompt);

    // Try Ollama first (local), fall back to OpenAI (cloud)
    let result: AIResponse | null = null;

    // Try Ollama (local model)
    try {
      result = await callOllama(systemPrompt);
    } catch {
      // Ollama not available, try OpenAI
    }

    // Try OpenAI if Ollama failed
    if (!result) {
      const openaiKey = process.env.OPENAI_API_KEY;
      if (openaiKey) {
        try {
          result = await callOpenAI(systemPrompt, openaiKey);
        } catch {
          return NextResponse.json(
            { error: "AI service unavailable. Using local keyword parsing." },
            { status: 503 }
          );
        }
      } else {
        return NextResponse.json(
          { error: "No AI service configured. Set OPENAI_API_KEY or run Ollama locally." },
          { status: 503 }
        );
      }
    }

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

async function callOllama(systemPrompt: string): Promise<AIResponse | null> {
  const response = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama3.1",
      prompt: systemPrompt,
      stream: false,
      options: {
        temperature: 0.1,
      },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) return null;

  const data = await response.json();
  const text = data.response as string;

  return parseAIResponse(text);
}

async function callOpenAI(
  systemPrompt: string,
  apiKey: string
): Promise<AIResponse | null> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
      ],
      temperature: 0.1,
      max_tokens: 200,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) return null;

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content as string;

  return parseAIResponse(text);
}

function parseAIResponse(text: string): AIResponse | null {
  // Extract JSON from the response (may be wrapped in markdown code blocks)
  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);

    return {
      storeys: typeof parsed.storeys === "number" ? Math.min(6, Math.max(1, parsed.storeys)) : undefined,
      style: typeof parsed.style === "string" ? parsed.style : undefined,
      roof: typeof parsed.roof === "string" ? parsed.roof : undefined,
      width: typeof parsed.width === "number" ? Math.min(30, Math.max(4, parsed.width)) : undefined,
      depth: typeof parsed.depth === "number" ? Math.min(30, Math.max(4, parsed.depth)) : undefined,
      shape: typeof parsed.shape === "string" ? parsed.shape : undefined,
      rooms: Array.isArray(parsed.rooms) ? parsed.rooms : undefined,
    };
  } catch {
    return null;
  }
}