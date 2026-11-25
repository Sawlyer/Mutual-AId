import logging
from dataclasses import dataclass
from typing import Any

from app.config import Settings
from app.db import Database

logger = logging.getLogger(__name__)
_TOKENS_PER_MILLION = 1_000_000


@dataclass(frozen=True)
class ModelUsageSnapshot:
    requests: int
    input_tokens: int
    output_tokens: int
    cached_input_tokens: int
    reasoning_tokens: int


@dataclass(frozen=True)
class ModelTokenRates:
    input_per_million: float
    cached_input_per_million: float | None
    output_per_million: float


@dataclass(frozen=True)
class ModelCostEstimate:
    input_usd: float
    cached_input_usd: float
    output_usd: float
    total_usd: float


# Standard OpenAI API prices per million tokens, checked against the official
# pricing table. Unknown/custom models stay unpriced unless explicit rates exist.
_OPENAI_STANDARD_RATES: dict[str, ModelTokenRates] = {
    "gpt-6-luna": ModelTokenRates(0.05, 0.005, 0.25),
}


def _get(value: object, name: str) -> Any:
    if isinstance(value, dict):
        return value.get(name)
    return getattr(value, name, None)


def _count(value: object) -> int:
    return value if isinstance(value, int) and value >= 0 else 0


def usage_from_result(result: object) -> ModelUsageSnapshot | None:
    context = _get(result, "context_wrapper")
    usage = _get(context, "usage")
    if usage is None:
        return None
    input_tokens = _count(_get(usage, "input_tokens"))
    output_tokens = _count(_get(usage, "output_tokens"))
    input_details = _get(usage, "input_tokens_details")
    output_details = _get(usage, "output_tokens_details")
    cached_input_tokens = min(input_tokens, _count(_get(input_details, "cached_tokens")))
    reasoning_tokens = min(output_tokens, _count(_get(output_details, "reasoning_tokens")))
    requests = _count(_get(usage, "requests"))
    if not any((requests, input_tokens, output_tokens)):
        return None
    return ModelUsageSnapshot(requests, input_tokens, output_tokens, cached_input_tokens, reasoning_tokens)


def _rates_for(settings: Settings, model: str) -> ModelTokenRates | None:
    input_rate = settings.openai_input_price_per_million
    output_rate = settings.openai_output_price_per_million
    if input_rate is not None and output_rate is not None:
        return ModelTokenRates(
            input_per_million=input_rate,
            cached_input_per_million=settings.openai_cached_input_price_per_million,
            output_per_million=output_rate,
        )
    return _OPENAI_STANDARD_RATES.get(model.strip().casefold())


def estimate_model_cost(
    settings: Settings,
    model: str,
    usage: ModelUsageSnapshot,
) -> ModelCostEstimate | None:
    rates = _rates_for(settings, model)
    if rates is None or (usage.cached_input_tokens and rates.cached_input_per_million is None):
        return None
    billable_input = max(0, usage.input_tokens - usage.cached_input_tokens)
    input_cost = billable_input * rates.input_per_million / _TOKENS_PER_MILLION
    cached_cost = usage.cached_input_tokens * (rates.cached_input_per_million or 0) / _TOKENS_PER_MILLION
    output_cost = usage.output_tokens * rates.output_per_million / _TOKENS_PER_MILLION
    return ModelCostEstimate(input_cost, cached_cost, output_cost, input_cost + cached_cost + output_cost)


def record_model_run_usage(
    database: Database,
    settings: Settings,
    conversation_id: str,
    stage: str,
    result: object,
    *,
    execution_id: str | None = None,
    task_id: str | None = None,
) -> None:
    usage = usage_from_result(result)
    if usage is None:
        return
    estimate = estimate_model_cost(settings, settings.openai_model or "", usage)
    try:
        database.record_model_usage(
            conversation_id=conversation_id,
            stage=stage,
            model=(settings.openai_model or "unknown")[:160],
            request_count=usage.requests,
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            cached_input_tokens=usage.cached_input_tokens,
            reasoning_tokens=usage.reasoning_tokens,
            input_cost_usd=round(estimate.input_usd, 12) if estimate else None,
            cached_input_cost_usd=round(estimate.cached_input_usd, 12) if estimate else None,
            output_cost_usd=round(estimate.output_usd, 12) if estimate else None,
            estimated_cost_usd=round(estimate.total_usd, 12) if estimate else None,
            execution_id=execution_id,
            task_id=task_id,
        )
    except Exception:
        logger.exception("Failed to persist model usage for conversation %s", conversation_id)
