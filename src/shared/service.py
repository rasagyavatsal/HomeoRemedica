from __future__ import annotations

from shared.contracts import (
    DEFAULT_MODEL_INPUT_LIMIT_TOKENS,
    MAX_GENERATED_ANSWER_CHARS,
    MAX_GENERATION_PROMPT_CHARS,
    AnswerGenerator,
    BookSummary,
    ChatRequest,
    ChatResponse,
    Citation,
    Retriever,
)
from shared.errors import ChatFailure, TokenExhaustionError
from shared.generation import SAFETY_NOTICE, SYSTEM_INSTRUCTION, _generation_prompt


class ChatService:
    """Own the complete retrieve-and-generate sequence behind one narrow chat method."""

    def __init__(
        self,
        *,
        retriever: Retriever,
        generator: AnswerGenerator,
        source_limit: int = 8,
    ) -> None:
        self._retriever = retriever
        self._generator = generator
        self._source_limit = source_limit
        model_input_limit = getattr(
            retriever, "model_input_limit", DEFAULT_MODEL_INPUT_LIMIT_TOKENS
        )
        if not isinstance(model_input_limit, int) or model_input_limit <= 0:
            raise ValueError("corpus model input limit must be a positive integer")
        # Four characters per token is intentionally conservative and keeps
        # the prompt below the model's input budget without needing a tokenizer
        # in the serving container.
        self._generation_char_limit = min(
            MAX_GENERATION_PROMPT_CHARS,
            max(512, model_input_limit * 4),
        )

    @property
    def corpus_version(self) -> str:
        return self._retriever.corpus_version

    @property
    def model_name(self) -> str:
        return self._generator.model

    @property
    def books(self) -> tuple[BookSummary, ...]:
        return self._retriever.books

    def chat(self, request: ChatRequest) -> ChatResponse:
        try:
            sources = self._retriever.retrieve(request, limit=self._source_limit)
        except ValueError:
            raise
        except ChatFailure:
            raise
        except TimeoutError as error:
            raise ChatFailure(
                stage="corpus_search",
                kind="timeout",
                error_type=type(error).__name__,
            ) from error
        except Exception as error:
            raise ChatFailure(
                stage="corpus_search",
                kind="internal",
                error_type=type(error).__name__,
            ) from error

        try:
            generated_answer = self._generator.generate(
                _generation_prompt(
                    request,
                    sources,
                    max_chars=self._generation_char_limit,
                ),
                system_instruction=SYSTEM_INSTRUCTION,
            ).strip()
        except ChatFailure:
            raise
        except TokenExhaustionError as error:
            raise ChatFailure(
                stage="answer_generation",
                kind="token_exhaustion",
                error_type=type(error).__name__,
            ) from error
        except TimeoutError as error:
            raise ChatFailure(
                stage="answer_generation",
                kind="timeout",
                error_type=type(error).__name__,
            ) from error
        except (OSError, RuntimeError) as error:
            raise ChatFailure(
                stage="answer_generation",
                kind="provider",
                error_type=type(error).__name__,
            ) from error
        except Exception as error:
            raise ChatFailure(
                stage="answer_generation",
                kind="internal",
                error_type=type(error).__name__,
            ) from error
        if len(generated_answer) > MAX_GENERATED_ANSWER_CHARS:
            generated_answer = generated_answer[:MAX_GENERATED_ANSWER_CHARS].rstrip() + "…"
        answer = f"{SAFETY_NOTICE}\n\n{generated_answer}"
        try:
            citations = tuple(
                Citation(
                    id=f"{self._retriever.corpus_version}/{source.book_id}/{source.chunk_id}",
                    book_id=source.book_id,
                    book_title=source.book_title,
                    author=source.author,
                    remedy_name=source.remedy_name,
                    section_title=source.section_title,
                    passage_indexes=source.passage_indexes,
                    text=source.text,
                )
                for source in sources
            )
            return ChatResponse(
                answer=answer,
                corpus_version=self._retriever.corpus_version,
                model=self._generator.model,
                sources=citations,
            )
        except ChatFailure:
            raise
        except Exception as error:
            raise ChatFailure(
                stage="chat",
                kind="internal",
                error_type=type(error).__name__,
            ) from error
