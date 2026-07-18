import type { ChatMode, Message } from "@/lib/demo-content";

export type DraftState = {
  title: string;
  content: string;
  tags: string[];
};

export type StoredChapter = {
  id: string;
  title: string;
  status: string;
  summary: string;
  content: string[];
  tags: string[];
  note: string;
  cover: string;
};

export type CommunityWork = {
  id: string;
  sourceChapterId: string;
  title: string;
  authorUsername: string;
  authorName: string;
  authorLabel: string;
  summary: string;
  content: string[];
  tags: string[];
  cover: string;
  publishedAt: string;
};

export type AppState = {
  bookTitle: string;
  currentChapterId: string;
  selectedFilters: string[];
  draft: DraftState;
  chapters: StoredChapter[];
  conversations: Record<ChatMode, Message[]>;
  updatedAt: string;
};

export function createDefaultAppState(): AppState {
  return {
    bookTitle: "我的回忆录",
    currentChapterId: "",
    selectedFilters: [],
    draft: {
      title: "",
      content: "",
      tags: [],
    },
    chapters: [],
    conversations: {
      random: [],
      direct: [],
      continue: [],
    },
    updatedAt: new Date().toISOString(),
  };
}

export function createEmptyCommunityWorks(): CommunityWork[] {
  return [];
}
