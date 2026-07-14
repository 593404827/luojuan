import { promises as fs } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createDefaultAppState, type AppState } from "@/lib/app-state";

const STORAGE_DIR = path.join(process.cwd(), "data");
const STORAGE_FILE = path.join(STORAGE_DIR, "luojuan-app-state.json");

const messageSchema = z.object({
  id: z.string(),
  role: z.enum(["ai", "user"]),
  content: z.string(),
  meta: z.string().optional(),
});

const chapterSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  summary: z.string(),
  content: z.array(z.string()),
  tags: z.array(z.string()),
  note: z.string(),
  cover: z.string(),
});

const appStateSchema: z.ZodType<AppState> = z.object({
  bookTitle: z.string(),
  currentChapterId: z.string(),
  selectedFilters: z.array(z.string()),
  draft: z.object({
    title: z.string(),
    content: z.string(),
    tags: z.array(z.string()),
  }),
  chapters: z.array(chapterSchema),
  conversations: z.object({
    random: z.array(messageSchema),
    direct: z.array(messageSchema),
    continue: z.array(messageSchema),
  }),
  updatedAt: z.string(),
});

type SupabaseBookRow = {
  id: string;
  title: string;
  current_chapter_id: string;
  selected_filters: string[] | null;
  draft_title: string | null;
  draft_content: string | null;
  draft_tags: string[] | null;
  updated_at: string;
};

type SupabaseChapterRow = {
  id: string;
  title: string;
  status: string;
  summary: string;
  content: string[] | null;
  tags: string[] | null;
  note: string | null;
  cover: string | null;
};

type SupabaseConversationRow = {
  mode: "random" | "direct" | "continue";
  messages: AppState["conversations"]["random"];
};

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return null;
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function ensureLocalDir() {
  await fs.mkdir(STORAGE_DIR, { recursive: true });
}

async function readLocalState(): Promise<AppState> {
  try {
    const raw = await fs.readFile(STORAGE_FILE, "utf8");
    return appStateSchema.parse(JSON.parse(raw));
  } catch {
    const initial = createDefaultAppState();
    await writeLocalState(initial);
    return initial;
  }
}

async function writeLocalState(state: AppState) {
  await ensureLocalDir();
  await fs.writeFile(
    STORAGE_FILE,
    JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2),
    "utf8"
  );
}

function composeStateFromRows(
  book: SupabaseBookRow,
  chapters: SupabaseChapterRow[],
  conversations: SupabaseConversationRow[]
): AppState {
  const initial = createDefaultAppState();
  return {
    bookTitle: book.title,
    currentChapterId: book.current_chapter_id,
    selectedFilters: book.selected_filters ?? initial.selectedFilters,
    draft: {
      title: book.draft_title ?? initial.draft.title,
      content: book.draft_content ?? initial.draft.content,
      tags: book.draft_tags ?? initial.draft.tags,
    },
    chapters: chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      status: chapter.status,
      summary: chapter.summary,
      content: chapter.content ?? [],
      tags: chapter.tags ?? [],
      note: chapter.note ?? "",
      cover: chapter.cover ?? "/assets/chapter_apricot.jpg",
    })),
    conversations: {
      random:
        conversations.find((item) => item.mode === "random")?.messages ??
        initial.conversations.random,
      direct:
        conversations.find((item) => item.mode === "direct")?.messages ??
        initial.conversations.direct,
      continue:
        conversations.find((item) => item.mode === "continue")?.messages ??
        initial.conversations.continue,
    },
    updatedAt: book.updated_at,
  };
}

export async function loadAppState(): Promise<AppState> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return readLocalState();
  }

  const { data: bookRows, error: bookError } = await supabase
    .from("books")
    .select("*")
    .limit(1);

  if (bookError || !bookRows || bookRows.length === 0) {
    const initial = createDefaultAppState();
    await saveAppState(initial);
    return initial;
  }

  const book = bookRows[0] as SupabaseBookRow;

  const [{ data: chapterRows, error: chapterError }, { data: conversationRows, error: conversationError }] =
    await Promise.all([
      supabase.from("chapters").select("*").eq("book_id", book.id).order("id"),
      supabase.from("conversations").select("mode, messages").eq("book_id", book.id),
    ]);

  if (chapterError || conversationError) {
    return readLocalState();
  }

  return composeStateFromRows(
    book,
    (chapterRows ?? []) as SupabaseChapterRow[],
    (conversationRows ?? []) as SupabaseConversationRow[]
  );
}

export async function saveAppState(nextState: AppState) {
  const state = appStateSchema.parse({
    ...nextState,
    updatedAt: new Date().toISOString(),
  });

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    await writeLocalState(state);
    return state;
  }

  const bookId = "book-main";
  await supabase.from("books").upsert(
    {
      id: bookId,
      title: state.bookTitle,
      current_chapter_id: state.currentChapterId,
      selected_filters: state.selectedFilters,
      draft_title: state.draft.title,
      draft_content: state.draft.content,
      draft_tags: state.draft.tags,
      updated_at: state.updatedAt,
    },
    { onConflict: "id" }
  );

  await supabase.from("chapters").delete().eq("book_id", bookId);
  await supabase.from("chapters").insert(
    state.chapters.map((chapter) => ({
      book_id: bookId,
      id: chapter.id,
      title: chapter.title,
      status: chapter.status,
      summary: chapter.summary,
      content: chapter.content,
      tags: chapter.tags,
      note: chapter.note,
      cover: chapter.cover,
    }))
  );

  await supabase.from("conversations").delete().eq("book_id", bookId);
  await supabase.from("conversations").insert(
    (Object.entries(state.conversations) as Array<
      [SupabaseConversationRow["mode"], SupabaseConversationRow["messages"]]
    >).map(([mode, messages]) => ({
      book_id: bookId,
      mode,
      messages,
    }))
  );

  return state;
}

export { appStateSchema };
