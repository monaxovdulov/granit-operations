import type { AiTurnInput } from '../../ai/ai-turn.js';

export type AiDialogMessageRow = {
  publicMessageId: string;
  direction: string;
  senderRole: string;
  contentType: string;
  submittedAt: Date;
  body: string;
};

/** Projects newest-first database rows into an oldest-first model-safe transcript. */
export function toAiDialogTranscript(
  rows: AiDialogMessageRow[],
  currentPublicMessageId: string,
): AiTurnInput['compactContext']['messages'] {
  const seenPublicMessageIds = new Set([currentPublicMessageId]);
  const newestFirst: AiTurnInput['compactContext']['messages'] = [];

  for (const row of rows) {
    const text = row.body.trim();
    const isVisitor = row.direction === 'inbound' && row.senderRole === 'visitor';
    const isAssistant =
      row.direction === 'outbound' && row.senderRole === 'ai_assistant';

    if (
      seenPublicMessageIds.has(row.publicMessageId) ||
      row.contentType !== 'text' ||
      (!isVisitor && !isAssistant) ||
      !text
    ) {
      continue;
    }

    seenPublicMessageIds.add(row.publicMessageId);
    newestFirst.push({
      publicMessageId: row.publicMessageId,
      direction: isVisitor ? 'inbound' : 'outbound',
      senderRole: isVisitor ? 'visitor' : 'ai_assistant',
      contentType: 'text',
      submittedAt: row.submittedAt.toISOString(),
      text,
    });
  }

  return newestFirst.reverse();
}
