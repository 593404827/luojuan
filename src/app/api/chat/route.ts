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

function buildSystemPrompt() {
  return [
    "你是一个帮用户写回忆录的助手。用户大概率是上了年纪的人。",
    "",
    "最重要的一条：你不是采访记者，你是在跟人聊天。",
    "",
    "聊天和采访的区别在于：",
    "- 采访是：问→答→问→答→问→答（像你现在这样）",
    "- 聊天是：对方说了一句→你先对他说的有点反应→再自然引出下一句",
    "",
    "所以你的回复结构应该是：",
    "第一步：先接住对方的话——表示你听到了、听进去了。比如对方说猫没起名字，你可以说“没起名字也挺好，散养猫好像都不怎么起大名”。",
    "第二步：如果有共鸣或好奇，可以自然地说一句自己的感受。",
    "第三步：真的想了解什么，再顺势问一句，但不要句句都问。",
    "",
    "关于提问：",
    "- 可以不问。聊着聊着自然会有下一句，不需要每轮都以问题结尾。",
    "- 如果要问，一个问题就够了。不要问完一个紧接着追下一个。",
    "- 问题要自然，像是聊天时突然想到的，而不是在填表。",
    "",
    "语气：",
    "- 像跟一个邻居长辈闲聊。可以随意一点、轻松一点。",
    "- 不要热情过度、不要夸张鼓励、不要动不动就“真好”“太棒了”。",
    "- 不要教用户做事、不要分析用户心理。",
    "- 加括号的动作描述一概不要，你不是在写剧本。",
    "",
    "用户的回答可能很短（“是的”“不固定”），这时候不用追问。可以顺着他的话轻轻带一句，或者换个话题，甚至安静地接一句“嗯，那也挺好的”都可以。不用每句都追。",
    "",
    "如果用户问你是谁：",
    "- 平静地回一句“我就是个帮你记东西的”或者“你当我是个小助理就行”。",
    "- 不要展开，不要介绍功能，说完立刻回到用户的话题。",
  ].join("\n");
}

function buildPrompt(payload: Payload) {
  const modeHint =
    payload.mode === "random"
      ? "当前模式：随机提问。自然地开启一段回忆话题，不要像采访开场白。"
      : payload.mode === "direct"
      ? "当前模式：主动讲述。用户已经开口了，你像聊天一样接着他的话聊下去就好。"
      : `当前模式：继续补写。顺着章节《${payload.chapterTitle ?? "当前章节"}》的已有内容，像闲聊一样自然延续。`;

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
          "X-Chat-Meta": "mock_missing_key",
        },
      });
    }

    const baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
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
            content: buildSystemPrompt(),
          },
          {
            role: "user",
            content: buildPrompt(payload),
          },
        ],
      }),
    });

    if (!response.ok) {
      await response.text();
      return new Response(streamFromText(mockReplies[payload.mode]), {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-Chat-Meta": "mock_request_failed",
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
          "X-Chat-Meta": "mock_no_upstream_body",
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

          let foundDelta = false;
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
                foundDelta = true;
              }
            } catch {
              // 忽略单行解析失败，继续读取
            }
          }

          // 当前块有内容入列才退出，让 consumer 消费
          if (foundDelta) return;
          // 否则继续读下一个上游块，不会丢失数据
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
        "X-Chat-Meta": "deepseek_live",
      },
    });
  } catch {
    return new Response(streamFromText(mockReplies.random), {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Chat-Meta": "fallback_exception",
      },
    });
  }
}
