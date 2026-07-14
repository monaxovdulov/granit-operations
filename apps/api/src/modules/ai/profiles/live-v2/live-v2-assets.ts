import { z } from "zod";

export const LIVE_V2_FACTS_VERSION = "granit_live_v2_facts.v1" as const;

const gitShaSchema = z.string().regex(/^[a-f0-9]{40}$/);
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isIsoCalendarDate, "date must be a real UTC calendar date");
const liveV2FactSourceSchema = z
  .object({
    repo: z.literal("granit-site-cms"),
    commit: gitShaSchema,
    path: z.string().trim().min(1).max(300),
    lines: z.string().trim().min(1).max(80),
    blobSha: gitShaSchema
  })
  .strict();

export const liveV2FactSchema = z
  .object({
    id: z.string().regex(/^P1Q-(?:TYPE|MAT|DECOR|PROC)-\d{3}$/),
    category: z.enum(["product_type", "material", "decoration", "process"]),
    allowedCustomerWording: z.string().trim().min(1).max(500),
    forbiddenExtrapolations: z.array(z.string().trim().min(1).max(300)).min(1).max(8),
    sources: z.array(liveV2FactSourceSchema).min(1).max(4),
    ownerApproved: z.literal(true),
    validFrom: isoDateSchema,
    reviewBy: isoDateSchema
  })
  .strict()
  .superRefine((fact, context) => {
    if (
      /(?:\d[\d\s]*(?:₽|руб)|(?:^|[^\p{L}\p{N}])(?:цен|стоимост|срок|налич|скид|оплат|договор|гарант|юрид))/iu.test(
        fact.allowedCustomerWording
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allowedCustomerWording"],
        message: "approved wording must not contain commercial, deadline, warranty or legal claims"
      });
    }

    if (fact.reviewBy <= fact.validFrom) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reviewBy"],
        message: "reviewBy must be after validFrom"
      });
    }
  });

export const liveV2FactsSnapshotSchema = z
  .object({
    version: z.literal(LIVE_V2_FACTS_VERSION),
    ownerReviewId: z.string().trim().min(1).max(120),
    facts: z.array(liveV2FactSchema).min(1).max(40)
  })
  .strict()
  .superRefine((snapshot, context) => {
    const seen = new Set<string>();

    for (const [index, fact] of snapshot.facts.entries()) {
      if (seen.has(fact.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["facts", index, "id"],
          message: "fact IDs must be unique"
        });
      }
      seen.add(fact.id);
    }
  });

export type LiveV2Fact = z.infer<typeof liveV2FactSchema>;
export type LiveV2FactsSnapshot = z.infer<typeof liveV2FactsSnapshotSchema>;
export type LiveV2ModelFact = Pick<
  LiveV2Fact,
  "id" | "category" | "allowedCustomerWording" | "forbiddenExtrapolations"
>;
export type LiveV2ModelFactsAsset = {
  version: typeof LIVE_V2_FACTS_VERSION;
  facts: LiveV2ModelFact[];
};

export function parseLiveV2FactsSnapshot(
  value: unknown,
  options: { asOfDate?: string } = {}
): LiveV2FactsSnapshot {
  const snapshot = liveV2FactsSnapshotSchema.parse(value);
  const asOfDate = options.asOfDate ?? new Date().toISOString().slice(0, 10);

  if (!isIsoCalendarDate(asOfDate)) {
    throw new Error("live_v2 facts asOfDate must be a real UTC calendar date");
  }

  const unavailableFact = snapshot.facts.find(
    (fact) => fact.validFrom > asOfDate || fact.reviewBy <= asOfDate
  );

  if (unavailableFact) {
    throw new Error(`live_v2 fact ${unavailableFact.id} is outside its approval window`);
  }

  return snapshot;
}

export function liveV2ApprovedFactIds(snapshot: LiveV2FactsSnapshot): ReadonlySet<string> {
  return new Set(snapshot.facts.map((fact) => fact.id));
}

export function toLiveV2ModelFactsAsset(
  snapshot: LiveV2FactsSnapshot
): LiveV2ModelFactsAsset {
  return {
    version: snapshot.version,
    facts: snapshot.facts.map((fact) => ({
      id: fact.id,
      category: fact.category,
      allowedCustomerWording: fact.allowedCustomerWording,
      forbiddenExtrapolations: [...fact.forbiddenExtrapolations]
    }))
  };
}

function isIsoCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
