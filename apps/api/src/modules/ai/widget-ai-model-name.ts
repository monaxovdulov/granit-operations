const WIDGET_AI_MODEL_NAME_PATTERN = /^[A-Za-z0-9._:/@+-]{1,120}$/;

export function isSafeWidgetAiModelName(value: unknown): value is string {
  return typeof value === "string" && WIDGET_AI_MODEL_NAME_PATTERN.test(value);
}
