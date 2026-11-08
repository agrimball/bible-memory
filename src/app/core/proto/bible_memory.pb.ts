/**
 * Generated & canonical Proto3 / ProtoJSON TypeScript bindings for:
 * proto/bible_memory.proto (package biblememory.v1)
 *
 * Follows the official Protobuf v3 JSON Mapping specification:
 * https://protobuf.dev/programming-guides/proto3/#json
 * - proto snake_case fields map to lowerCamelCase in JSON (and accept both on parse)
 * - enums serialize as their proto string names (and accept both string names & numbers on parse)
 * - default/zero values can be emitted or omitted cleanly
 */

export enum CardState {
  CARD_STATE_UNSPECIFIED = 0,
  CARD_STATE_NEW = 1,
  CARD_STATE_LEARNING = 2,
  CARD_STATE_REVIEW = 3,
  CARD_STATE_RELEARNING = 4,
}

export enum ReviewRating {
  REVIEW_RATING_UNSPECIFIED = 0,
  REVIEW_RATING_AGAIN = 1,
  REVIEW_RATING_HARD = 2,
  REVIEW_RATING_GOOD = 3,
  REVIEW_RATING_EASY = 4,
}

export interface Verse {
  verseNumber: number;
  text: string;
  chapterNumber?: number;
}

export interface Passage {
  id: string;
  reference: string;
  verses: Verse[];
  createdAt: string;
  updatedAt: string;
}

export interface Flashcard {
  id: string;
  passageId: string;
  state: CardState;
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  learningStep: number;
  dueAt: string;
  lastReviewedAt: string;
  lapses: number;
  createdAt: string;
  updatedAt: string;
  isRepairCard?: boolean;
  repairVerseNumber?: number;
  repairStreak?: number;
  repairTargetStreak?: number;
  parentCardId?: string;
  repairChapterNumber?: number;
}

export interface ReviewLog {
  id: string;
  cardId: string;
  passageId: string;
  rating: ReviewRating;
  previousState: CardState;
  newState: CardState;
  previousIntervalDays: number;
  newIntervalDays: number;
  easeFactor: number;
  reviewedAt: string;
}

export interface UserDataBundle {
  schemaVersion: number;
  exportedAt: string;
  passages: Passage[];
  flashcards: Flashcard[];
  reviewLogs: ReviewLog[];
}

// ============================================================================
// Cross-Chapter Verse Formatting Helpers
// ============================================================================

export function isMultiChapterPassage(verses: Verse[]): boolean {
  const chapters = new Set<number>();
  for (const v of verses ?? []) {
    if (v.chapterNumber && v.chapterNumber > 0) {
      chapters.add(v.chapterNumber);
      if (chapters.size >= 2) {
        return true;
      }
    }
  }
  return false;
}

export function formatVerseBadge(verse: Verse, multiChapter: boolean): string {
  if (multiChapter && verse.chapterNumber && verse.chapterNumber > 0) {
    return `${verse.chapterNumber}:${verse.verseNumber}`;
  }
  return `v. ${verse.verseNumber}`;
}

export function formatVerseRange(
  firstVerse: Verse,
  lastVerse: Verse,
  multiChapter: boolean
): string {
  const sameChapter = (firstVerse.chapterNumber ?? 0) === (lastVerse.chapterNumber ?? 0);
  if (sameChapter && firstVerse.verseNumber === lastVerse.verseNumber) {
    return formatVerseBadge(firstVerse, multiChapter);
  }
  if (multiChapter && firstVerse.chapterNumber && lastVerse.chapterNumber) {
    if (firstVerse.chapterNumber === lastVerse.chapterNumber) {
      return `${firstVerse.chapterNumber}:${firstVerse.verseNumber}–${lastVerse.verseNumber}`;
    }
    return `${firstVerse.chapterNumber}:${firstVerse.verseNumber}–${lastVerse.chapterNumber}:${lastVerse.verseNumber}`;
  }
  return `v. ${firstVerse.verseNumber}–${lastVerse.verseNumber}`;
}

// ============================================================================
// Canonical ProtoJSON Serialization / Deserialization (Proto3 JSON Spec)
// ============================================================================

export interface VerseProtoJson {
  verseNumber?: number;
  verse_number?: number;
  text?: string;
  chapterNumber?: number;
  chapter_number?: number;
}

export interface PassageProtoJson {
  id?: string;
  reference?: string;
  verses?: VerseProtoJson[];
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
}

export interface FlashcardProtoJson {
  id?: string;
  passageId?: string;
  passage_id?: string;
  state?: string | number;
  easeFactor?: number;
  ease_factor?: number;
  intervalDays?: number;
  interval_days?: number;
  repetitions?: number;
  learningStep?: number;
  learning_step?: number;
  dueAt?: string;
  due_at?: string;
  lastReviewedAt?: string;
  last_reviewed_at?: string;
  lapses?: number;
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
  isRepairCard?: boolean;
  is_repair_card?: boolean;
  repairVerseNumber?: number;
  repair_verse_number?: number;
  repairStreak?: number;
  repair_streak?: number;
  repairTargetStreak?: number;
  repair_target_streak?: number;
  parentCardId?: string;
  parent_card_id?: string;
  repairChapterNumber?: number;
  repair_chapter_number?: number;
}

export interface ReviewLogProtoJson {
  id?: string;
  cardId?: string;
  card_id?: string;
  passageId?: string;
  passage_id?: string;
  rating?: string | number;
  previousState?: string | number;
  previous_state?: string | number;
  newState?: string | number;
  new_state?: string | number;
  previousIntervalDays?: number;
  previous_interval_days?: number;
  newIntervalDays?: number;
  new_interval_days?: number;
  easeFactor?: number;
  ease_factor?: number;
  reviewedAt?: string;
  reviewed_at?: string;
}

export interface UserDataBundleProtoJson {
  schemaVersion?: number;
  schema_version?: number;
  exportedAt?: string;
  exported_at?: string;
  passages?: PassageProtoJson[];
  flashcards?: FlashcardProtoJson[];
  reviewLogs?: ReviewLogProtoJson[];
  review_logs?: ReviewLogProtoJson[];
}

export function cardStateToProtoJson(state: CardState): string {
  return CardState[state] ?? 'CARD_STATE_UNSPECIFIED';
}

export function cardStateFromProtoJson(val: string | number | undefined): CardState {
  if (typeof val === 'number') {
    return val in CardState ? (val as CardState) : CardState.CARD_STATE_UNSPECIFIED;
  }
  if (typeof val === 'string') {
    const mapped = (CardState as unknown as Record<string, number>)[val];
    return typeof mapped === 'number' ? (mapped as CardState) : CardState.CARD_STATE_UNSPECIFIED;
  }
  return CardState.CARD_STATE_UNSPECIFIED;
}

export function reviewRatingToProtoJson(rating: ReviewRating): string {
  return ReviewRating[rating] ?? 'REVIEW_RATING_UNSPECIFIED';
}

export function reviewRatingFromProtoJson(val: string | number | undefined): ReviewRating {
  if (typeof val === 'number') {
    return val in ReviewRating ? (val as ReviewRating) : ReviewRating.REVIEW_RATING_UNSPECIFIED;
  }
  if (typeof val === 'string') {
    const mapped = (ReviewRating as unknown as Record<string, number>)[val];
    return typeof mapped === 'number' ? (mapped as ReviewRating) : ReviewRating.REVIEW_RATING_UNSPECIFIED;
  }
  return ReviewRating.REVIEW_RATING_UNSPECIFIED;
}

export const ProtoJsonCodec = {
  verseToJson(v: Verse): VerseProtoJson {
    const out: VerseProtoJson = {
      verseNumber: v.verseNumber,
      text: v.text,
    };
    if (v.chapterNumber && v.chapterNumber > 0) {
      out.chapterNumber = v.chapterNumber;
    }
    return out;
  },

  verseFromJson(json: VerseProtoJson): Verse {
    const chapterNum = Number(json.chapterNumber ?? json.chapter_number ?? 0);
    const out: Verse = {
      verseNumber: Number(json.verseNumber ?? json.verse_number ?? 0),
      text: String(json.text ?? ''),
    };
    if (chapterNum > 0) {
      out.chapterNumber = chapterNum;
    }
    return out;
  },

  passageToJson(p: Passage): PassageProtoJson {
    return {
      id: p.id,
      reference: p.reference,
      verses: (p.verses ?? []).map((v) => ProtoJsonCodec.verseToJson(v)),
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  },

  passageFromJson(json: PassageProtoJson): Passage {
    return {
      id: String(json.id ?? ''),
      reference: String(json.reference ?? ''),
      verses: Array.isArray(json.verses)
        ? json.verses.map((v) => ProtoJsonCodec.verseFromJson(v))
        : [],
      createdAt: String(json.createdAt ?? json.created_at ?? new Date().toISOString()),
      updatedAt: String(json.updatedAt ?? json.updated_at ?? new Date().toISOString()),
    };
  },

  flashcardToJson(c: Flashcard): FlashcardProtoJson {
    const out: FlashcardProtoJson = {
      id: c.id,
      passageId: c.passageId,
      state: cardStateToProtoJson(c.state),
      easeFactor: c.easeFactor,
      intervalDays: c.intervalDays,
      repetitions: c.repetitions,
      learningStep: c.learningStep,
      dueAt: c.dueAt,
      lastReviewedAt: c.lastReviewedAt,
      lapses: c.lapses,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
    if (c.isRepairCard) {
      out.isRepairCard = true;
      out.repairVerseNumber = c.repairVerseNumber ?? 1;
      out.repairStreak = c.repairStreak ?? 0;
      out.repairTargetStreak = c.repairTargetStreak ?? 3;
      if (c.parentCardId) {
        out.parentCardId = c.parentCardId;
      }
      if (c.repairChapterNumber && c.repairChapterNumber > 0) {
        out.repairChapterNumber = c.repairChapterNumber;
      }
    }
    return out;
  },

  flashcardFromJson(json: FlashcardProtoJson): Flashcard {
    const isRepair = Boolean(json.isRepairCard ?? json.is_repair_card ?? false);
    const card: Flashcard = {
      id: String(json.id ?? ''),
      passageId: String(json.passageId ?? json.passage_id ?? ''),
      state: cardStateFromProtoJson(json.state),
      easeFactor: Number(json.easeFactor ?? json.ease_factor ?? 2.5),
      intervalDays: Number(json.intervalDays ?? json.interval_days ?? 0),
      repetitions: Number(json.repetitions ?? 0),
      learningStep: Number(json.learningStep ?? json.learning_step ?? 0),
      dueAt: String(json.dueAt ?? json.due_at ?? new Date().toISOString()),
      lastReviewedAt: String(json.lastReviewedAt ?? json.last_reviewed_at ?? ''),
      lapses: Number(json.lapses ?? 0),
      createdAt: String(json.createdAt ?? json.created_at ?? new Date().toISOString()),
      updatedAt: String(json.updatedAt ?? json.updated_at ?? new Date().toISOString()),
    };
    if (isRepair) {
      card.isRepairCard = true;
      card.repairVerseNumber = Number(
        json.repairVerseNumber ?? json.repair_verse_number ?? 1
      );
      card.repairStreak = Number(json.repairStreak ?? json.repair_streak ?? 0);
      card.repairTargetStreak = Number(
        json.repairTargetStreak ?? json.repair_target_streak ?? 3
      );
      const parentId = json.parentCardId ?? json.parent_card_id;
      if (parentId) {
        card.parentCardId = String(parentId);
      }
      const repairChap = Number(
        json.repairChapterNumber ?? json.repair_chapter_number ?? 0
      );
      if (repairChap > 0) {
        card.repairChapterNumber = repairChap;
      }
    }
    return card;
  },

  reviewLogToJson(r: ReviewLog): ReviewLogProtoJson {
    return {
      id: r.id,
      cardId: r.cardId,
      passageId: r.passageId,
      rating: reviewRatingToProtoJson(r.rating),
      previousState: cardStateToProtoJson(r.previousState),
      newState: cardStateToProtoJson(r.newState),
      previousIntervalDays: r.previousIntervalDays,
      newIntervalDays: r.newIntervalDays,
      easeFactor: r.easeFactor,
      reviewedAt: r.reviewedAt,
    };
  },

  reviewLogFromJson(json: ReviewLogProtoJson): ReviewLog {
    return {
      id: String(json.id ?? ''),
      cardId: String(json.cardId ?? json.card_id ?? ''),
      passageId: String(json.passageId ?? json.passage_id ?? ''),
      rating: reviewRatingFromProtoJson(json.rating),
      previousState: cardStateFromProtoJson(json.previousState ?? json.previous_state),
      newState: cardStateFromProtoJson(json.newState ?? json.new_state),
      previousIntervalDays: Number(json.previousIntervalDays ?? json.previous_interval_days ?? 0),
      newIntervalDays: Number(json.newIntervalDays ?? json.new_interval_days ?? 0),
      easeFactor: Number(json.easeFactor ?? json.ease_factor ?? 2.5),
      reviewedAt: String(json.reviewedAt ?? json.reviewed_at ?? new Date().toISOString()),
    };
  },

  bundleToJson(b: UserDataBundle): UserDataBundleProtoJson {
    return {
      schemaVersion: b.schemaVersion,
      exportedAt: b.exportedAt,
      passages: (b.passages ?? []).map((p) => ProtoJsonCodec.passageToJson(p)),
      flashcards: (b.flashcards ?? []).map((c) => ProtoJsonCodec.flashcardToJson(c)),
      reviewLogs: (b.reviewLogs ?? []).map((r) => ProtoJsonCodec.reviewLogToJson(r)),
    };
  },

  bundleFromJson(json: UserDataBundleProtoJson): UserDataBundle {
    return {
      schemaVersion: Number(json.schemaVersion ?? json.schema_version ?? 1),
      exportedAt: String(json.exportedAt ?? json.exported_at ?? new Date().toISOString()),
      passages: Array.isArray(json.passages)
        ? json.passages.map((p) => ProtoJsonCodec.passageFromJson(p))
        : [],
      flashcards: Array.isArray(json.flashcards)
        ? json.flashcards.map((c) => ProtoJsonCodec.flashcardFromJson(c))
        : [],
      reviewLogs: Array.isArray(json.reviewLogs ?? json.review_logs)
        ? ((json.reviewLogs ?? json.review_logs) as ReviewLogProtoJson[]).map((r) =>
            ProtoJsonCodec.reviewLogFromJson(r)
          )
        : [],
    };
  },

  serializeBundle(bundle: UserDataBundle, pretty = true): string {
    const jsonObj = ProtoJsonCodec.bundleToJson(bundle);
    return JSON.stringify(jsonObj, null, pretty ? 2 : 0);
  },

  deserializeBundle(jsonString: string): UserDataBundle {
    const raw = JSON.parse(jsonString) as UserDataBundleProtoJson;
    return ProtoJsonCodec.bundleFromJson(raw);
  },
};
