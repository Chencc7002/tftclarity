"""Reliable OpenAI-compatible extraction of structured TFT strategy claims."""

from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import urlparse

from schema_validator import has_explicit_uncertainty


ALLOWED_TYPES = {
    "comp_recommendation",
    "item_priority",
    "opener",
    "transition",
    "leveling",
    "reroll_timing",
    "positioning",
    "late_game_pivot",
    "risk",
    "patch_specific",
    "mechanism",
}
ALLOWED_CONFIDENCE = {"creator_advice", "strategic_advice", "speculation"}
PROMPT_VERSION = "youtube-guide-extraction.v6"
NORMALIZER_VERSION = "youtube-claim-normalizer.v6"

SYSTEM_PROMPT = """You extract reusable Teamfight Tactics strategy knowledge from one
timestamped transcript segment. Ignore introductions, outros, advertising, subscription
requests, entertainment-only chatter, and content unrelated to TFT. Do not turn creator
opinions into official facts or statistics. Return exactly one JSON object:
{"knowledge":[{"type","subjects","claim","conditions","timestampStart","timestampEnd",
"patchSpecific","confidence"}]}.

Allowed type values: comp_recommendation, item_priority, opener, transition, leveling,
reroll_timing, positioning, late_game_pivot, risk, patch_specific, mechanism.
type describes the knowledge topic and must never be creator_advice, strategic_advice,
speculation, strategy, or advice; those values belong only in confidence.
subjects and conditions must be string arrays. Timestamps must stay inside the supplied
segment. Include every explicitly named champion, item, composition, and trait in
subjects; do not omit an item merely because its holder is already present. Preserve the
transcript language in claim, subjects, and conditions. When advice has no named game
entity, use a stable strategy subject such as 升级节奏, 搜牌节奏, economy, or positioning,
instead of an empty array or a generic player. Emit one knowledge entry per distinct
recommendation or conditional branch, never repeat an equivalent entry, and return at
most 12 knowledge entries for one segment. Prioritize distinct actionable recommendations
when the segment contains more than 12. Do not merge adjacent recommendations merely
because they occur in one segment. Every statement in a claim must be supported inside
that claim's timestamp range. Timestamp labels are MM:SS or HH:MM:SS, but
timestampStart and timestampEnd must be absolute seconds (for example [00:45] is 45,
never 0.45). confidence must be
creator_advice, strategic_advice, or speculation. Return
{"knowledge":[]} when the segment contains no reliable actionable TFT knowledge."""

REPAIR_PROMPT = """Repair the supplied extraction response into the exact JSON contract.
Do not add facts that are absent from the transcript. Repair every rejected claim. When
there is no named game entity, use a stable strategy topic such as 升级节奏 or 搜牌节奏
instead of leaving subjects empty. Use only the allowed type values from the extraction
contract; strategy and strategic_advice are not type values. If validation reports a
language mismatch, rewrite claim, subjects, and conditions in the transcript language;
do not preserve or copy the wrong-language translation. Never repeat equivalent entries
and return at most 12 knowledge entries. Return JSON only."""


class ExtractionError(RuntimeError):
    """Raised when every extraction/repair attempt for a segment fails."""


@dataclass(frozen=True)
class ExtractionConfig:
    endpoint: str
    model: str
    api_key: str | None
    timeout_seconds: float = 45
    max_output_tokens: int = 4000
    retry_empty_once: bool = True
    prompt_version: str = PROMPT_VERSION
    thinking_mode: str | None = None
    transport_retries: int = 2
    transport_retry_delay_seconds: float = 1


def _chat_endpoint(value: str) -> str:
    endpoint = value.rstrip("/")
    return endpoint if endpoint.endswith("/chat/completions") else endpoint + "/chat/completions"


def _boolean_env(value: Any, default: bool) -> bool:
    if value is None:
        return default
    return str(value).strip().lower() not in {"0", "false", "no", "off"}


def _thinking_mode(value: Any, endpoint: str) -> str | None:
    if value is not None and str(value).strip():
        normalized = str(value).strip().lower()
        if normalized in {"none", "omit", "auto"}:
            return None
        if normalized not in {"enabled", "disabled"}:
            raise ValueError(
                "TFT_AGENT_YOUTUBE_EXTRACTION_THINKING_MODE must be "
                "enabled, disabled, or auto"
            )
        return normalized
    # DeepSeek V4 enables thinking by default. Structured JSON extraction needs
    # deterministic final content, not a reasoning trace that can exhaust the
    # output budget before content is emitted.
    return (
        "disabled"
        if urlparse(endpoint).hostname in {"api.deepseek.com"}
        else None
    )


def resolve_extraction_config(env: dict[str, str] | None = None) -> ExtractionConfig:
    source = env or os.environ
    endpoint = (
        source.get("TFT_AGENT_YOUTUBE_EXTRACTION_ENDPOINT")
        or source.get("TFT_AGENT_CONCLUSION_ENDPOINT")
        or source.get("OPENAI_BASE_URL")
        or ""
    ).strip()
    model = (
        source.get("TFT_AGENT_YOUTUBE_EXTRACTION_MODEL")
        or source.get("TFT_AGENT_CONCLUSION_MODEL")
        or source.get("MODEL_NAME")
        or source.get("OPENAI_MODEL")
        or ""
    ).strip()
    api_key = (
        source.get("TFT_AGENT_YOUTUBE_EXTRACTION_API_KEY")
        or source.get("TFT_AGENT_CONCLUSION_API_KEY")
        or source.get("OPENAI_API_KEY")
        or ""
    ).strip() or None
    missing = [
        name for name, value in {
            "TFT_AGENT_YOUTUBE_EXTRACTION_ENDPOINT": endpoint,
            "TFT_AGENT_YOUTUBE_EXTRACTION_MODEL": model,
        }.items() if not value
    ]
    if missing:
        raise ValueError("Missing extraction configuration: " + ", ".join(missing))
    return ExtractionConfig(
        endpoint=_chat_endpoint(endpoint),
        model=model,
        api_key=api_key,
        timeout_seconds=float(source.get("TFT_AGENT_YOUTUBE_EXTRACTION_TIMEOUT_MS", "45000")) / 1000,
        max_output_tokens=int(source.get("TFT_AGENT_YOUTUBE_EXTRACTION_MAX_OUTPUT_TOKENS", "4000")),
        retry_empty_once=_boolean_env(
            source.get("TFT_AGENT_YOUTUBE_EXTRACTION_RETRY_EMPTY_ONCE"),
            True,
        ),
        prompt_version=str(
            source.get("TFT_AGENT_YOUTUBE_EXTRACTION_PROMPT_VERSION") or PROMPT_VERSION
        ),
        thinking_mode=_thinking_mode(
            source.get("TFT_AGENT_YOUTUBE_EXTRACTION_THINKING_MODE"),
            endpoint,
        ),
        transport_retries=max(
            0,
            int(source.get("TFT_AGENT_YOUTUBE_EXTRACTION_TRANSPORT_RETRIES", "2")),
        ),
        transport_retry_delay_seconds=max(
            0,
            float(source.get(
                "TFT_AGENT_YOUTUBE_EXTRACTION_TRANSPORT_RETRY_DELAY_MS",
                "1000",
            )) / 1000,
        ),
    )


def _response_content(payload: dict[str, Any]) -> Any:
    if isinstance(payload.get("output_text"), str):
        return payload["output_text"]
    choices = payload.get("choices") or []
    if not choices:
        return None
    content = (choices[0].get("message") or {}).get("content", choices[0].get("text"))
    if isinstance(content, list):
        return "".join(str(part.get("text") or part.get("content") or "") for part in content)
    return content


def _json_object(content: Any) -> dict[str, Any]:
    if isinstance(content, dict):
        return content
    text = str(content or "").strip()
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", text, re.IGNORECASE | re.DOTALL)
    if fenced:
        text = fenced.group(1).strip()
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            raise
        value = json.loads(text[start:end + 1])
    if not isinstance(value, dict):
        raise ValueError("Extraction response must be a JSON object")
    return value


def _dominant_script(value: Any) -> str | None:
    text = str(value or "")
    latin = len(re.findall(r"[A-Za-z]", text))
    han = len(re.findall(r"[\u3400-\u9fff]", text))
    if latin >= 20 and latin >= han * 3:
        return "latin"
    if han >= 8 and han >= latin * 2:
        return "han"
    return None


def _claim_language_matches_transcript(
    claim: str,
    segment: dict[str, Any],
) -> bool:
    transcript_script = _dominant_script(segment.get("timestampedText"))
    claim_script = _dominant_script(claim)
    return not (
        transcript_script
        and claim_script
        and transcript_script != claim_script
    )


def _normalize_claim(
    value: Any,
    segment: dict[str, Any],
) -> tuple[dict[str, Any] | None, list[str]]:
    errors: list[str] = []
    if not isinstance(value, dict):
        return None, ["claim must be an object"]
    claim_type = str(value.get("type") or "").strip()
    claim = str(value.get("claim") or "").strip()
    raw_subjects = value.get("subjects", [])
    raw_conditions = value.get("conditions", [])
    if not isinstance(raw_subjects, list):
        errors.append("subjects must be an array")
        raw_subjects = []
    if not isinstance(raw_conditions, list):
        errors.append("conditions must be an array")
        raw_conditions = []
    subjects = [str(entry).strip() for entry in raw_subjects if str(entry).strip()]
    conditions = [str(entry).strip() for entry in raw_conditions if str(entry).strip()]
    confidence = str(value.get("confidence") or "creator_advice").strip()
    normalization_warnings: list[dict[str, Any]] = []
    if confidence == "strategic_advice" and not conditions:
        confidence = "creator_advice"
        normalization_warnings.append({
            "code": "unconditional_strategic_advice_normalized",
            "from": "strategic_advice",
            "to": "creator_advice",
        })
    if confidence == "speculation" and not has_explicit_uncertainty(claim):
        confidence = "creator_advice"
        normalization_warnings.append({
            "code": "unmarked_speculation_normalized",
            "from": "speculation",
            "to": "creator_advice",
        })
    try:
        timestamp_start = float(value.get("timestampStart", segment["timestampStart"]))
        timestamp_end = float(value.get("timestampEnd", timestamp_start))
    except (TypeError, ValueError):
        return None, errors + ["timestamps must be numeric"]
    if claim_type not in ALLOWED_TYPES:
        errors.append("type is invalid")
    if confidence not in ALLOWED_CONFIDENCE:
        errors.append("confidence is invalid")
    if not claim:
        errors.append("claim is required")
    if not subjects:
        errors.append("subjects must not be empty")
    if claim and not _claim_language_matches_transcript(claim, segment):
        errors.append("claim language must match transcript language")
    if errors:
        return None, errors
    snippets = segment.get("snippets")
    if isinstance(snippets, list) and snippets:
        usable = [
            {
                "start": float(item["start"]),
                "end": float(item["start"]) + float(item.get("duration", 0)),
                "text": str(item.get("text") or ""),
            }
            for item in snippets
            if isinstance(item, dict) and item.get("start") is not None
        ]
        if usable:
            searchable = " ".join([claim, *subjects, *conditions])

            def compact(text: Any) -> str:
                return re.sub(r"[\W_]+", "", str(text or "").lower(), flags=re.UNICODE)

            search_text = compact(searchable)
            search_bigrams = {
                search_text[index:index + 2]
                for index in range(max(0, len(search_text) - 1))
            }
            scored: list[tuple[float, dict[str, Any]]] = []
            for item in usable:
                snippet_text = compact(item["text"])
                snippet_bigrams = {
                    snippet_text[index:index + 2]
                    for index in range(max(0, len(snippet_text) - 1))
                }
                overlap = len(search_bigrams & snippet_bigrams)
                direct = sum(
                    3 + len(term)
                    for term in [*subjects, *conditions]
                    if len(compact(term)) >= 2 and compact(term) in snippet_text
                )
                scored.append((float(overlap + direct), item))
            def lexical_selection(
                candidates: list[tuple[float, dict[str, Any]]],
            ) -> list[dict[str, Any]]:
                maximum = max((score for score, _item in candidates), default=0)
                return [
                    item
                    for score, item in candidates
                    if score >= 2 and score >= maximum * 0.5
                ]

            local_scored = [
                (score, item)
                for score, item in scored
                if item["start"] >= timestamp_start - 3
                and item["start"] < timestamp_end + 3
            ]
            lexical = lexical_selection(local_scored)
            if lexical:
                selected = lexical
                strategy = "lexical_within_model_range"
            else:
                global_lexical = lexical_selection(scored)
                if global_lexical:
                    selected = global_lexical
                    strategy = "lexical_global_fallback"
                else:
                    raw_is_in_segment = (
                        timestamp_start >= float(segment["timestampStart"])
                        and timestamp_end <= float(segment["timestampEnd"]) + 2
                        and timestamp_end >= timestamp_start
                    )
                    if raw_is_in_segment:
                        anchor = min(
                            usable,
                            key=lambda item: abs(item["start"] - timestamp_start),
                        )
                        selected = [
                            item
                            for item in usable
                            if item["start"] >= anchor["start"]
                            and item["start"] < timestamp_end
                        ] or [anchor]
                        strategy = "nearest"
                    else:
                        selected = []
                        strategy = "none"
            anchored_start = min(
                (item["start"] for item in selected),
                default=timestamp_start,
            )
            anchored_end = max(
                (item["end"] for item in selected),
                default=timestamp_end,
            )
            if (
                abs(anchored_start - timestamp_start) > 0.001
                or abs(anchored_end - timestamp_end) > 0.001
            ):
                normalization_warnings.append({
                    "code": "timestamps_anchored_to_transcript_snippets",
                    "strategy": strategy,
                    "rawTimestampStart": timestamp_start,
                    "rawTimestampEnd": timestamp_end,
                    "timestampStart": anchored_start,
                    "timestampEnd": anchored_end,
                })
            timestamp_start = anchored_start
            timestamp_end = anchored_end
    if timestamp_start < float(segment["timestampStart"]):
        errors.append("timestampStart precedes segment")
    if timestamp_end > float(segment["timestampEnd"]) + 2:
        errors.append("timestampEnd exceeds segment")
    if timestamp_end < timestamp_start:
        errors.append("timestampEnd precedes timestampStart")
    if errors:
        return None, errors
    return {
        "type": claim_type,
        "subjects": subjects[:12],
        "claim": claim[:2000],
        "conditions": conditions[:12],
        "timestampStart": timestamp_start,
        "timestampEnd": timestamp_end,
        "patchSpecific": bool(value.get("patchSpecific")),
        "confidence": confidence,
        "normalizationWarnings": normalization_warnings,
    }, []


def _request_payload(
    config: ExtractionConfig,
    messages: list[dict[str, str]],
    opener: Callable[..., Any] | None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "model": config.model,
        "messages": messages,
        "temperature": 0,
        "max_tokens": config.max_output_tokens,
        "response_format": {"type": "json_object"},
    }
    if config.thinking_mode:
        body["thinking"] = {"type": config.thinking_mode}
    request = Request(
        config.endpoint,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            **({"Authorization": f"Bearer {config.api_key}"} if config.api_key else {}),
        },
    )
    open_impl = opener or urlopen
    for retry_index in range(config.transport_retries + 1):
        try:
            with open_impl(request, timeout=config.timeout_seconds) as response:
                payload = json.loads(response.read().decode("utf-8"))
                if not isinstance(payload, dict):
                    raise ValueError("Provider response must be a JSON object")
                payload["_tftAgentTransportRetryCount"] = retry_index
                return payload
        except HTTPError as exc:
            transient = exc.code in {408, 409, 425, 429} or exc.code >= 500
            if not transient or retry_index >= config.transport_retries:
                raise
        except (URLError, TimeoutError, OSError):
            if retry_index >= config.transport_retries:
                raise
        if config.transport_retry_delay_seconds:
            time.sleep(
                config.transport_retry_delay_seconds * (retry_index + 1)
            )
    raise RuntimeError("unreachable transport retry state")


def _base_messages(segment: dict[str, Any]) -> list[dict[str, str]]:
    user_prompt = (
        f"Segment range: {segment['timestampStart']:.3f} to "
        f"{segment['timestampEnd']:.3f} seconds.\n"
        f"Timestamped transcript:\n{segment['timestampedText']}"
    )
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]


def _attempt_record(
    number: int,
    kind: str,
    payload: dict[str, Any] | None,
    content: Any,
    error: Exception | None,
    rejected: list[dict[str, Any]],
) -> dict[str, Any]:
    transport_retry_count = (
        payload.get("_tftAgentTransportRetryCount", 0)
        if isinstance(payload, dict)
        else 0
    )
    raw_payload = (
        {
            key: value
            for key, value in payload.items()
            if key != "_tftAgentTransportRetryCount"
        }
        if isinstance(payload, dict)
        else payload
    )
    return {
        "attempt": number,
        "kind": kind,
        "status": "failed" if error else "success",
        "rawProviderResponse": raw_payload,
        "rawModelResponse": content,
        "parseOrContractError": str(error) if error else None,
        "rejectedClaims": rejected,
        "usage": payload.get("usage") if isinstance(payload, dict) else None,
        "transportRetryCount": transport_retry_count,
    }


def _parse_attempt(
    payload: dict[str, Any],
    segment: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], Any]:
    content = _response_content(payload)
    parsed = _json_object(content)
    knowledge = parsed.get("knowledge")
    if not isinstance(knowledge, list):
        raise ValueError("Extraction response must contain a knowledge array")
    claims: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    for index, value in enumerate(knowledge):
        normalized, errors = _normalize_claim(value, segment)
        if normalized is not None:
            claims.append(normalized)
        else:
            rejected.append({
                "index": index,
                "errors": errors,
                "value": value,
            })
    return claims, rejected, content


def extract_guide_claims_detailed(
    segment: dict[str, Any],
    config: ExtractionConfig,
    opener: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    """Extract one segment while retaining every response and one repair attempt."""

    attempts: list[dict[str, Any]] = []
    base_messages = _base_messages(segment)
    payload: dict[str, Any] | None = None
    raw_content: Any = None
    first_error: Exception | None = None
    try:
        payload = _request_payload(config, base_messages, opener)
        claims, rejected, raw_content = _parse_attempt(payload, segment)
        attempts.append(_attempt_record(1, "extract", payload, raw_content, None, rejected))
        if claims:
            return {
                "status": "success",
                "claims": claims,
                "attempts": attempts,
                "repaired": False,
                "emptyConfirmed": False,
                "rejectedClaims": rejected,
            }
        if rejected:
            repair_reason = (
                "Every returned claim failed the contract: "
                + json.dumps(rejected, ensure_ascii=False)
            )
            repair_kind = "json_repair"
        elif not config.retry_empty_once:
            return {
                "status": "empty",
                "claims": [],
                "attempts": attempts,
                "repaired": False,
                "emptyConfirmed": True,
                "rejectedClaims": [],
            }
        else:
            repair_reason = "The first valid response was empty. Re-check the transcript once."
            repair_kind = "empty_confirmation"
    except Exception as exc:
        first_error = exc
        raw_content = _response_content(payload or {})
        attempts.append(_attempt_record(1, "extract", payload, raw_content, exc, []))
        repair_reason = str(exc)
        repair_kind = "json_repair"

    repair_messages = [
        {"role": "system", "content": SYSTEM_PROMPT + "\n\n" + REPAIR_PROMPT},
        {
            "role": "user",
            "content": (
                f"{base_messages[1]['content']}\n\n"
                f"Previous response:\n{raw_content}\n\n"
                f"Validation problem:\n{repair_reason}"
            ),
        },
    ]
    repair_payload: dict[str, Any] | None = None
    repair_content: Any = None
    try:
        repair_payload = _request_payload(config, repair_messages, opener)
        claims, rejected, repair_content = _parse_attempt(repair_payload, segment)
        attempts.append(_attempt_record(
            2,
            repair_kind,
            repair_payload,
            repair_content,
            None,
            rejected,
        ))
        if rejected and not claims:
            return {
                "status": "failed",
                "claims": [],
                "attempts": attempts,
                "repaired": repair_kind == "json_repair",
                "emptyConfirmed": False,
                "rejectedClaims": rejected,
                "error": "all claims failed contract validation after repair",
            }
        return {
            "status": "success" if claims else "empty",
            "claims": claims,
            "attempts": attempts,
            "repaired": repair_kind == "json_repair",
            "emptyConfirmed": not claims,
            "rejectedClaims": rejected,
        }
    except Exception as exc:
        repair_content = _response_content(repair_payload or {})
        attempts.append(_attempt_record(
            2,
            repair_kind,
            repair_payload,
            repair_content,
            exc,
            [],
        ))
        return {
            "status": "failed",
            "claims": [],
            "attempts": attempts,
            "repaired": False,
            "emptyConfirmed": False,
            "rejectedClaims": [],
            "error": str(exc),
            "initialError": str(first_error) if first_error else None,
        }


def extract_guide_claims(
    segment: dict[str, Any],
    config: ExtractionConfig,
    opener: Callable[..., Any] | None = None,
) -> list[dict[str, Any]]:
    result = extract_guide_claims_detailed(segment, config, opener=opener)
    if result["status"] == "failed":
        raise ExtractionError(result.get("error") or "segment extraction failed")
    return result["claims"]
