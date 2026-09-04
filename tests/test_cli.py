from homeoremedica_chat import cli
from homeoremedica_chat.chat import ChatRequest, ChatResponse, Citation


def test_cli_uses_the_branded_homeoremedica_program_name() -> None:
    parser = cli._parser()

    assert parser.prog == "homeoremedica"


class StubService:
    def chat(self, request: ChatRequest) -> ChatResponse:
        assert request.message == "What is Nux vomica associated with?"
        return ChatResponse(
            answer=(
                "Historical materia medica reference only—not medical advice. "
                "For health decisions, consult a qualified clinician.\n\n"
                "The excerpt describes irritability [1]."
            ),
            corpus_version="v1",
            model="test-model",
            sources=(
                Citation(
                    id="v1/kent-lectures/chunk-1",
                    book_id="kent-lectures",
                    book_title="Kent's Lectures",
                    author="James Tyler Kent",
                    remedy_name="NUX VOMICA",
                    section_title="MIND",
                    passage_indexes=(0,),
                    text="Irritable.",
                ),
            ),
        )


def test_ask_command_prints_the_answer_and_traceable_sources(monkeypatch, capsys) -> None:
    monkeypatch.setattr(cli, "build_service", lambda settings, sync: StubService())

    exit_code = cli.main(["--cached", "ask", "What is Nux vomica associated with?"])

    assert exit_code == 0
    assert capsys.readouterr().out == (
        "Historical materia medica reference only—not medical advice. "
        "For health decisions, consult a qualified clinician.\n\n"
        "The excerpt describes irritability [1].\n\n"
        "Sources (corpus v1):\n"
        "[1] Kent's Lectures — NUX VOMICA — MIND\n"
        "    v1/kent-lectures/chunk-1\n"
    )


class InteractiveStubService:
    def __init__(self) -> None:
        self.requests: list[ChatRequest] = []

    def chat(self, request: ChatRequest) -> ChatResponse:
        self.requests.append(request)
        return ChatResponse(
            answer=f"Answer {len(self.requests)} [1].",
            corpus_version="v1",
            model="test-model",
            sources=(),
        )


def test_interactive_chat_keeps_context_in_memory_and_can_clear_it(monkeypatch) -> None:
    service = InteractiveStubService()
    messages = iter(("first question", "follow-up", "/clear", "new question", "/exit"))
    monkeypatch.setattr(cli, "build_service", lambda settings, sync: service)
    monkeypatch.setattr("builtins.input", lambda _prompt: next(messages))

    exit_code = cli.main(["--cached", "chat"])

    assert exit_code == 0
    assert [request.message for request in service.requests] == [
        "first question",
        "follow-up",
        "new question",
    ]
    assert service.requests[0].history == ()
    assert [turn.content for turn in service.requests[1].history] == [
        "first question",
        "Answer 1 [1].",
    ]
    assert service.requests[2].history == ()


def test_interactive_chat_drops_oldest_turns_at_the_context_limit(monkeypatch) -> None:
    service = InteractiveStubService()
    messages = iter((*tuple(f"question-{index}" for index in range(12)), "/exit"))
    monkeypatch.setattr(cli, "build_service", lambda settings, sync: service)
    monkeypatch.setattr("builtins.input", lambda _prompt: next(messages))

    assert cli.main(["--cached", "chat"]) == 0
    assert len(service.requests) == 12
    assert len(service.requests[-1].history) == 20
    assert service.requests[-1].history[0].content == "question-1"
    assert service.requests[-1].history[-1].content == "Answer 11 [1]."
