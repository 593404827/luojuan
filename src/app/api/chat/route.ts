import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";

type Payload = {
  mode: "random" | "direct" | "continue";
  messages: Array<{ role: "ai" | "user"; content: string }>;
  chapterTitle?: string;
};

const mockReplies = {
  random:
    "一下子不用想太大。你脑子里先冒出来的，是一间屋子、一个人，还是一件老东西？咱们就从最先冒出来的那个讲起。",
  direct:
    "这样讲就很好，已经有感觉了。那我先接着问一句：这件事大概是在你人生的哪个阶段？那时候你身边最常出现的是谁？",
  continue:
    "我们就顺着刚才那一下往下走。那会儿你最先注意到的，是眼前那个场景，还是谁说的那一句话？",
} as const;

type PersonaPreset = "journalist" | "editor" | "coach" | "coach_editor";

function getPersonaPreset(): PersonaPreset {
  const raw = (process.env.LUOJUAN_ASSISTANT_PRESET || "").toLowerCase().trim();
  if (raw === "journalist" || raw === "editor" || raw === "coach" || raw === "coach_editor")
    return raw;
  return "coach_editor";
}

function buildSystemPrompt(preset: PersonaPreset) {
  const shared = [
    "你在帮助用户把人生经历写成一本回忆录。",
    "你的语气温和、自然，有聊天感，不居高临下，不机械，不说教。",
    "默认将用户视为70后（1970-1979年出生）背景来做访谈式引导：语言要更贴近当代口语与家庭叙事，不使用刻板印象标签，不说“你们这一代都怎样”。",
    "你可以优先从70后常见的人生节点/生活语境切入提问，但必须以用户实际回答为准，不要强行套模板：童年与家里、上学与老师同学、单位/工厂/下岗转岗、南下/北漂/进城、婚恋与成家、买房搬家、孩子教育、父母照护、重大社会事件的个人经历等。",
    "提问时尽量用具体画面带入，而不是抽象话题：当时在哪里、谁在场、你手里拿着什么、听到什么声音、空气里什么味道、那天说过哪一句话。",
    "你每次输出必须以一个具体问题结尾，问题要可回答、可继续追问。",
    "不要问泛泛的问题，比如“你今天想聊什么/想聊点什么”。",
    "不要总用一种句式开头，不要反复出现“为了把它写成一章”“我们先把这一章落在”这种模板表达。",
    "更像真人聊天：可以先轻轻接一句对方刚说的话，再问下一个问题；句子长短要有变化。",
    "一轮只问一个主问题；如果怕用户难回答，可以顺手给一个轻一点的备选切口，但不要连珠炮。",
    "优先从具体细节切入：人、地点、物件、时间、动作、气味、声音、一句话。",
    "尽量给 2 个可选切入点（用“还是/或者”），减少用户思考负担。",
    "避免过度共情表演，不使用夸张的心理分析措辞，不做医疗/诊断建议。",
    "如果用户表达抗拒或累了，先征求同意：可以先停一下吗？我们换个更轻的切口。",
    "不要分点输出，不要解释你的规则，不要提到任何技术词。",
  ].join("\n");

  const presetLine =
    preset === "coach_editor"
      ? [
          "你的角色是“温柔的陪谈者 + 编辑”。",
          "你先做陪谈者：降低表达压力、循循善诱、不过度追问。",
          "你再做编辑：在合适的时机补齐结构（时间线、人物、场景、转折、因果），把素材慢慢整理成可成章的段落。",
        ].join("\n")
      : preset === "editor"
      ? "你的角色更像一名编辑：帮用户把素材理顺，追问结构（时间线、转折、人物关系、因果），但仍以温和提问为主。"
      : preset === "coach"
      ? "你的角色更像一名温柔的陪谈者：重点是降低表达压力、循循善诱地引导回忆，但不做治疗与诊断。"
      : "你的角色更像一名记者/采访者：擅长抓住细节，问到关键处，帮助用户把一段经历讲清楚。";

  return `${shared}\n${presetLine}`;
}

function buildPrompt(payload: Payload) {
  const modeHint =
    payload.mode === "random"
      ? "当前模式：随机提问。你要主动给出一个不生硬的开场问题来开启回忆，像真人访谈，不要太正式。"
      : payload.mode === "direct"
      ? "当前模式：主动讲述。用户已经先开口，你要自然承接他的内容继续追问，帮助补齐时间/人物/场景细节。"
      : `当前模式：继续补写。你要带着章节《${payload.chapterTitle ?? "当前章节"}》的上下文继续追问，帮助把这一章写完整。`;

  const history = payload.messages
    .slice(-6)
    .map((message) => `${message.role === "user" ? "用户" : "AI"}：${message.content}`)
    .join("\n");

  return `${modeHint}\n\n最近对话：\n${history}`;
}

function streamFromText(text: string) {
  const encoder = new TextEncoder();
  let index = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index >= text.length) {
        controller.close();
        return;
      }

      const nextIndex = Math.min(index + 12, text.length);
      controller.enqueue(encoder.encode(text.slice(index, nextIndex)));
      index = nextIndex;
      await new Promise((resolve) => setTimeout(resolve, 28));
    },
  });
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ message: "未登录" }, { status: 401 });
    }
    const payload = (await request.json()) as Payload;

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return new Response(streamFromText(mockReplies[payload.mode]), {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-Chat-Meta": "当前使用本地 mock 回复，可在配置 DeepSeek API Key 后切换为真实模型",
        },
      });
    }

    const baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
    const preset = getPersonaPreset();
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
        temperature: 0.8,
        stream: true,
        messages: [
          {
            role: "system",
            content: buildSystemPrompt(preset),
          },
          {
            role: "user",
            content: buildPrompt(payload),
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return new Response(streamFromText(mockReplies[payload.mode]), {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-Chat-Meta": `DeepSeek 请求失败，已回退到本地 mock：${errorText}`,
        },
      });
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const upstream = response.body?.getReader();

    if (!upstream) {
      return new Response(streamFromText(mockReplies[payload.mode]), {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-Chat-Meta": "DeepSeek 无流式响应体，已回退到本地 mock",
        },
      });
    }

    let buffer = "";

    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        while (true) {
          const { value, done } = await upstream.read();
          if (done) {
            if (buffer.trim()) {
              for (const line of buffer.split("\n")) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data:")) continue;
                const raw = trimmed.slice(5).trim();
                if (!raw || raw === "[DONE]") continue;
                try {
                  const json = JSON.parse(raw);
                  const delta = json?.choices?.[0]?.delta?.content;
                  if (delta) controller.enqueue(encoder.encode(delta));
                } catch {
                  // 忽略单行解析失败，避免中断整个流
                }
              }
            }
            controller.close();
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n");
          buffer = parts.pop() ?? "";

          for (const line of parts) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const raw = trimmed.slice(5).trim();
            if (!raw || raw === "[DONE]") continue;

            try {
              const json = JSON.parse(raw);
              const delta = json?.choices?.[0]?.delta?.content;
              if (delta) {
                controller.enqueue(encoder.encode(delta));
                return;
              }
            } catch {
              // 忽略单行解析失败，继续读取
            }
          }
        }
      },
      cancel() {
        void upstream.cancel();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Chat-Meta": "DeepSeek 实时回复",
      },
    });
  } catch (error) {
    return new Response(streamFromText(mockReplies.random), {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Chat-Meta": `接口异常，已回退为本地 mock：${String(error)}`,
      },
    });
  }
}
