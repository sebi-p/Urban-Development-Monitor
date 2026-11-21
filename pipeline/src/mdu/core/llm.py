"""LLM fallback for the document classifier (M3.1; ADR 0008).

Only documents no rule recognises reach this. The model gets the listing label and the first
~2,000 characters of text, and must answer with a JSON object constrained by a schema (one type
from `DOCUMENT_ROLES` and a confidence). Calls are cached and budgeted by the classify stage in
`extraction_run`. Tests use a fake with the same interface; CI never calls the API.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from importlib import resources
from typing import TYPE_CHECKING, Any, Literal, Protocol, get_args

from mdu.core.classify import Classification, ClassifyInput
from mdu.core.enums import Confidence, DocumentRole

if TYPE_CHECKING:
    import anthropic
    from anthropic.types import MessageParam, OutputConfigParam

MODEL = "claude-haiku-5-5"
PROMPT_VERSION = "classify-v1"
# USD per million tokens (input, output), prompts under 100K tokens. Checked 2026-11-21.
PRICES = {
    "claude-haiku-5-5": (0.10, 0.50),
    "claude-sonnet-5-5": (2.00, 10.00),
    "claude-sonnet-5": (2.00, 10.00),  # a possible refusal fallback
}
REFUSAL_FALLBACK = {"claude-sonnet-5-5"}

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "doc_type": {"type": "string", "enum": list(get_args(DocumentRole))},
        "confidence": {"type": "string", "enum": list(get_args(Confidence))},
    },
    "required": ["doc_type", "confidence"],
    "additionalProperties": False,
}


def prompt_text(version: str = PROMPT_VERSION) -> str:
    name = version.removeprefix("classify-") + ".md"
    return (resources.files("mdu.prompts") / "classify" / name).read_text(encoding="utf-8")


def user_message(inp: ClassifyInput) -> str:
    return (
        f"Listing label: {inp.label or '(none)'}\n"
        f"Pages in the file: {inp.page_count}\n\n"
        f"Excerpt from the first pages:\n<excerpt>\n{inp.llm_excerpt}\n</excerpt>"
    )


@dataclass(frozen=True)
class LlmResult:
    classification: Classification
    model: str
    prompt_version: str
    input_tokens: int
    output_tokens: int
    cost_usd: float
    raw: dict[str, Any]


class LlmError(RuntimeError):
    """The call failed or returned no usable answer; the document is retried on a later run."""


class Classifier(Protocol):
    model: str
    prompt_version: str

    def __call__(self, inp: ClassifyInput) -> LlmResult: ...


@dataclass(frozen=True)
class JsonAnswer:
    data: dict[str, Any]
    model: str
    input_tokens: int
    output_tokens: int
    cost_usd: float


def call_json(  # noqa: PLR0913
    client: anthropic.Anthropic,
    *,
    model: str,
    system: str,
    user: str,
    schema: dict[str, Any],
    max_tokens: int = 1024,
    effort: Literal["low", "medium", "high"] = "low",
) -> JsonAnswer:
    """One Messages API call whose text answer is constrained to `schema`."""
    import anthropic  # noqa: PLC0415

    messages: list[MessageParam] = [{"role": "user", "content": user}]
    output: OutputConfigParam = {
        "effort": effort,
        "format": {"type": "json_schema", "schema": schema},
    }
    try:
        if model in REFUSAL_FALLBACK:
            # Server-side fallback: a refused request is re-run on a fallback model in the same
            # call (beta). Planning documents are unlikely to trigger it.
            kwargs: dict[str, Any] = {
                "model": model, "max_tokens": max_tokens, "system": system,
                "messages": messages, "output_config": output,
                "betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default",
            }  # fmt: skip
            response: Any = client.beta.messages.create(**kwargs)
        else:
            response = client.messages.create(
                model=model, max_tokens=max_tokens, system=system, messages=messages,
                output_config=output,
            )  # fmt: skip
    except anthropic.APIStatusError as exc:
        raise LlmError(f"HTTP {exc.status_code}: {exc.message}") from exc
    except anthropic.APIConnectionError as exc:
        raise LlmError(f"connection failed: {exc}") from exc
    if response.stop_reason != "end_turn":
        raise LlmError(f"stopped with {response.stop_reason}")
    text = next((b.text for b in response.content if b.type == "text"), None)
    if text is None:
        raise LlmError("no text block in the response")
    served_by = getattr(response, "model", None) or model
    price_in, price_out = PRICES.get(served_by, PRICES.get(model, (0.0, 0.0)))
    tokens_in, tokens_out = response.usage.input_tokens, response.usage.output_tokens
    return JsonAnswer(
        json.loads(text), model, tokens_in, tokens_out,
        (tokens_in * price_in + tokens_out * price_out) / 1_000_000,
    )  # fmt: skip


def _default_client() -> anthropic.Anthropic:
    import anthropic  # noqa: PLC0415 - only needed when the LLM is switched on

    return anthropic.Anthropic(max_retries=3, timeout=120.0)


class ClaudeClassifier:
    """Claude Haiku via the Anthropic SDK. Credentials come from ANTHROPIC_API_KEY."""

    def __init__(self, client: anthropic.Anthropic | None = None, model: str = MODEL) -> None:
        self.client = client or _default_client()
        self.model = model
        self.prompt_version = PROMPT_VERSION
        self._system = prompt_text()

    def __call__(self, inp: ClassifyInput) -> LlmResult:
        answer = call_json(
            self.client, model=self.model, system=self._system, user=user_message(inp),
            schema=SCHEMA,
        )  # fmt: skip
        doc_type, confidence = answer.data["doc_type"], answer.data["confidence"]
        return LlmResult(
            classification=Classification(
                doc_type, "llm", confidence, f"{self.model} {PROMPT_VERSION}"
            ),
            model=self.model,
            prompt_version=self.prompt_version,
            input_tokens=answer.input_tokens,
            output_tokens=answer.output_tokens,
            cost_usd=answer.cost_usd,
            raw=answer.data,
        )


# Field extraction needs more judgment than classification: Sonnet 5.5 and Haiku 5.5 both scored
# 91.4% on the golden set, but Haiku's misses were wrong values and Sonnet's were mostly gaps
# (ADR 0009). About $0.02 per project.
FIELDS_MODEL = "claude-sonnet-5-5"


class ClaudeFieldExtractor:
    """Project fields from selected pages (mdu.core.fields), one call per project."""

    def __init__(
        self, client: anthropic.Anthropic | None = None, model: str = FIELDS_MODEL
    ) -> None:
        from mdu.core import fields  # noqa: PLC0415

        self.client = client or _default_client()
        self.model = model
        self.prompt_version = fields.PROMPT_VERSION
        self._schema = fields.SCHEMA
        self._system = (resources.files("mdu.prompts") / "fields" / "v1.md").read_text("utf-8")

    def __call__(self, pages_text: str) -> JsonAnswer:
        return call_json(
            self.client, model=self.model, system=self._system, user=pages_text,
            schema=self._schema, max_tokens=4096,
        )  # fmt: skip
