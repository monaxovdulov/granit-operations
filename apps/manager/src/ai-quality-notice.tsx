import { Alert, Badge, Group, Text } from "@mantine/core";
import { AlertCircle } from "lucide-react";

import {
  aiQualityEventLabel,
  aiQualityReasonLabel,
  aiQualitySeverityColor,
  aiRunStatusLabel,
  formatDate
} from "./display";
import type { ManagerAiQualitySummary } from "./types";

export function AiQualityNotice({ quality }: { quality?: ManagerAiQualitySummary }) {
  if (!quality) {
    return null;
  }

  const color = aiQualitySeverityColor(quality.severity);

  return (
    <Alert
      color={color}
      variant="light"
      icon={<AlertCircle size={18} />}
      title={aiQualityEventLabel(quality.eventType)}
      aria-label="Состояние AI требует внимания"
    >
      <Text size="sm">{aiQualityReasonLabel(quality.reasonCode)}</Text>
      <Group gap="xs" mt="xs">
        <Badge color={color} variant="outline">
          {aiRunStatusLabel(quality.runStatus)}
        </Badge>
        <Text size="xs" c="dimmed">
          {formatDate(quality.createdAt)}
        </Text>
      </Group>
    </Alert>
  );
}
