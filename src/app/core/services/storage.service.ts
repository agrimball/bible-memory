import { computed, inject, Injectable, signal } from '@angular/core';
import {
  CardState,
  Flashcard,
  Passage,
  ProtoJsonCodec,
  ReviewLog,
  ReviewRating,
  UserDataBundle,
  Verse,
} from '../proto/bible_memory.pb';
import { PassageParserService } from './passage-parser.service';
import { SrsService } from './srs.service';

export const STORAGE_KEY = 'bible_memory_protojson_v1';

export interface DeckItem {
  passage: Passage;
  card: Flashcard;
  isDue: boolean;
}

export interface DeckStats {
  total: number;
  due: number;
  newCount: number;
  learningCount: number;
  reviewCount: number;
}

@Injectable({ providedIn: 'root' })
export class StorageService {
  private readonly srs = inject(SrsService);
  private readonly parser = inject(PassageParserService);

  readonly passages = signal<Passage[]>([]);
  readonly flashcards = signal<Flashcard[]>([]);
  readonly reviewLogs = signal<ReviewLog[]>([]);

  readonly deckItems = computed<DeckItem[]>(() => {
    const passageList = this.passages();
    const cardList = this.flashcards();
    const cardByPassageId = new Map<string, Flashcard>();

    for (const card of cardList) {
      cardByPassageId.set(card.passageId, card);
    }

    const now = new Date();
    const items: DeckItem[] = [];

    for (const passage of passageList) {
      const card = cardByPassageId.get(passage.id);
      if (card) {
        items.push({
          passage,
          card,
          isDue: this.srs.isDue(card, now),
        });
      }
    }

    return items;
  });

  readonly dueDeckItems = computed<DeckItem[]>(() => {
    return this.deckItems()
      .filter((item) => item.isDue)
      .sort((a, b) => {
        const dueA = new Date(a.card.dueAt).getTime() || 0;
        const dueB = new Date(b.card.dueAt).getTime() || 0;
        return dueA - dueB;
      });
  });

  readonly stats = computed<DeckStats>(() => {
    const items = this.deckItems();
    let due = 0;
    let newCount = 0;
    let learningCount = 0;
    let reviewCount = 0;

    for (const item of items) {
      if (item.isDue) {
        due += 1;
      }
      if (item.card.state === CardState.CARD_STATE_NEW) {
        newCount += 1;
      } else if (
        item.card.state === CardState.CARD_STATE_LEARNING ||
        item.card.state === CardState.CARD_STATE_RELEARNING
      ) {
        learningCount += 1;
      } else if (item.card.state === CardState.CARD_STATE_REVIEW) {
        reviewCount += 1;
      }
    }

    return {
      total: items.length,
      due,
      newCount,
      learningCount,
      reviewCount,
    };
  });

  constructor() {
    this.loadFromStorage();
  }

  /**
   * Adds a structured multi-verse passage and creates its corresponding SRS flashcard.
   */
  addPassage(reference: string, verses: Verse[]): DeckItem {
    const now = new Date();
    const isoNow = now.toISOString();
    const cleanRef = reference.trim() || 'Untitled Passage';
    const cleanVerses: Verse[] = verses
      .map((v, idx) => ({
        verseNumber: v.verseNumber > 0 ? v.verseNumber : idx + 1,
        text: v.text.trim(),
      }))
      .filter((v) => v.text.length > 0);

    const passage: Passage = {
      id: this.generateId('psg'),
      reference: cleanRef,
      verses: cleanVerses,
      createdAt: isoNow,
      updatedAt: isoNow,
    };

    const card = this.srs.createInitialFlashcard(passage.id, now);

    this.passages.update((prev) => [passage, ...prev]);
    this.flashcards.update((prev) => [card, ...prev]);
    this.persistToStorage();

    return {
      passage,
      card,
      isDue: true,
    };
  }

  /**
   * Parses raw pasted text (and optional explicit reference) and adds it to the deck.
   */
  addFromRawText(rawText: string, explicitReference?: string): DeckItem {
    const parsed = this.parser.parseRawInput(rawText, explicitReference);
    return this.addPassage(parsed.reference, parsed.verses);
  }

  /**
   * Deletes a passage along with its flashcards and review logs.
   */
  deletePassage(passageId: string): void {
    this.passages.update((prev) => prev.filter((p) => p.id !== passageId));
    this.flashcards.update((prev) => prev.filter((c) => c.passageId !== passageId));
    this.reviewLogs.update((prev) => prev.filter((r) => r.passageId !== passageId));
    this.persistToStorage();
  }

  /**
   * Grades a flashcard, updates its SRS state, appends a ReviewLog entry, and persists to ProtoJSON.
   */
  recordReview(cardId: string, rating: ReviewRating): DeckItem | undefined {
    const cards = this.flashcards();
    const targetCard = cards.find((c) => c.id === cardId);
    if (!targetCard) {
      return undefined;
    }

    const now = new Date();
    const { updatedCard, reviewLog } = this.srs.gradeCard(targetCard, rating, now);

    this.flashcards.update((prev) => prev.map((c) => (c.id === cardId ? updatedCard : c)));
    this.reviewLogs.update((prev) => [reviewLog, ...prev]);
    this.persistToStorage();

    const passage = this.passages().find((p) => p.id === updatedCard.passageId);
    if (!passage) {
      return undefined;
    }

    return {
      passage,
      card: updatedCard,
      isDue: this.srs.isDue(updatedCard, now),
    };
  }

  /**
   * Exports all user data as a Proto3-compliant JSON string.
   */
  exportProtoJson(pretty = true): string {
    const bundle: UserDataBundle = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      passages: this.passages(),
      flashcards: this.flashcards(),
      reviewLogs: this.reviewLogs(),
    };
    return ProtoJsonCodec.serializeBundle(bundle, pretty);
  }

  /**
   * Imports a Proto3 JSON string into storage.
   * When `merge` is true, merges passages/cards/logs by ID; otherwise replaces existing data.
   */
  importProtoJson(jsonString: string, merge = false): void {
    const bundle = ProtoJsonCodec.deserializeBundle(jsonString);

    if (!merge) {
      const passages = bundle.passages;
      const flashcards = this.ensureFlashcardsForPassages(passages, bundle.flashcards);
      this.passages.set(passages);
      this.flashcards.set(flashcards);
      this.reviewLogs.set(bundle.reviewLogs);
      this.persistToStorage();
      return;
    }

    // Merge by ID
    const passageMap = new Map<string, Passage>();
    for (const p of this.passages()) {
      passageMap.set(p.id, p);
    }
    for (const p of bundle.passages) {
      passageMap.set(p.id, p);
    }

    const cardMap = new Map<string, Flashcard>();
    for (const c of this.flashcards()) {
      cardMap.set(c.id, c);
    }
    for (const c of bundle.flashcards) {
      cardMap.set(c.id, c);
    }

    const logMap = new Map<string, ReviewLog>();
    for (const r of this.reviewLogs()) {
      logMap.set(r.id, r);
    }
    for (const r of bundle.reviewLogs) {
      logMap.set(r.id, r);
    }

    const mergedPassages = Array.from(passageMap.values());
    const mergedCards = this.ensureFlashcardsForPassages(
      mergedPassages,
      Array.from(cardMap.values())
    );

    this.passages.set(mergedPassages);
    this.flashcards.set(mergedCards);
    this.reviewLogs.set(Array.from(logMap.values()));
    this.persistToStorage();
  }

  /**
   * Resets the deck back to the 4 default starter passages.
   */
  resetToDefaults(): void {
    this.seedDefaults();
  }

  private loadFromStorage(): void {
    if (typeof localStorage === 'undefined') {
      this.seedDefaults();
      return;
    }

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        this.seedDefaults();
        return;
      }

      const bundle = ProtoJsonCodec.deserializeBundle(raw);
      if (!bundle.passages || bundle.passages.length === 0) {
        this.seedDefaults();
        return;
      }

      const flashcards = this.ensureFlashcardsForPassages(bundle.passages, bundle.flashcards);
      this.passages.set(bundle.passages);
      this.flashcards.set(flashcards);
      this.reviewLogs.set(bundle.reviewLogs ?? []);
    } catch {
      this.seedDefaults();
    }
  }

  private persistToStorage(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    try {
      const serialized = this.exportProtoJson(false);
      localStorage.setItem(STORAGE_KEY, serialized);
    } catch {
      // Ignore quota/storage errors in restricted environments
    }
  }

  private ensureFlashcardsForPassages(passages: Passage[], existingCards: Flashcard[]): Flashcard[] {
    const byPassageId = new Map<string, Flashcard>();
    for (const c of existingCards) {
      if (c.passageId) {
        byPassageId.set(c.passageId, c);
      }
    }

    const now = new Date();
    const result: Flashcard[] = [];
    for (const passage of passages) {
      const found = byPassageId.get(passage.id);
      if (found) {
        result.push(found);
      } else {
        result.push(this.srs.createInitialFlashcard(passage.id, now));
      }
    }
    return result;
  }

  private seedDefaults(): void {
    const now = new Date();
    const isoNow = now.toISOString();

    const starterData: Array<{ id: string; cardId: string; reference: string; verses: Verse[] }> = [
      {
        id: 'psg_seed_romans_8_1_4',
        cardId: 'card_seed_romans_8_1_4',
        reference: 'Romans 8:1-4',
        verses: [
          {
            verseNumber: 1,
            text: 'There is therefore now no condemnation for those who are in Christ Jesus.',
          },
          {
            verseNumber: 2,
            text: 'For the law of the Spirit of life has set you free in Christ Jesus from the law of sin and death.',
          },
          {
            verseNumber: 3,
            text: 'For God has done what the law, weakened by the flesh, could not do. By sending his own Son in the likeness of sinful flesh and for sin, he condemned sin in the flesh,',
          },
          {
            verseNumber: 4,
            text: 'in order that the righteous requirement of the law might be fulfilled in us, who walk not according to the flesh but according to the Spirit.',
          },
        ],
      },
      {
        id: 'psg_seed_psalm_23_1_6',
        cardId: 'card_seed_psalm_23_1_6',
        reference: 'Psalm 23:1-6',
        verses: [
          {
            verseNumber: 1,
            text: 'The LORD is my shepherd; I shall not want.',
          },
          {
            verseNumber: 2,
            text: 'He makes me lie down in green pastures. He leads me beside still waters.',
          },
          {
            verseNumber: 3,
            text: 'He restores my soul. He leads me in paths of righteousness for his name’s sake.',
          },
          {
            verseNumber: 4,
            text: 'Even though I walk through the valley of the shadow of death, I will fear no evil, for you are with me; your rod and your staff, they comfort me.',
          },
          {
            verseNumber: 5,
            text: 'You prepare a table before me in the presence of my enemies; you anoint my head with oil; my cup overflows.',
          },
          {
            verseNumber: 6,
            text: 'Surely goodness and mercy shall follow me all the days of my life, and I shall dwell in the house of the LORD forever.',
          },
        ],
      },
      {
        id: 'psg_seed_philippians_4_6_7',
        cardId: 'card_seed_philippians_4_6_7',
        reference: 'Philippians 4:6-7',
        verses: [
          {
            verseNumber: 6,
            text: 'Do not be anxious about anything, but in everything by prayer and supplication with thanksgiving let your requests be made known to God.',
          },
          {
            verseNumber: 7,
            text: 'And the peace of God, which surpasses all understanding, will guard your hearts and your minds in Christ Jesus.',
          },
        ],
      },
      {
        id: 'psg_seed_john_1_1_5',
        cardId: 'card_seed_john_1_1_5',
        reference: 'John 1:1-5',
        verses: [
          {
            verseNumber: 1,
            text: 'In the beginning was the Word, and the Word was with God, and the Word was God.',
          },
          {
            verseNumber: 2,
            text: 'He was in the beginning with God.',
          },
          {
            verseNumber: 3,
            text: 'All things were made through him, and without him was not any thing made that was made.',
          },
          {
            verseNumber: 4,
            text: 'In him was life, and the life was the light of men.',
          },
          {
            verseNumber: 5,
            text: 'The light shines in the darkness, and the darkness has not overcome it.',
          },
        ],
      },
    ];

    const passages: Passage[] = starterData.map((s) => ({
      id: s.id,
      reference: s.reference,
      verses: s.verses,
      createdAt: isoNow,
      updatedAt: isoNow,
    }));

    const flashcards: Flashcard[] = starterData.map((s) => ({
      ...this.srs.createInitialFlashcard(s.id, now),
      id: s.cardId,
    }));

    this.passages.set(passages);
    this.flashcards.set(flashcards);
    this.reviewLogs.set([]);
    this.persistToStorage();
  }

  private generateId(prefix: string): string {
    const rand = Math.random().toString(36).substring(2, 10);
    return `${prefix}_${Date.now().toString(36)}_${rand}`;
  }
}
