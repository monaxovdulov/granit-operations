export type M3SmokeEvidenceInput = {
  httpStatus: number;
  publicOk: boolean;
  publicFresh: boolean;
  publicReplayed: boolean;
  automationReplied: boolean;
  replyPresent: boolean;
  runtimeMode: string;
  decisionProfile: string;
  runStatus: string;
  decisionAction: string | null;
  outcomeReason: string | null;
  failureCode: string | null;
  validatorResult: string;
  sendGateResult: string;
  outboundLinked: boolean;
  runtimeLinked: boolean;
  usageLinked: boolean;
  spanCount: number;
  failedSpanCount: number;
  qualityEventCount: number;
  openManagerQualityEventCount: number;
  managerReviewRequired: boolean;
  configuredProvider: string;
  configuredModel: string;
  observedProvider: string | null;
  observedModel: string | null;
};

export function isSuccessfulM3Smoke(input: M3SmokeEvidenceInput): boolean {
  return (
    input.httpStatus === 202 &&
    input.publicOk &&
    input.publicFresh &&
    !input.publicReplayed &&
    input.automationReplied &&
    input.replyPresent &&
    input.runtimeMode === "mastra_openai_api" &&
    input.decisionProfile === "live_v2" &&
    input.runStatus === "persisted" &&
    (input.decisionAction === "answer" ||
      input.decisionAction === "ask_clarifying_question") &&
    input.outcomeReason === "reply_persisted" &&
    input.failureCode === null &&
    input.validatorResult === "passed" &&
    input.sendGateResult === "allowed" &&
    input.outboundLinked &&
    input.runtimeLinked &&
    input.spanCount > 0 &&
    input.failedSpanCount === 0 &&
    input.qualityEventCount === 0 &&
    input.openManagerQualityEventCount === 0 &&
    !input.managerReviewRequired &&
    input.configuredProvider === "openai" &&
    input.configuredModel === "gpt-5.6-sol" &&
    input.observedProvider === "openai" &&
    input.observedModel === "gpt-5.6-sol"
  );
}

export function m3SmokeExitCode(ok: boolean): 0 | 1 {
  return ok ? 0 : 1;
}

export function summarizeM3PublicResult(value: unknown, history?: unknown): {
  ok: boolean;
  fresh: boolean;
  replayed: boolean;
  automationReplied: boolean;
  replyPresent: boolean;
} {
  const automation = isRecord(value) && isRecord(value.automation)
    ? value.automation
    : undefined;
  const historyMessages =
    isRecord(history) && Array.isArray(history.messages) ? history.messages : [];
  const historyReplied = historyMessages.some(
    (message) => isRecord(message) && isRecord(message.automation) &&
      message.automation.status === "replied"
  );
  const historyReplyPresent = historyMessages.some(
    (message) => isRecord(message) && message.sender_role === "ai_assistant"
  );
  return {
    ok: isRecord(value) && value.ok === true,
    fresh: isRecord(value) && value.status === "accepted",
    replayed: isRecord(value) && value.status === "replayed",
    automationReplied: automation?.status === "replied" || historyReplied,
    replyPresent: isRecord(automation?.reply) || historyReplyPresent
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
