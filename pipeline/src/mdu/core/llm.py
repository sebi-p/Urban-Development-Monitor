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
from typing import TYPE_CHECKING, Any, Protocol, get_args

from mdu.core.classify import Classification, ClassifyInput
from mdu.core.enums import Confidence, DocumentRole

if TYPE_CHECKING:
    import anthropic

MODEL = "claude-haiku-5-5"
PROMPT_VERSION = "classify-v1"
# USD per million tokens (input, output), prompts under 100K tokens. Checked 2026-11-21.
PRICES = {"claude-haiku-5-5": (0.10, 0.50)}

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


class ClaudeClassifier:
    """Claude Haiku via the Anthropic SDK. Credentials come from ANTHROPIC_API_KEY."""

    def __init__(self, client: anthropic.Anthropic | None = None, model: str = MODEL) -> None:
        import anthropic  # noqa: PLC0415 - only needed when the LLM is switched on

        self.client = client or anthropic.Anthropic(max_retries=3, timeout=60.0)
        self.model = model
        self.prompt_version = PROMPT_VERSION
        self._system = prompt_text()

    def __call__(self, inp: ClassifyInput) -> LlmResult:
        import anthropic  # noqa: PLC0415

        try:
            response = self.client.messages.create(
                model=self.model,
                max_tokens=1024,
                system=self._system,
                messages=[{"role": "user", "content": user_message(inp)}],
                output_config={
                    "effort": "low",
                    "format": {"type": "json_schema", "schema": SCHEMA},
                },
            )
        except anthropic.APIStatusError as exc:
            raise LlmError(f"HTTP {exc.status_code}: {exc.message}") from exc
        except anthropic.APIConnectionError as exc:
            raise LlmError(f"connection failed: {exc}") from exc
        if response.stop_reason != "end_turn":
            raise LlmError(f"stopped with {response.stop_reason}")
        text = next((b.text for b in response.content if b.type == "text"), None)
        if text is None:
            raise LlmError("no text block in the response")
        data = json.loads(text)
        doc_type, confidence = data["doc_type"], data["confidence"]
        price_in, price_out = PRICES.get(self.model, (0.0, 0.0))
        tokens_in, tokens_out = response.usage.input_tokens, response.usage.output_tokens
        return LlmResult(
            classification=Classification(
                doc_type, "llm", confidence, f"{self.model} {PROMPT_VERSION}"
            ),
            model=self.model,
            prompt_version=self.prompt_version,
            input_tokens=tokens_in,
            output_tokens=tokens_out,
            cost_usd=(tokens_in * price_in + tokens_out * price_out) / 1_000_000,
            raw=data,
        )
