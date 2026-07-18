"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  type ChatMode,
  type Message,
  type ScreenKey,
} from "@/lib/demo-content";
import {
  createDefaultAppState,
  type CommunityWork,
  type DraftState,
  type StoredChapter,
} from "@/lib/app-state";

const modeMap: Record<"random" | "direct" | "continue", ScreenKey> = {
  random: "chat-random",
  direct: "chat-direct",
  continue: "chat-continue",
};

/** 生成 UUID，兼容非安全上下文（局域网 IP 访问 dev server 时 crypto.randomUUID 不可用） */
function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch {
      // 非安全上下文（如 http://10.x.x.x）会抛异常，走兜底
    }
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function getChatHeaderTitle(args: {
  mode: ChatMode;
  draftTitle: string;
  selectedChapterTitle?: string | null;
  hasChapterProgress: boolean;
}) {
  const cleanDraftTitle = args.draftTitle?.trim();
  const cleanChapterTitle = args.selectedChapterTitle?.trim();

  if (args.mode === "continue") {
    return cleanChapterTitle || cleanDraftTitle || "继续补写";
  }

  // 新用户 / 未成章：不要出现任何“示例章节名”
  if (!args.hasChapterProgress) {
    return "回忆采集";
  }

  // 已经有章节之后：允许显示正在写的章节名（来自真实内容）
  return cleanDraftTitle || "回忆采集";
}

function shortText(text: string, max = 54) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}

function guessTitleFromText(text: string, mode: ChatMode) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return mode === "continue" ? "继续补写的这一章" : "新的这一章";
  }

  const firstSentence = cleaned.split(/[。！？!?\n]/)[0]?.trim() || cleaned;
  const titleSeed = firstSentence.slice(0, 10).trim();

  if (mode === "continue") return `续写：${titleSeed}`;
  if (mode === "direct") return `讲到：${titleSeed}`;
  return `记起：${titleSeed}`;
}

function extractTags(text: string) {
  const candidates = ["小时候", "家里", "离家", "院子", "火车", "学校", "工作", "家乡", "童年"];
  const matched = candidates.filter((item) => text.includes(item));
  return matched.slice(0, 3);
}

function createDraft(mode: ChatMode, messages: Message[], existingTitle?: string): DraftState {
  const userMessages = messages.filter((message) => message.role === "user").map((message) => message.content);
  const combined = userMessages.join(" ").trim();
  const latest = userMessages[userMessages.length - 1]?.trim() || "";
  const content = shortText(latest || combined, 120);

  return {
    title: existingTitle || guessTitleFromText(latest || combined, mode),
    content: content || "这一段回忆已经保存，你可以继续补充更多细节。",
    tags: extractTags(combined),
  };
}

function createContinuePrompt(draft: DraftState) {
  if (!draft.content) {
    return {
      id: generateId(),
      role: "ai" as const,
      content: "如果你想继续写，我们就从上一段最想补充的地方接着讲。",
      meta: "继续补写",
    };
  }

  return {
    id: generateId(),
    role: "ai" as const,
    content: `你刚才已经提到了“${shortText(draft.content, 18)}”。如果继续往下补，你最想先多讲一点当时的场景，还是当时身边的人？`,
    meta: "继续补写",
  };
}

function createRandomPrompt() {
  const openers = [
    "你好呀，我是来帮你写回忆录的。咱们先从哪儿说起呢——你最先想起来的是一个人、一个地方，还是一样东西？",
    "你好啊～我是你的回忆录小助手。你最近常常想起的，是哪段日子？",
    "总算见到你了！你平时爱聊以前的事吗？还是说有什么事情一直想记下来，但一直没动笔？",
    "嗨，我是来帮你记故事的。你先随便说说——你记忆里最早的那个画面是什么？",
    "你好呀。你小时候住的地方，你现在还能想起来长什么样吗？",
    "很高兴见到你！你觉得自己这辈子最值得写下来的，是哪一段经历？",
  ];
  const pick = openers[Math.floor(Math.random() * openers.length)];
  return {
    id: generateId(),
    role: "ai" as const,
    content: pick,
    meta: "随机提问",
  };
}

function createDirectPrompt() {
  return {
    id: generateId(),
    role: "ai" as const,
    content:
      "你可以直接从最想写进书里的一件事开始。为了帮你把它写清楚：这件事大概发生在什么时候？当时你身边最重要的那个人是谁？",
    meta: "主动讲述",
  };
}

function getChatMetaLabel(metaCode: string | null) {
  switch (metaCode) {
    case "mock_missing_key":
      return "当前使用本地 mock 回复，可在配置 DeepSeek API Key 后切换为真实模型";
    case "mock_request_failed":
      return "DeepSeek 请求失败，已回退到本地 mock";
    case "mock_no_upstream_body":
      return "DeepSeek 无流式响应体，已回退到本地 mock";
    case "deepseek_live":
      return "DeepSeek 实时回复";
    case "fallback_exception":
      return "接口异常，已回退为本地 mock";
    default:
      return "正在生成回复…";
  }
}

export default function Home() {
  const initialState = useMemo(() => createDefaultAppState(), []);
  const [authStatus, setAuthStatus] = useState<"loading" | "authenticated" | "unauthenticated">(
    "loading"
  );
  const [authUsername, setAuthUsername] = useState("");
  const [authAccounts, setAuthAccounts] = useState<
    Array<{ username: string; displayName: string; authorLabel: string }>
  >([]);
  const [easyAccessMode, setEasyAccessMode] = useState(false);
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [loginError, setLoginError] = useState("");
  const [screen, setScreen] = useState<ScreenKey>("home");
  const [bookTitle] = useState(initialState.bookTitle);
  const [selectedChapterId, setSelectedChapterId] = useState(initialState.currentChapterId);
  const [selectedWorkId, setSelectedWorkId] = useState("");
  const [currentMode, setCurrentMode] = useState<ChatMode>("random");
  const [draft, setDraft] = useState<DraftState>(initialState.draft);
  const [chapters, setChapters] = useState<StoredChapter[]>(initialState.chapters);
  const [communityWorks, setCommunityWorks] = useState<CommunityWork[]>([]);
  const [chatState, setChatState] = useState<Record<ChatMode, Message[]>>(initialState.conversations);
  const [draftInput, setDraftInput] = useState<Record<ChatMode, string>>({
    random: "",
    direct: "",
    continue: "",
  });
  const [selectedFilters, setSelectedFilters] = useState(initialState.selectedFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [isEditingChapter, setIsEditingChapter] = useState(false);
  const [chapterEditContent, setChapterEditContent] = useState("");
  const [shareHint, setShareHint] = useState("");
  const [organizeHint, setOrganizeHint] = useState("");
  const [communityHint, setCommunityHint] = useState("");
  const [pendingFilters, setPendingFilters] = useState<Record<string, string>>({
    topic: initialState.selectedFilters[0] ?? "第一次离家",
    era: initialState.selectedFilters[1] ?? "80年代",
    keyword: initialState.selectedFilters[2] ?? "工厂",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isOrganizing, setIsOrganizing] = useState(false);
  const [hasLoadedState, setHasLoadedState] = useState(false);
  const persistTimer = useRef<NodeJS.Timeout | null>(null);

  const activeMessages = chatState[currentMode];
  const activeInput = draftInput[currentMode];
  const selectedChapter = useMemo(
    () => chapters.find((chapter) => chapter.id === selectedChapterId) ?? chapters[0] ?? null,
    [chapters, selectedChapterId]
  );
  const selectedWork = useMemo(
    () =>
      communityWorks.find((work) => work.id === selectedWorkId) ??
      communityWorks[0] ??
      null,
    [communityWorks, selectedWorkId]
  );
  const currentProgressChapter = useMemo(
    () => chapters.find((chapter) => chapter.id === selectedChapterId) ?? chapters[0],
    [chapters, selectedChapterId]
  );
  const currentAccount = useMemo(
    () => authAccounts.find((account) => account.username === authUsername) ?? null,
    [authAccounts, authUsername]
  );
  const userMessages = useMemo(
    () =>
      Object.values(chatState)
        .flat()
        .filter((message) => message.role === "user" && message.content.trim()),
    [chatState]
  );
  const latestUserMessage = userMessages[userMessages.length - 1]?.content ?? "";
  const hasDraftProgress = Boolean(draft.content.trim());
  const hasChapterProgress = chapters.length > 0;
  const hasContinueProgress = hasChapterProgress || hasDraftProgress || userMessages.length > 0;
  const hasPreviewContent = Boolean(draft.content.trim());
  const previewTitle = draft.title?.trim() || "这一章的预览";
  const previewSummary = draft.content?.trim()
    ? shortText(draft.content, 120)
    : "继续多讲一些细节，系统就会在这里整理出更完整的章节预览。";
  const draftParagraphs = draft.content
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);

  useEffect(() => {
    let cancelled = false;

    async function hydrateSession() {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const response = await fetch("/api/auth/session", {
          cache: "no-store",
          signal: controller.signal,
        });
        clearTimeout(timeout);

        const data = await response.json();
        if (cancelled) return;

        if (data.authenticated) {
          setAuthUsername(data.username);
          setAuthAccounts(data.accounts ?? []);
          setEasyAccessMode(Boolean(data.easyAccess));
          setAuthStatus("authenticated");
        } else {
          setAuthAccounts(data.accounts ?? []);
          setEasyAccessMode(Boolean(data.easyAccess));
          setLoginForm((prev) => ({
            ...prev,
            username: data.defaultUsernameHint || prev.username,
          }));
          setAuthStatus("unauthenticated");
        }
      } catch {
        if (!cancelled) setAuthStatus("unauthenticated");
      }
    }

    hydrateSession();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (authStatus !== "authenticated") return;

    let cancelled = false;

    async function hydrateState() {
      try {
        const response = await fetch("/api/app-state", { cache: "no-store" });
        if (!response.ok) throw new Error("load failed");
        const payload = await response.json();
        if (cancelled) return;

        const state = payload.state ?? payload;
        const works = payload.communityWorks ?? [];
        setAuthUsername(payload.username || "");
        setSelectedChapterId(state.currentChapterId || "");
        setSelectedWorkId((prev) => prev || works[0]?.id || "");
        setCommunityWorks(works);
        setDraft(state.draft);
        setChapters(state.chapters);
        setChatState(state.conversations);
        setSelectedFilters(state.selectedFilters);
        setPendingFilters({
          topic: state.selectedFilters[0] ?? initialState.selectedFilters[0],
          era: state.selectedFilters[1] ?? initialState.selectedFilters[1],
          keyword: state.selectedFilters[2] ?? initialState.selectedFilters[2],
        });
      } catch {
        // 使用本地初始态作为兜底
      } finally {
        if (!cancelled) setHasLoadedState(true);
      }
    }

    hydrateState();

    return () => {
      cancelled = true;
    };
  }, [authStatus, initialState.selectedFilters]);

  useEffect(() => {
    if (!hasLoadedState || authStatus !== "authenticated") return;

    if (persistTimer.current) {
      clearTimeout(persistTimer.current);
    }

    persistTimer.current = setTimeout(() => {
      void fetch("/api/app-state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookTitle,
          currentChapterId: selectedChapterId,
          selectedFilters,
          draft,
          chapters,
          conversations: chatState,
        }),
      });
    }, 450);

    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [
    authStatus,
    bookTitle,
    chapters,
    chatState,
    draft,
    hasLoadedState,
    selectedChapterId,
    selectedFilters,
  ]);

  const goToScreen = (next: ScreenKey) => {
    if (next === "chapter-1" || next === "chapter-2") {
      setSelectedChapterId(next);
    }
    if (next === "chat-random") setCurrentMode("random");
    if (next === "chat-direct") setCurrentMode("direct");
    if (next === "chat-continue") setCurrentMode("continue");
    setScreen(next);
  };

  const openChatMode = (mode: ChatMode) => {
    if (mode === "random" && !chatState.random.some((m) => m.role === "user")) {
      const prompt = createRandomPrompt();
      setChatState((prev) => ({
        ...prev,
        random: [{ ...prompt, content: "", meta: "正在准备…" }],
      }));
      streamIntoMessage(mode, prompt.content);
    }

    if (mode === "direct" && !chatState.direct.some((m) => m.role === "user")) {
      const prompt = createDirectPrompt();
      setChatState((prev) => ({
        ...prev,
        direct: [{ ...prompt, content: "", meta: "正在准备…" }],
      }));
      streamIntoMessage(mode, prompt.content);
    }

    if (mode === "continue" && !chatState.continue.some((m) => m.role === "user") && hasContinueProgress) {
      const prompt = createContinuePrompt(draft);
      setChatState((prev) => ({
        ...prev,
        continue: [{ ...prompt, content: "", meta: "正在准备…" }],
      }));
      streamIntoMessage(mode, prompt.content);
    }

    setCurrentMode(mode);
    setScreen(modeMap[mode]);
  };

  const initialStreamMap = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  const streamIntoMessage = (mode: ChatMode, text: string) => {
    const existing = initialStreamMap.current[mode];
    if (existing) clearInterval(existing);

    const metaLabel = mode === "direct" ? "主动讲述" : mode === "continue" ? "继续补写" : "随机提问";
    let index = 0;
    const chunkSize = 3;
    const timer = setInterval(() => {
      if (index >= text.length) {
        clearInterval(timer);
        delete initialStreamMap.current[mode];
        return;
      }
      const nextIndex = Math.min(index + chunkSize, text.length);
      const chunk = text.slice(index, nextIndex);
      index = nextIndex;
      setChatState((prev) => ({
        ...prev,
        [mode]: prev[mode].map((msg, i) =>
          i === 0 ? { ...msg, content: msg.content + chunk, meta: metaLabel } : msg,
        ),
      }));
    }, 28);
    initialStreamMap.current[mode] = timer;
  };

  const clearCurrentConversation = () => {
    const mode = currentMode;
    let promptText: string | null = null;

    if (mode === "random") {
      const prompt = createRandomPrompt();
      promptText = prompt.content;
      setChatState((prev) => ({
        ...prev,
        random: [{ ...prompt, content: "", meta: "正在准备…" }],
      }));
    } else if (mode === "direct") {
      const prompt = createDirectPrompt();
      promptText = prompt.content;
      setChatState((prev) => ({
        ...prev,
        direct: [{ ...prompt, content: "", meta: "正在准备…" }],
      }));
    } else if (hasContinueProgress) {
      const prompt = createContinuePrompt(draft);
      promptText = prompt.content;
      setChatState((prev) => ({
        ...prev,
        continue: [{ ...prompt, content: "", meta: "正在准备…" }],
      }));
    } else {
      setChatState((prev) => ({ ...prev, continue: [] }));
    }

    if (promptText) {
      streamIntoMessage(mode, promptText);
    }
    setDraftInput((prev) => ({ ...prev, [mode]: "" }));
  };

  const exportBook = async (format: "docx" | "pdf") => {
    setShareHint("");
    const endpoint = `/api/export/${format}`;

    const fallbackDownload = (blob: Blob, fileName: string) => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    };

    try {
      const response = await fetch(endpoint, { credentials: "include" });
      if (!response.ok) {
        window.location.href = endpoint;
        setShareHint("当前环境无法直接分享，已尝试回退为下载。");
        return;
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const matched = disposition.match(/filename="(.+?)"/);
      const fileName = matched?.[1] || `落卷导出.${format}`;
      const fileType =
        format === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

      if (
        typeof navigator !== "undefined" &&
        typeof File !== "undefined" &&
        "share" in navigator &&
        "canShare" in navigator &&
        navigator.canShare?.({
          files: [new File([blob], fileName, { type: fileType })],
        })
      ) {
        try {
          await navigator.share({
            files: [new File([blob], fileName, { type: fileType })],
            title: bookTitle || "落卷回忆录",
            text: "把这份回忆录分享到微信或保存到设备。",
          });
          setShareHint("已打开系统分享面板，你可以选择微信。");
          return;
        } catch (error) {
          if ((error as Error)?.name === "AbortError") {
            setShareHint("你取消了分享，没有下载文件。");
            return;
          }
          fallbackDownload(blob, fileName);
          setShareHint("当前设备分享失败，已自动回退为下载。");
          return;
        }
      }

      fallbackDownload(blob, fileName);
      setShareHint("当前设备不支持直接分享，已自动开始下载。");
    } catch {
      window.location.href = endpoint;
      setShareHint("分享失败，已回退为下载。");
    }
  };

  const deleteDraftPreview = () => {
    const hasAnything = draft.title.trim() || draft.content.trim() || draft.tags.length;
    if (!hasAnything) return;
    if (!window.confirm("确定删除当前预览稿吗？这不会删除已经收录的章节。")) return;

    setDraft({ title: "", content: "", tags: [] });
    setOrganizeHint("");
    setShareHint("");
    if (!hasChapterProgress) {
      setScreen("home");
    }
  };

  const deleteCurrentChapter = () => {
    if (!selectedChapter) return;
    if (!window.confirm(`确定删除《${selectedChapter.title || "这一章"}》吗？删除后无法恢复。`)) return;

    const remaining = chapters.filter((chapter) => chapter.id !== selectedChapter.id);
    setChapters(remaining);
    setIsEditingChapter(false);

    if (remaining.length === 0) {
      setSelectedChapterId("");
      setScreen("book");
      return;
    }

    setSelectedChapterId(remaining[0].id);
    setScreen("book");
  };

  const organizeDraft = async () => {
    if (isOrganizing) return;

    const sourceText =
      chatState[currentMode]
        .filter((message) => message.role === "user")
        .map((message) => message.content.trim())
        .filter(Boolean)
        .join("\n")
        .trim() || draft.content.trim();

    if (!sourceText) {
      setOrganizeHint("先讲一点内容，再来整理成稿。");
      return;
    }

    setIsOrganizing(true);
    setOrganizeHint("");
    try {
      const response = await fetch("/api/organize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: currentMode,
          sourceText,
          currentTitle: draft.title,
          chapterTitle: selectedChapter?.title,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setOrganizeHint(data.message || "整理失败，请稍后再试。");
        return;
      }
      setDraft(data.draft);
      setOrganizeHint(data.meta || "已整理为更像章节的草稿。");
    } catch {
      setOrganizeHint("整理失败，请稍后再试。");
    } finally {
      setIsOrganizing(false);
    }
  };

  const openChapter = (id: string) => {
    setSelectedChapterId(id);
    const chapter = chapters.find((item) => item.id === id);
    setChapterEditContent((chapter?.content ?? []).join("\n\n"));
    setIsEditingChapter(false);
    setScreen(id === "chapter-1" ? "chapter-1" : "chapter-2");
  };

  const handleSend = async () => {
    const text = activeInput.trim();
    if (!text || isLoading) return;

    const userMessage: Message = {
      id: generateId(),
      role: "user",
      content: text,
      meta: currentMode === "direct" ? "主动讲述 · 已自动保存" : "已自动保存",
    };

    const nextMessages = [...activeMessages, userMessage];
    const aiMessageId = generateId();
    const pendingAiMessage: Message = {
      id: aiMessageId,
      role: "ai",
      content: "",
      meta: "正在生成回复…",
    };

    setChatState((prev) => ({ ...prev, [currentMode]: [...nextMessages, pendingAiMessage] }));
    setDraftInput((prev) => ({ ...prev, [currentMode]: "" }));
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: currentMode,
          messages: nextMessages,
          chapterTitle: currentMode === "continue" ? selectedChapter?.title : undefined,
        }),
      });
      if (!response.ok) {
        if (response.status === 401) {
          setAuthStatus("unauthenticated");
          setHasLoadedState(false);
        }
        const data = await response.json();
        throw new Error(data.message || "chat failed");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      if (!reader) {
        throw new Error("no stream body");
      }

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });

        setChatState((prev) => ({
          ...prev,
          [
            currentMode
          ]: [
            ...nextMessages,
            {
              ...pendingAiMessage,
              content: accumulated,
              meta: getChatMetaLabel(response.headers.get("X-Chat-Meta")),
            },
          ],
        }));
      }

      setChatState((prev) => ({
        ...prev,
        [currentMode]: [
          ...nextMessages,
          {
            ...pendingAiMessage,
            content: accumulated || "我先记下这一段。你愿意再往下讲一点吗？",
            meta: getChatMetaLabel(response.headers.get("X-Chat-Meta")),
          },
        ],
      }));
    } catch {
      const fallback: Message = {
        id: aiMessageId,
        role: "ai",
        content: "我先记下这一段。你愿意再多讲一点当时最难忘的细节吗？",
        meta: "网络异常，已切换为本地兜底回复",
      };
      setChatState((prev) => ({
        ...prev,
        [currentMode]: [...nextMessages, fallback],
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const finishRound = () => {
    const nextDraft = createDraft(currentMode, activeMessages, currentMode === "continue" ? selectedChapter?.title : undefined);
    setDraft(nextDraft);
    const prompt = createContinuePrompt(nextDraft);
    setChatState((prev) => ({
      ...prev,
      continue: [{ ...prompt, content: "", meta: "正在准备…" }],
    }));
    streamIntoMessage("continue", prompt.content);
    setScreen("result");
  };

  const saveDraftToBook = () => {
    const hasDraftContent = draft.content.trim().length > 0;
    if (!hasDraftContent) return;

    const targetChapterId =
      currentMode === "continue"
        ? selectedChapterId || "chapter-1"
        : chapters.length === 0
        ? "chapter-1"
        : chapters.length === 1
        ? "chapter-2"
        : selectedChapterId || chapters[chapters.length - 1]?.id || "chapter-1";

    setChapters((prev) => {
      const exists = prev.some((chapter) => chapter.id === targetChapterId);
      if (!exists) {
        const nextIndex = prev.length + 1;
        return [
          ...prev,
          {
            id: targetChapterId,
            title: draft.title || `第 ${nextIndex} 章`,
            status: "已完成",
            summary: draft.content.slice(0, 48) + (draft.content.length > 48 ? "…" : ""),
            content: [draft.content],
            tags: draft.tags,
            note: "这一章刚刚创建，后面可以继续补写或做文字修改。",
            cover: "/assets/chapter_apricot.jpg",
          },
        ];
      }

      return prev.map((chapter) =>
        chapter.id === targetChapterId
          ? {
              ...chapter,
              title: draft.title || chapter.title,
              summary: draft.content.slice(0, 48) + (draft.content.length > 48 ? "…" : ""),
              content: [draft.content, ...chapter.content.slice(1)],
              tags: draft.tags.length ? draft.tags : chapter.tags,
              status: "已更新",
            }
          : chapter
      );
    });
    setSelectedChapterId(targetChapterId);
    setScreen("book");
  };

  const startEditChapter = () => {
    if (!selectedChapter) return;
    setChapterEditContent(selectedChapter.content.join("\n\n"));
    setIsEditingChapter(true);
  };

  const saveChapterEdit = () => {
    if (!selectedChapter) return;
    const paragraphs = chapterEditContent
      .split(/\n{2,}/)
      .map((item) => item.trim())
      .filter(Boolean);

    if (!paragraphs.length) return;

    setChapters((prev) =>
      prev.map((chapter) =>
        chapter.id === selectedChapter.id
          ? {
              ...chapter,
              content: paragraphs,
              summary:
                paragraphs[0].slice(0, 48) + (paragraphs[0].length > 48 ? "…" : ""),
              status: "已更新",
            }
          : chapter
      )
    );
    setIsEditingChapter(false);
  };

  const applyFilters = () => {
    setSelectedFilters([
      pendingFilters.topic,
      pendingFilters.era,
      pendingFilters.keyword,
    ]);
    setFilterOpen(false);
  };

  const publishSelectedChapter = async () => {
    if (!selectedChapter) return;
    setCommunityHint("");
    try {
      const response = await fetch("/api/community/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterId: selectedChapter.id }),
      });
      const data = await response.json();
      if (!response.ok) {
        setCommunityHint(data.message || "发布失败，请稍后再试。");
        return;
      }
      setCommunityWorks(data.communityWorks || []);
      setSelectedWorkId(data.published?.id || "");
      setCommunityHint(data.message || "已发布到社区。");
    } catch {
      setCommunityHint("发布失败，请稍后再试。");
    }
  };

  const handleLogin = async () => {
    setLoginError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginForm),
      });
      const data = await response.json();
      if (!response.ok) {
        setLoginError(data.message || "登录失败");
        return;
      }
      setAuthUsername(data.username);
      setCommunityWorks([]);
      setSelectedWorkId("");
      setAuthStatus("authenticated");
      setHasLoadedState(false);
    } catch {
      setLoginError("登录失败，请稍后再试");
    }
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setAuthStatus("unauthenticated");
    setHasLoadedState(false);
    setLoginError("");
  };

  const tabActive = (key: ScreenKey) => {
    if (screen === "chapter-1" || screen === "chapter-2") return key === "book";
    if (screen === "work") return key === "community";
    if (screen === "chat-random" || screen === "chat-direct" || screen === "chat-continue" || screen === "result" || screen === "start")
      return key === "home";
    return screen === key;
  };

  return (
    <main className="demo-shell">
      <section className="app-stage">
        <div className="phone">
          <div className="phone-screen">
            {authStatus === "loading" && (
              <div className="auth-screen">
                <div className="soft-card auth-card">
                  <strong className="section-title">正在打开落卷…</strong>
                  <p>正在检查登录状态，请稍等。</p>
                </div>
              </div>
            )}

            {authStatus === "unauthenticated" && (
              <div className="auth-screen">
                <div className="hero-card">
                  <div className="hero-media small">
                    <img src="/assets/home_hero.jpg" alt="落卷欢迎图" />
                  </div>
                  <h2>欢迎回到落卷</h2>
                  <p>你和亲友各有一个独立账号，书稿互不互通。只有发布到社区的作品才能互相看到。</p>
                </div>
                <div className="soft-card auth-card">
                  <strong className="section-title">登录</strong>
                  <div className="auth-form">
                    <input
                      className="auth-input"
                      placeholder="账号"
                      value={loginForm.username}
                      onChange={(event) =>
                        setLoginForm((prev) => ({ ...prev, username: event.target.value }))
                      }
                    />
                    <input
                      className="auth-input"
                      type="password"
                      placeholder="密码"
                      value={loginForm.password}
                      onChange={(event) =>
                        setLoginForm((prev) => ({ ...prev, password: event.target.value }))
                      }
                    />
                  </div>
                  
                  {loginError ? <p className="auth-error">{loginError}</p> : null}
                  <button className="main-btn" onClick={handleLogin}>
                    进入落卷
                  </button>
                </div>
              </div>
            )}

            {authStatus === "authenticated" && !hasLoadedState && (
              <div className="auth-screen">
                <div className="soft-card auth-card">
                  <strong>正在加载你的回忆…</strong>
                  <p>正在从云端同步数据，请稍等。</p>
                </div>
              </div>
            )}

            {authStatus === "authenticated" && hasLoadedState && (
              <>
            {screen === "home" && (
              <div className="screen-view active">
                <div className="topbar">
                  <div className="topbar-left">
                    <div className="title-stack">
                      <small>{easyAccessMode ? "" : currentAccount?.displayName || authUsername}</small>
                      <strong>落卷</strong>
                    </div>
                  </div>
                  {easyAccessMode ? (
                    <button className="avatar-btn" aria-label="个人设置" />
                  ) : (
                    <button className="icon-btn" onClick={handleLogout}>
                      退出
                    </button>
                  )}
                </div>

                <div className="hero-card" style={{ textAlign: "center" }}>
                  <div className="hero-media">
                    <img src="/assets/home_hero.jpg" alt="落卷" />
                  </div>
                  <h2>慢慢写下你的一生。</h2>
                  <p>把想留下的那一段，慢慢讲成一本书。</p>
                </div>

                {hasContinueProgress ? (
                  <button className="main-btn" onClick={() => openChatMode("continue")}>
                    继续写
                  </button>
                ) : (
                  <button className="main-btn" onClick={() => goToScreen("start")}>
                    开始写
                  </button>
                )}

                {hasChapterProgress && currentProgressChapter ? (
                  <div className="soft-card" style={{ display: "grid", gap: 8 }}>
                    <div className="subtitle">当前进度</div>
                    <div className="book-layout">
                      <div className="book-cover">
                        <img src="/assets/station_lunchbox_cover.jpg" alt="书封" />
                      </div>
                      <div>
                        <strong>{bookTitle}</strong>
                        <p style={{ fontSize: 12, margin: "4px 0 0" }}>
                          {currentProgressChapter.title}
                        </p>
                        <p style={{ fontSize: 11, margin: "2px 0 0", color: "var(--muted)" }}>
                          {hasChapterProgress ? `已写 ${chapters.length} 章` : ""}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : hasDraftProgress ? (
                  <div className="soft-card">
                    <div className="subtitle">当前进度</div>
                    <p style={{ margin: "6px 0 0" }}>{draft.content}</p>
                  </div>
                ) : null}

                <div className="split-grid">
                  <button className="soft-card action-card" onClick={() => goToScreen("start")}>
                    <strong>开启新回忆</strong>
                    <p>开启一段新的讲述</p>
                  </button>
                  <button className="soft-card action-card" onClick={() => goToScreen("book")}>
                    <strong>{chapters.length > 0 ? "浏览书稿" : "看看成书"}</strong>
                    <p>{chapters.length > 0 ? `共 ${chapters.length} 章` : "你的回忆会在这里变成一本书"}</p>
                  </button>
                </div>

                <BottomTabs active={tabActive} onNavigate={goToScreen} />
              </div>
            )}

            {screen === "start" && (
              <div className="screen-view active">
                <Header
                  title="选择开始方式"
                  subtitle="新章节"
                  back={() => goToScreen("home")}
                  actionLabel="退出"
                  onAction={handleLogout}
                />
                <div className="soft-card">
                  <div className="hero-media small">
                    <img src="/assets/start_modes_clean.jpg" alt="开始方式视觉图" />
                  </div>
                  <strong className="section-title">每个新章节，都从这里开始</strong>
                  <p>你可以先让 AI 发问，也可以直接开口讲。两种方式都会进入同一条回忆链路，但页面状态不同。</p>
                </div>
                <button className="mode-card" onClick={() => openChatMode("random")}>
                  <strong>随机提问</strong>
                  <p>适合不知道从哪里开始的时候。先接住一个问题，再顺着讲下去。</p>
                  <span className="hint">推荐起步方式</span>
                </button>
                <button className="mode-card" onClick={() => openChatMode("direct")}>
                  <strong>主动讲述</strong>
                  <p>如果你已经知道要讲什么，就直接开口，AI 会顺着你的话继续追问。</p>
                </button>
                <BottomTabs active={tabActive} onNavigate={goToScreen} />
              </div>
            )}

            {(screen === "chat-random" ||
              screen === "chat-direct" ||
              screen === "chat-continue") && (
              <div className="screen-view active">
                <Header
                  title={getChatHeaderTitle({
                    mode: currentMode,
                    draftTitle: draft.title,
                    selectedChapterTitle: selectedChapter?.title,
                    hasChapterProgress,
                  })}
                  subtitle={
                    currentMode === "random"
                      ? "随机提问"
                      : currentMode === "direct"
                      ? "主动讲述"
                      : "继续补写"
                  }
                  back={() => goToScreen(currentMode === "continue" ? "book" : "start")}
                  actionLabel="退出"
                  onAction={handleLogout}
                />

                <div className="bubble-list">
                  {activeMessages.map((message) => (
                    <div
                      key={message.id}
                      className={`bubble ${message.role === "ai" ? "ai" : "user"}`}
                    >
                      {message.content}
                      {message.meta && <small>{message.meta}</small>}
                    </div>
                  ))}
                </div>

                <div className="composer">
                  <div className="voice-box">
                    <div className="record-meta">
                      <strong>
                        {currentMode === "random"
                          ? "回答这个问题"
                          : currentMode === "direct"
                          ? "继续讲这一段"
                          : "继续补写这一章"}
                      </strong>
                    </div>
                    <textarea
                      className="composer-input"
                      placeholder={
                        currentMode === "direct"
                          ? "直接把你想讲的那段写下来…"
                          : "输入这一轮你想说的话…"
                      }
                      value={activeInput}
                      onChange={(event) =>
                        setDraftInput((prev) => ({
                          ...prev,
                          [currentMode]: event.target.value,
                        }))
                      }
                    />
                    <div className="composer-actions single-main">
                      <button className="main-btn" onClick={handleSend}>
                        发送
                      </button>
                    </div>
                    <div className="composer-actions">
                      <button className="ghost-btn" onClick={clearCurrentConversation}>
                        清空本轮会话
                      </button>
                      <button className="ghost-btn" onClick={finishRound}>
                        结束本轮会话
                      </button>
                    </div>
                  </div>
                </div>

                <BottomTabs active={tabActive} onNavigate={goToScreen} />
              </div>
            )}

            {screen === "result" && (
              <div className="screen-view active">
                <Header
                  title="整理结果"
                  subtitle="本轮成稿"
                  back={() => openChatMode(currentMode)}
                  actionLabel="退出"
                  onAction={handleLogout}
                />
                <div className="result-card">
                  <div className="hero-media small">
                    <img src="/assets/chapter_apricot.jpg" alt="章节意象图" />
                  </div>
                  <div className="subtitle">章节标题</div>
                  <h3>{draft.title}</h3>
                  {draftParagraphs.length ? (
                    draftParagraphs.map((paragraph) => (
                      <p key={paragraph} className="draft-paragraph">
                        {paragraph}
                      </p>
                    ))
                  ) : (
                    <p>{draft.content}</p>
                  )}
                  <div className="meta-row">
                    {draft.tags.map((tag) => (
                      <span key={tag} className="tiny-tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="detail-actions">
                  <button className="secondary-btn" onClick={() => openChatMode(currentMode)}>
                    继续补充这一段
                  </button>
                  <button className="secondary-btn" onClick={organizeDraft} disabled={isOrganizing}>
                    {isOrganizing ? "整理中…" : "整理成稿"}
                  </button>
                </div>
                <div className="detail-actions">
                  <button className="secondary-btn danger-btn" onClick={deleteDraftPreview}>
                    删除预览稿
                  </button>
                </div>
                {organizeHint ? <p className="share-hint">{organizeHint}</p> : null}
                <div className="detail-actions single-main">
                  <button className="main-btn" onClick={saveDraftToBook}>
                    收录进书
                  </button>
                </div>
                <BottomTabs active={tabActive} onNavigate={goToScreen} />
              </div>
            )}

            {screen === "book" && (
              <div className="screen-view active">
                <Header
                  title="成书进度"
                  subtitle="章节管理"
                  actionLabel="退出"
                  onAction={handleLogout}
                />
                <div className="book-hero">
                  <div className="book-hero-image">
                    <img src="/assets/book_overview_clean.jpg" alt="成书氛围图" />
                  </div>
                  <div className="book-layout">
                    <div className="book-cover">
                      <img src="/assets/station_lunchbox_cover.jpg" alt="铝饭盒封面" />
                    </div>
                    <div>
                      <h3>{`当前章节数：${chapters.length}`}</h3>
                      <p>
                        {chapters.length
                          ? `最近更新的是《${currentProgressChapter?.title ?? "这一章"}》。你可以继续补写已有章节，也可以直接开启下一章。`
                          : "你还没有创建章节。可以先开启新篇章，完成第一段回忆后再收录进书。"}
                      </p>
                    </div>
                  </div>
                </div>
                {hasPreviewContent && (
                  <div className="result-card book-preview-card">
                    <div className="subtitle">成书预览</div>
                    <h3>{previewTitle}</h3>
                    {draftParagraphs.length > 1 ? (
                      draftParagraphs.slice(0, 2).map((paragraph) => (
                        <p key={paragraph} className="draft-paragraph">
                          {paragraph}
                        </p>
                      ))
                    ) : (
                      <p>{previewSummary}</p>
                    )}
                    <div className="meta-row">
                      <span className="tiny-tag">{hasChapterProgress ? "最新草稿" : "第一章预览"}</span>
                      <span className="tiny-tag">{draft.tags.length ? draft.tags.join(" / ") : "待继续补充"}</span>
                    </div>
                    <div className="detail-actions">
                      <button className="secondary-btn" onClick={organizeDraft} disabled={isOrganizing}>
                        {isOrganizing ? "整理中…" : "整理成稿"}
                      </button>
                      <button className="secondary-btn" onClick={() => openChatMode("continue")}>
                        继续补充
                      </button>
                    </div>
                    <div className="detail-actions">
                      <button className="secondary-btn danger-btn" onClick={deleteDraftPreview}>
                        删除预览稿
                      </button>
                    </div>
                    <div className="detail-actions single-main">
                      <button className="main-btn" onClick={saveDraftToBook}>
                        收录进书
                      </button>
                    </div>
                  </div>
                )}
                {organizeHint ? <p className="share-hint">{organizeHint}</p> : null}
                {chapters.length ? (
                  <div className="stack">
                    {chapters.map((chapter, index) => (
                      <button
                        key={chapter.id}
                        className="chapter-card chapter-directory-card"
                        onClick={() => openChapter(chapter.id)}
                      >
                        <div className="directory-row">
                          <div className="directory-number">{String(index + 1).padStart(2, "0")}</div>
                          <div className="directory-main">
                            <div className="row-between directory-head">
                              <strong className="directory-title">{chapter.title}</strong>
                              <span className="state">{chapter.status}</span>
                            </div>
                            <p className="directory-summary">{chapter.summary}</p>
                            <div className="directory-meta">
                              <span>{`${chapter.content.length} 段内容`}</span>
                              <span>查看详情</span>
                              <span>继续补写</span>
                            </div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="detail-note">
                    <strong>还没有章节</strong>
                    <p>先从一次回忆开始。完成第一轮讲述并点击“收录进书”后，这里就会出现第一章。</p>
                  </div>
                )}
                <div className="detail-actions">
                  <button
                    className="secondary-btn"
                    onClick={() => exportBook("docx")}
                    disabled={!chapters.length && !draft.content.trim()}
                  >
                    分享 Word
                  </button>
                  <button
                    className="secondary-btn"
                    onClick={() => exportBook("pdf")}
                    disabled={!chapters.length && !draft.content.trim()}
                  >
                    分享 PDF
                  </button>
                </div>
                {shareHint ? <p className="share-hint">{shareHint}</p> : null}
                <button className="main-btn" onClick={() => goToScreen("start")}>
                  开启新篇章
                </button>
                <BottomTabs active={tabActive} onNavigate={goToScreen} />
              </div>
            )}

            {(screen === "chapter-1" || screen === "chapter-2") && selectedChapter && (
              <div className="screen-view active">
                <Header
                  title={selectedChapter.title}
                  subtitle="章节详情"
                  back={() => goToScreen("book")}
                  actionLabel="退出"
                  onAction={handleLogout}
                />
                <div className="result-card">
                  <div className="hero-media small">
                    <img src={selectedChapter.cover} alt={selectedChapter.title} />
                  </div>
                  <div className="subtitle">
                    {selectedChapter.id === "chapter-1" ? "章节 1" : "章节 2"}
                  </div>
                  <h3>{selectedChapter.title}</h3>
                  {isEditingChapter ? (
                    <textarea
                      className="chapter-editor"
                      value={chapterEditContent}
                      onChange={(event) => setChapterEditContent(event.target.value)}
                    />
                  ) : (
                    selectedChapter.content.map((paragraph) => <p key={paragraph}>{paragraph}</p>)
                  )}
                  <div className="meta-row">
                    {selectedChapter.tags.map((tag) => (
                      <span key={tag} className="tiny-tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="detail-note">
                  <strong>章节备注</strong>
                  <p>{selectedChapter.note}</p>
                </div>
                <div className="detail-actions">
                  {isEditingChapter ? (
                    <button className="secondary-btn" onClick={saveChapterEdit}>
                      保存修改
                    </button>
                  ) : (
                    <button className="secondary-btn" onClick={startEditChapter}>
                      改这一段
                    </button>
                  )}
                  <button className="secondary-btn" onClick={() => openChatMode("continue")}>
                    继续补写
                  </button>
                </div>
                <div className="detail-actions">
                  <button className="secondary-btn" onClick={publishSelectedChapter}>
                    发布到社区
                  </button>
                  <button className="secondary-btn danger-btn" onClick={deleteCurrentChapter}>
                    删除这一章
                  </button>
                </div>
                {communityHint ? <p className="share-hint">{communityHint}</p> : null}
                <BottomTabs active={tabActive} onNavigate={goToScreen} />
              </div>
            )}

            {screen === "community" && (
              <div className="screen-view active">
                <Header
                  title="看看别人的书"
                  subtitle="社区"
                  actionLabel="退出"
                  onAction={handleLogout}
                />
                {communityWorks.length ? (
                  <>
                    <div className="detail-note">
                      <strong>社区已开放</strong>
                      <p>这里会显示你和亲友已经发布出来的章节作品。私有书稿各自独立，不会混进对方的成书页。</p>
                    </div>
                    <div className="stack">
                      {communityWorks.map((work) => (
                        <button
                          key={work.id}
                          className="chapter-card chapter-directory-card"
                          onClick={() => {
                            setSelectedWorkId(work.id);
                            goToScreen("work");
                          }}
                        >
                          <div className="directory-row">
                            <div className="directory-number">{work.authorLabel}</div>
                            <div className="directory-main">
                              <div className="row-between directory-head">
                                <strong className="directory-title">{work.title}</strong>
                                <span className="state">{work.authorName}</span>
                              </div>
                              <p className="directory-summary">{work.summary}</p>
                              <div className="directory-meta">
                                <span>{`${work.content.length} 段内容`}</span>
                                <span>{work.tags.join(" / ") || "回忆录"}</span>
                                <span>看作品</span>
                              </div>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="detail-note">
                    <strong>社区里还没有作品</strong>
                    <p>先在章节详情页点击"发布到社区"。发布后，你和亲友都能在这里看到彼此发布的作品。</p>
                  </div>
                )}
                <BottomTabs active={tabActive} onNavigate={goToScreen} />
              </div>
            )}

            {screen === "work" && selectedWork && (
              <div className="screen-view active">
                <Header
                  title={selectedWork.title}
                  subtitle="看作品"
                  back={() => goToScreen("community")}
                  actionLabel="退出"
                  onAction={handleLogout}
                />
                <div className="result-card">
                  <div className="hero-media small">
                    <img src={selectedWork.cover} alt={selectedWork.title} />
                  </div>
                  <div className="subtitle">社区作品</div>
                  <h3>{selectedWork.title}</h3>
                  {selectedWork.content.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                  <div className="meta-row">
                    {selectedWork.tags.map((tag) => (
                      <span key={tag} className="tiny-tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="detail-note">
                  <strong>作者小记</strong>
                  <p>{`${selectedWork.authorName}（${selectedWork.authorLabel}）`}。这篇作品来自对方账号发布到社区的章节内容。</p>
                </div>
                <div className="detail-actions">
                  <button className="secondary-btn" onClick={() => goToScreen("community")}>
                    返回社区
                  </button>
                </div>
                <BottomTabs active={tabActive} onNavigate={goToScreen} />
              </div>
            )}

            {filterOpen && (
              <div className="filter-modal" onClick={() => setFilterOpen(false)}>
                <div className="filter-sheet" onClick={(event) => event.stopPropagation()}>
                  <h4>筛选作品</h4>
                  <FilterGroup
                    title="专题"
                    value={pendingFilters.topic}
                    onChange={(value) =>
                      setPendingFilters((prev) => ({ ...prev, topic: value }))
                    }
                    options={["第一次离家", "家庭记忆", "旧工厂"]}
                  />
                  <FilterGroup
                    title="年代"
                    value={pendingFilters.era}
                    onChange={(value) =>
                      setPendingFilters((prev) => ({ ...prev, era: value }))
                    }
                    options={["80年代", "90年代", "千禧年"]}
                  />
                  <FilterGroup
                    title="主题词"
                    value={pendingFilters.keyword}
                    onChange={(value) =>
                      setPendingFilters((prev) => ({ ...prev, keyword: value }))
                    }
                    options={["工厂", "站台", "家书"]}
                  />
                  <div className="detail-actions">
                    <button className="secondary-btn" onClick={() => setFilterOpen(false)}>
                      取消
                    </button>
                    <button className="main-btn" onClick={applyFilters}>
                      确认筛选
                    </button>
                  </div>
                </div>
              </div>
            )}
              </>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function Header({
  title,
  subtitle,
  back,
  actionLabel,
  onAction,
}: {
  title: string;
  subtitle: string;
  back?: () => void;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="topbar">
      <div className="topbar-left">
        {back ? (
          <button className="icon-btn" onClick={back}>
            返回
          </button>
        ) : null}
        <div className="title-stack">
          <small>{subtitle}</small>
          <strong>{title}</strong>
        </div>
      </div>
      {actionLabel && onAction ? (
        <button className="icon-btn" onClick={onAction}>
          {actionLabel}
        </button>
      ) : (
        <button className="avatar-btn" aria-label="个人设置" />
      )}
    </div>
  );
}

function BottomTabs({
  active,
  onNavigate,
}: {
  active: (key: ScreenKey) => boolean;
  onNavigate: (key: ScreenKey) => void;
}) {
  return (
    <div className="bottom-nav">
      {[
        ["home", "首页", "home"],
        ["book", "成书", "book"],
        ["community", "社区", "community"],
      ].map(([key, label, icon]) => (
        <button
          key={key}
          className={`tab ${active(key as ScreenKey) ? "active" : ""}`}
          onClick={() => onNavigate(key as ScreenKey)}
        >
          <span className="tab-icon" aria-hidden="true">
            <NavIcon type={icon as "home" | "book" | "community"} />
          </span>
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

function NavIcon({ type }: { type: "home" | "book" | "community" }) {
  if (type === "home") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
        <path d="M4 10.5 12 4l8 6.5" />
        <path d="M6.5 9.5V19h11V9.5" />
        <path d="M10 19v-5h4v5" />
      </svg>
    );
  }

  if (type === "book") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
        <path d="M6 5.5A2.5 2.5 0 0 1 8.5 3H19v16H8.5A2.5 2.5 0 0 0 6 21.5z" />
        <path d="M6 5.5v16" />
        <path d="M9.5 7.5h6" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M7.5 9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
      <path d="M16.5 10.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
      <path d="M4.5 18a3 3 0 0 1 6 0" />
      <path d="M13 18a3 3 0 0 1 6 0" />
      <path d="M9.5 18a3.5 3.5 0 0 1 7 0" />
    </svg>
  );
}

function FilterGroup({
  title,
  value,
  onChange,
  options,
}: {
  title: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <div className="filter-group">
      <strong>{title}</strong>
      <div className="filter-options">
        {options.map((option) => (
          <button
            key={option}
            className={`filter-option ${value === option ? "active" : ""}`}
            onClick={() => onChange(option)}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}
