/**
 * Thin ProtoJSON & helper adapter over the protoc-generated bindings in:
 * `./generated/bible_memory` (generated from `proto/bible_memory.proto` via `npm run proto:gen`).
 *
 * Do NOT hand-edit `./generated/bible_memory.ts`.
 */

import {
  CardState,
  cardStateFromJSON,
  cardStateToJSON,
  Flashcard,
  Passage,
  ReviewLog,
  ReviewRating,
  reviewRatingFromJSON,
  reviewRatingToJSON,
  UserDataBundle,
  Verse,
} from './generated/bible_memory';

export {
  CardState,
  cardStateFromJSON,
  cardStateToJSON,
  Flashcard,
  Passage,
  ReviewLog,
  ReviewRating,
  reviewRatingFromJSON,
  reviewRatingToJSON,
  UserDataBundle,
  Verse,
};

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
  try {
    return cardStateToJSON(state);
  } catch {
    return 'CARD_STATE_UNSPECIFIED';
  }
}

export function cardStateFromProtoJson(val: string | number | undefined): CardState {
  if (val === undefined || val === null || val === '') {
    return CardState.CARD_STATE_UNSPECIFIED;
  }
  try {
    return cardStateFromJSON(val);
  } catch {
    return CardState.CARD_STATE_UNSPECIFIED;
  }
}

export function reviewRatingToProtoJson(rating: ReviewRating): string {
  try {
    return reviewRatingToJSON(rating);
  } catch {
    return 'REVIEW_RATING_UNSPECIFIED';
  }
}

export function reviewRatingFromProtoJson(val: string | number | undefined): ReviewRating {
  if (val === undefined || val === null || val === '') {
    return ReviewRating.REVIEW_RATING_UNSPECIFIED;
  }
  try {
    return reviewRatingFromJSON(val);
  } catch {
    return ReviewRating.REVIEW_RATING_UNSPECIFIED;
  }
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
