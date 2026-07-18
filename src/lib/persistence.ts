import { promises as fs } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  createDefaultAppState,
  createEmptyCommunityWorks,
  type AppState,
  type CommunityWork,
  type StoredChapter,
} from "@/lib/app-state";
import { getAccountByUsername } from "@/lib/auth";

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

const communityWorkSchema: z.ZodType<CommunityWork> = z.object({
  id: z.string(),
  sourceChapterId: z.string(),
  title: z.string(),
  authorUsername: z.string(),
  authorName: z.string(),
  authorLabel: z.string(),
  summary: z.string(),
  content: z.array(z.string()),
  tags: z.array(z.string()),
  cover: z.string(),
  publishedAt: z.string(),
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

const localStoreSchema = z.object({
  users: z.record(z.string(), appStateSchema).default({}),
  communityWorks: z.array(communityWorkSchema).default([]),
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

type SupabaseCommunityWorkRow = {
  id: string;
  source_chapter_id: string;
  title: string;
  author_username: string;
  author_name: string;
  author_label: string;
  summary: string;
  content: string[] | null;
  tags: string[] | null;
  cover: string | null;
  published_at: string;
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

type LocalStore = z.infer<typeof localStoreSchema>;

function createInitialStateForUser(username: string): AppState {
  const initial = createDefaultAppState();
  const profile = getAccountByUsername(username);
  return {
    ...initial,
    bookTitle: profile?.bookTitle || initial.bookTitle,
    updatedAt: new Date().toISOString(),
  };
}

async function readLocalStore(): Promise<LocalStore> {
  try {
    const raw = await fs.readFile(STORAGE_FILE, "utf8");
    return localStoreSchema.parse(JSON.parse(raw));
  } catch {
    const initialStore: LocalStore = {
      users: {},
      communityWorks: createEmptyCommunityWorks(),
      updatedAt: new Date().toISOString(),
    };
    await writeLocalStore(initialStore);
    return initialStore;
  }
}

async function writeLocalStore(store: LocalStore) {
  await ensureLocalDir();
  await fs.writeFile(
    STORAGE_FILE,
    JSON.stringify({ ...store, updatedAt: new Date().toISOString() }, null, 2),
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

export async function loadAppState(username: string): Promise<AppState> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    const store = await readLocalStore();
    const state = store.users[username];
    if (state) return appStateSchema.parse(state);
    const initial = createInitialStateForUser(username);
    store.users[username] = initial;
    await writeLocalStore(store);
    return initial;
  }

  const bookId = `book-${username}`;

  const { data: bookRows, error: bookError } = await supabase
    .from("books")
    .select("*")
    .eq("id", bookId)
    .limit(1);

  if (bookError || !bookRows || bookRows.length === 0) {
    const initial = createInitialStateForUser(username);
    await saveAppState(username, initial);
    return initial;
  }

  const book = bookRows[0] as SupabaseBookRow;

  const [{ data: chapterRows, error: chapterError }, { data: conversationRows, error: conversationError }] =
    await Promise.all([
      supabase.from("chapters").select("*").eq("book_id", book.id).order("id"),
      supabase.from("conversations").select("mode, messages").eq("book_id", book.id),
    ]);

  if (chapterError || conversationError) {
    return createInitialStateForUser(username);
  }

  return composeStateFromRows(
    book,
    (chapterRows ?? []) as SupabaseChapterRow[],
    (conversationRows ?? []) as SupabaseConversationRow[]
  );
}

export async function saveAppState(username: string, nextState: AppState) {
  const state = appStateSchema.parse({
    ...nextState,
    updatedAt: new Date().toISOString(),
  });

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    const store = await readLocalStore();
    store.users[username] = state;
    await writeLocalStore(store);
    return state;
  }

  const bookId = `book-${username}`;
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

export async function loadCommunityWorks(): Promise<CommunityWork[]> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from("community_works")
      .select("*")
      .order("published_at", { ascending: false });
    if (error) return [];
    return ((data ?? []) as SupabaseCommunityWorkRow[]).map((row) => ({
      id: row.id,
      sourceChapterId: row.source_chapter_id,
      title: row.title,
      authorUsername: row.author_username,
      authorName: row.author_name,
      authorLabel: row.author_label,
      summary: row.summary,
      content: row.content ?? [],
      tags: row.tags ?? [],
      cover: row.cover ?? "/assets/chapter_apricot.jpg",
      publishedAt: row.published_at,
    }));
  }
  // 回退到本地 JSON
  const store = await readLocalStore();
  return [...store.communityWorks].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export async function publishChapterToCommunity(username: string, chapter: StoredChapter) {
  const supabase = getSupabaseAdmin();
  const account = getAccountByUsername(username);
  const workId = `${username}-${chapter.id}`;
  const now = new Date().toISOString();

  if (supabase) {
    await supabase.from("community_works").upsert(
      {
        id: workId,
        source_chapter_id: chapter.id,
        book_id: `book-${username}`,
        title: chapter.title,
        author_username: username,
        author_name: account?.displayName || username,
        author_label: account?.authorLabel || username,
        summary: chapter.summary,
        content: chapter.content,
        tags: chapter.tags,
        cover: chapter.cover,
        published_at: now,
      },
      { onConflict: "id" }
    );

    // 重新加载最新的社区作品列表
    const { data } = await supabase
      .from("community_works")
      .select("*")
      .order("published_at", { ascending: false });

    return {
      id: workId,
      sourceChapterId: chapter.id,
      title: chapter.title,
      authorUsername: username,
      authorName: account?.displayName || username,
      authorLabel: account?.authorLabel || username,
      summary: chapter.summary,
      content: chapter.content,
      tags: chapter.tags,
      cover: chapter.cover,
      publishedAt: now,
    } as CommunityWork;
  }

  // 回退到本地 JSON
  const store = await readLocalStore();
  const nextWork: CommunityWork = {
    id: workId,
    sourceChapterId: chapter.id,
    title: chapter.title,
    authorUsername: username,
    authorName: account?.displayName || username,
    authorLabel: account?.authorLabel || username,
    summary: chapter.summary,
    content: chapter.content,
    tags: chapter.tags,
    cover: chapter.cover,
    publishedAt: now,
  };

  const nextWorks = store.communityWorks.filter((item) => item.id !== nextWork.id);
  nextWorks.unshift(nextWork);
  store.communityWorks = nextWorks;
  await writeLocalStore(store);
  return nextWork;
}

export { appStateSchema };
