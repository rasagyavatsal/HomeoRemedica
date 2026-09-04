from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections.abc import Callable, Iterable
from dataclasses import dataclass

from homeoremedica_corpus.sources import Book

TokenCounter = Callable[[str], int]


@dataclass(frozen=True, slots=True)
class ChunkingPolicy:
    target_tokens: int = 500
    minimum_tokens: int = 300

    def __post_init__(self) -> None:
        if self.minimum_tokens <= 0 or self.target_tokens < self.minimum_tokens:
            raise ValueError("chunk token targets must satisfy 0 < minimum <= target")


DEFAULT_CHUNKING_POLICY = ChunkingPolicy()


@dataclass(frozen=True, slots=True)
class Chunk:
    id: str
    book_id: str
    book_title: str
    remedy_slug: str
    remedy_name: str
    section_slug: str
    section_title: str
    passage_indexes: tuple[int, ...]
    passages: tuple[str, ...]
    part: int
    text: str

    @property
    def embedding_text(self) -> str:
        return (
            f"Book: {self.book_title}\n"
            f"Remedy: {self.remedy_name}\n"
            f"Section: {self.section_title}\n"
            f"Text: {self.text}"
        )


def estimate_tokens(text: str) -> int:
    """Return a deterministic token estimate used only for approximate chunk targets."""
    return max(1, len(re.findall(r"\w+|[^\w\s]", text, flags=re.UNICODE)))


def chunk_book(
    book: Book,
    policy: ChunkingPolicy = DEFAULT_CHUNKING_POLICY,
    count_tokens: TokenCounter = estimate_tokens,
) -> tuple[Chunk, ...]:
    chunks = []
    for remedy in book.remedies:
        for section in remedy.sections:
            groups = _passage_groups(
                section.passages,
                policy.minimum_tokens,
                policy.target_tokens,
                count_tokens,
            )
            for part, indexes in enumerate(groups, start=1):
                passages = tuple(section.passages[index] for index in indexes)
                text = "\n\n".join(passages)
                identity = {
                    "book_id": book.book_id,
                    "remedy_name": remedy.name,
                    "section_title": section.title,
                    "passage_indexes": indexes,
                    "part": part,
                    "text": text,
                }
                digest = hashlib.sha256(
                    json.dumps(
                        identity,
                        ensure_ascii=False,
                        separators=(",", ":"),
                        sort_keys=True,
                    ).encode("utf-8")
                ).hexdigest()
                chunks.append(
                    Chunk(
                        id=f"chk_{digest}",
                        book_id=book.book_id,
                        book_title=book.title,
                        remedy_slug=_slugify(remedy.name),
                        remedy_name=remedy.name,
                        section_slug=_slugify(section.title),
                        section_title=section.title,
                        passage_indexes=tuple(indexes),
                        passages=passages,
                        part=part,
                        text=text,
                    )
                )
    return tuple(chunks)


def _passage_groups(
    passages: tuple[str, ...],
    minimum_tokens: int,
    target_tokens: int,
    count_tokens: TokenCounter,
) -> tuple[tuple[int, ...], ...]:
    groups: list[tuple[int, ...]] = []
    current: list[int] = []
    for index in range(len(passages)):
        candidate = [*current, index]
        candidate_text = "\n\n".join(passages[item] for item in candidate)
        if current and count_tokens(candidate_text) > target_tokens:
            groups.append(tuple(current))
            current = [index]
        else:
            current = candidate
    if current:
        groups.append(tuple(current))
    _rebalance_tail(groups, passages, minimum_tokens, target_tokens, count_tokens)
    return tuple(groups)


def _rebalance_tail(
    groups: list[tuple[int, ...]],
    passages: tuple[str, ...],
    minimum_tokens: int,
    target_tokens: int,
    count_tokens: TokenCounter,
) -> None:
    if len(groups) < 2:
        return
    combined = (*groups[-2], *groups[-1])

    def tokens(indexes: tuple[int, ...]) -> int:
        return count_tokens("\n\n".join(passages[index] for index in indexes))

    def score(left: tuple[int, ...], right: tuple[int, ...]) -> tuple[int, int, int]:
        left_tokens, right_tokens = tokens(left), tokens(right)
        below_target = int(left_tokens < minimum_tokens) + int(right_tokens < minimum_tokens)
        return (
            below_target,
            abs(left_tokens - right_tokens),
            abs(target_tokens - left_tokens) + abs(target_tokens - right_tokens),
        )

    best = (groups[-2], groups[-1])
    best_score = score(*best)
    for split in range(1, len(combined)):
        candidate = (tuple(combined[:split]), tuple(combined[split:]))
        counts = tuple(tokens(group) for group in candidate)
        if any(
            count > target_tokens and len(group) > 1
            for group, count in zip(candidate, counts, strict=True)
        ):
            continue
        candidate_score = score(*candidate)
        if candidate_score < best_score:
            best, best_score = candidate, candidate_score
    groups[-2:] = best


def corpus_hash(chunks: Iterable[Chunk]) -> str:
    digest = hashlib.sha256()
    for chunk in chunks:
        record = {
            "id": chunk.id,
            "book_id": chunk.book_id,
            "remedy_name": chunk.remedy_name,
            "section_title": chunk.section_title,
            "passage_indexes": chunk.passage_indexes,
            "part": chunk.part,
            "text": chunk.text,
        }
        digest.update(
            json.dumps(record, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode(
                "utf-8"
            )
        )
        digest.update(b"\n")
    return digest.hexdigest()


def _slugify(value: str) -> str:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_value.lower()).strip("-")
    if slug:
        return slug
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()[:12]
    return f"item-{digest}"
