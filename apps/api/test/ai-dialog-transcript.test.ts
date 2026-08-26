import { describe, expect, it } from 'vitest';

import {
  toAiDialogTranscript,
  type AiDialogMessageRow,
} from '../src/modules/conversations/repositories/ai-dialog-transcript.js';

describe('model-safe AI dialog transcript', () => {
  it('keeps eligible rows chronological and deduplicates current and public identities', () => {
    const currentPublicMessageId = 'current-public-message';
    const rows = [
      row('duplicate-public', 6, 'outbound', 'ai_assistant', 'newest duplicate'),
      row(currentPublicMessageId, 5, 'inbound', 'visitor', 'duplicate current'),
      row('manager', 4, 'outbound', 'manager', 'internal manager note'),
      row('non-text', 3, 'inbound', 'visitor', 'attachment', 'image'),
      row('duplicate-public', 2, 'outbound', 'ai_assistant', 'older duplicate'),
      row('visitor', 1, 'inbound', 'visitor', 'first visitor message'),
    ];

    const transcript = toAiDialogTranscript(rows, currentPublicMessageId);

    expect(transcript.map((message) => message.text)).toEqual([
      'first visitor message',
      'newest duplicate',
    ]);
    expect(JSON.stringify(transcript)).not.toContain('internal manager note');
    expect(JSON.stringify(transcript)).not.toContain('duplicate current');
    expect(JSON.stringify(transcript)).not.toContain('attachment');
  });
});

function row(
  publicMessageId: string,
  sequence: number,
  direction: string,
  senderRole: string,
  body: string,
  contentType = 'text',
): AiDialogMessageRow {
  return {
    publicMessageId,
    direction,
    senderRole,
    contentType,
    submittedAt: new Date(`2026-08-26T10:00:0${sequence}.000Z`),
    body,
  };
}
