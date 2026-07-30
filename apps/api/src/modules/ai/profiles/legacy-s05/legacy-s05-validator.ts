import type {
  AiReplyCandidateDecision,
  AiReplyCandidateEvidence,
  AiUnavailableReason
} from "../../ai-turn.js";

// P1 intentionally keeps all business/price sources closed. P1Q introduces separately reviewed
// live_v2 assets; the legacy rollback profile must not self-approve facts from model output.
const LEGACY_S05_APPROVED_BUSINESS_FACT_SOURCE_IDS = new Set<string>();
const LEGACY_S05_APPROVED_PRICE_SOURCE_IDS = new Set<string>();

export function validateLegacyS05Candidate(value: unknown): AiReplyCandidateDecision {
  if (!isRecord(value)) {
    return unavailable("unsafe_model_response");
  }

  if (value.decision === "no_reply") {
    return {
      decision: "no_reply",
      reason: isAiUnavailableReason(value.reason) ? value.reason : "unsafe_model_response",
      metadata: isRecord(value.metadata) ? value.metadata : {}
    };
  }

  if (value.decision !== "reply_candidate" || !isRecord(value.metadata)) {
    return unavailable("unsafe_model_response");
  }

  if (
    "agentAllowedToReplyAfterSend" in value &&
    value.agentAllowedToReplyAfterSend !== undefined &&
    typeof value.agentAllowedToReplyAfterSend !== "boolean"
  ) {
    return unavailable("unsafe_model_response");
  }

  const text = typeof value.text === "string" ? normalizeCandidateText(value.text) : "";

  if (!text) {
    return unavailable(
      typeof value.text === "string" ? "empty_model_response" : "unsafe_model_response"
    );
  }

  const evidence = isRecord(value.evidence) ? readCandidateEvidence(value.evidence) : undefined;

  if (hasBusinessFactWithoutAppApprovedSource(evidence)) {
    return unavailable("unsafe_model_response");
  }

  if (unsafeCandidateReplyReason(text, evidence)) {
    return unavailable("unsafe_model_response");
  }

  return {
    decision: "reply_candidate",
    text,
    agentAllowedToReplyAfterSend:
      typeof value.agentAllowedToReplyAfterSend === "boolean"
        ? value.agentAllowedToReplyAfterSend
        : undefined,
    metadata: value.metadata,
    ...(evidence ? { evidence } : {})
  };
}

function unavailable(reason: AiUnavailableReason): AiReplyCandidateDecision {
  return {
    decision: "no_reply",
    reason,
    metadata: {
      validation: "legacy_s05_rejected"
    }
  };
}

function isAiUnavailableReason(value: unknown): value is AiUnavailableReason {
  return (
    value === "missing_openai_config" ||
    value === "model_error" ||
    value === "empty_model_response" ||
    value === "unsafe_model_response"
  );
}

function normalizeCandidateText(value: string): string {
  return value.trim().replace(/\n{3,}/g, "\n\n").slice(0, 900);
}

function readCandidateEvidence(value: Record<string, unknown>): AiReplyCandidateEvidence {
  const businessFacts: AiReplyCandidateEvidence["businessFacts"] = Array.isArray(
    value.businessFacts
  )
    ? value.businessFacts.map((fact) => {
        if (!isRecord(fact)) {
          return { kind: "business_fact" as const };
        }

        const kind: "price" | "business_fact" =
          fact.kind === "price" ? "price" : "business_fact";
        const approvedSourceId =
          typeof fact.approvedSourceId === "string" && fact.approvedSourceId.trim()
            ? fact.approvedSourceId
            : undefined;

        return {
          kind,
          approvedSourceId
        };
      })
    : undefined;

  return { businessFacts };
}

function hasBusinessFactWithoutAppApprovedSource(
  evidence: AiReplyCandidateEvidence | undefined
): boolean {
  return Boolean(
    evidence?.businessFacts?.some(
      (fact) => !isAppApprovedBusinessFactSource(fact.kind, fact.approvedSourceId)
    )
  );
}

function unsafeCandidateReplyReason(
  text: string,
  evidence: AiReplyCandidateEvidence | undefined
): string | null {
  const normalized = text.toLocaleLowerCase("ru-RU");

  if (hasStageAPriceAmountOrOrientation(normalized) && !hasAppApprovedPriceSource(evidence)) {
    return "price_amount_without_approved_source";
  }

  if (/(?:за|через)\s+\d+\s*(?:дн|час|нед|месяц)|\d+\s*(?:дн|час|нед|месяц)|будет готов|точн(?:о|ые сроки)|к\s+\d{1,2}[./]\d{1,2}/i.test(normalized)) {
    return "exact_deadline_promise";
  }

  if (/(гарантируем|предоставим гарантию|скидк[ауи]\s*\d|в наличии|заключим договор|подпишем договор|можно оплатить|рассрочк[ау])/i.test(normalized)) {
    return "binding_terms_promise";
  }

  if (/(по закону|юридическ(?:ая консультация|ие советы|и можно|и нужно)|наследств|оформить захоронение|похоронные документы)/i.test(normalized)) {
    return "legal_funeral_advice";
  }

  return null;
}

function hasStageAPriceAmountOrOrientation(normalized: string): boolean {
  if (/\d[\d\s]*(?:₽|руб|р\.)/i.test(normalized)) {
    return true;
  }

  if (!/(цен|стоим|стоить|стоит|прайс|бюджет|сумм)/i.test(normalized)) {
    return false;
  }

  return /(?:^|\s)(?:от|примерно|ориентир(?:овочно)?|порядка|около|в районе)\s+\d[\d\s]*(?:тыс|тысяч)?|\d[\d\s]*(?:[-–—]|\s+до\s+)\d[\d\s]*(?:тыс|тысяч)?|(?:^|\s)\d[\d\s]{3,}(?:[.,!?]|\s|$)|(?:^|\s)\d+\s*(?:тыс|тысяч)/i.test(
    normalized
  );
}

function hasAppApprovedPriceSource(evidence: AiReplyCandidateEvidence | undefined): boolean {
  return Boolean(
    evidence?.businessFacts?.some(
      (fact) =>
        fact.kind === "price" && isAppApprovedBusinessFactSource(fact.kind, fact.approvedSourceId)
    )
  );
}

function isAppApprovedBusinessFactSource(
  kind: "price" | "business_fact",
  approvedSourceId: string | undefined
): boolean {
  if (!approvedSourceId?.trim()) {
    return false;
  }

  return kind === "price"
    ? LEGACY_S05_APPROVED_PRICE_SOURCE_IDS.has(approvedSourceId.trim())
    : LEGACY_S05_APPROVED_BUSINESS_FACT_SOURCE_IDS.has(approvedSourceId.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
