import { describe, expect, it } from "vitest";

import {
  LIVE_V2_FACTS_VERSION,
  parseLiveV2FactsSnapshot,
  toLiveV2ModelFactsAsset
} from "../src/modules/ai/profiles/live-v2/live-v2-assets.js";
import { LIVE_V2_FACTS_SNAPSHOT } from "../src/modules/ai/profiles/live-v2/facts.v1.js";
import { LIVE_V2_PROMPT_ASSET } from "../src/modules/ai/profiles/live-v2/assets/prompt.v1.js";
import { LIVE_V2_TONE_ASSET } from "../src/modules/ai/profiles/live-v2/assets/tone.v1.js";
import { LIVE_V2_PROFILE } from "../src/modules/ai/profiles/live-v2/live-v2-profile.js";
import {
  TEST_LIVE_V2_AS_OF_DATE,
  TEST_LIVE_V2_FACTS
} from "./fixtures/live-v2-synthetic.v1.js";

const SOURCE_COMMIT_FOR_ASSERTION = "23f2ee8c39ee2af30ca79cf9f2e5c4dd0229bf2a";
const OWNER_REVIEW_ID_FOR_ASSERTION =
  "G1Q-2026-07-14-owner-accepted-all-15-23f2ee8c";
const VALID_FROM_FOR_ASSERTION = "2026-07-14";
const REVIEW_BY_FOR_ASSERTION = "2026-10-14";
const EXPECTED_APPROVAL = {
  ownerApproved: true,
  validFrom: VALID_FROM_FOR_ASSERTION,
  reviewBy: REVIEW_BY_FOR_ASSERTION
} as const;

function expectedSource(path: string, lines: string, blobSha: string) {
  return {
    repo: "granit-site-cms",
    commit: SOURCE_COMMIT_FOR_ASSERTION,
    path,
    lines,
    blobSha
  };
}

const EXPECTED_LIVE_V2_FACTS = [
  {
    id: "P1Q-TYPE-001",
    category: "product_type",
    allowedCustomerWording: "В каталоге представлены вертикальные памятники.",
    forbiddenExtrapolations: ["Не обещать наличие модели, цену или срок."],
    sources: [
      expectedSource(
        "apps/site/src/imported-pages/index.html",
        "191",
        "fcae3a14c48fdb9900404ef60e9aa6d465f8071f"
      )
    ],
    ...EXPECTED_APPROVAL
  },
  {
    id: "P1Q-TYPE-002",
    category: "product_type",
    allowedCustomerWording:
      "В каталоге представлены горизонтальные памятники — широкие стелы для семейных надписей и двух портретов.",
    forbiddenExtrapolations: [
      "Не назначать размеры, комплект или вместимость сверх текста."
    ],
    sources: [
      expectedSource(
        "apps/site/src/imported-pages/index.html",
        "192",
        "fcae3a14c48fdb9900404ef60e9aa6d465f8071f"
      )
    ],
    ...EXPECTED_APPROVAL
  },
  {
    id: "P1Q-TYPE-003",
    category: "product_type",
    allowedCustomerWording:
      "Для двойного памятника возможны общая стела либо две отдельные стелы в единой композиции.",
    forbiddenExtrapolations: [
      "Не обещать текущую доступность вариантов или конкретные размеры."
    ],
    sources: [
      expectedSource(
        "apps/site/src/imported-pages/dvoinye-pamyatniki/index.html",
        "243-246,279-280",
        "d8a26e54cf8caaa2480c3837946fd241906302a3"
      )
    ],
    ...EXPECTED_APPROVAL
  },
  {
    id: "P1Q-TYPE-004",
    category: "product_type",
    allowedCustomerWording:
      "Гранитный комплекс может включать цоколь, облицовку, цветник, вазы и дополнительные элементы.",
    forbiddenExtrapolations: [
      "Не утверждать, что любой набор входит в базовую комплектацию."
    ],
    sources: [
      expectedSource(
        "apps/site/src/imported-pages/index.html",
        "193",
        "fcae3a14c48fdb9900404ef60e9aa6d465f8071f"
      )
    ],
    ...EXPECTED_APPROVAL
  },
  {
    id: "P1Q-TYPE-005",
    category: "product_type",
    allowedCustomerWording: "В каталоге представлены ограды, столы, лавки и вазы.",
    forbiddenExtrapolations: [
      "Не обещать наличие, материал или включение всех элементов в заказ."
    ],
    sources: [
      expectedSource(
        "apps/site/src/imported-pages/index.html",
        "195",
        "fcae3a14c48fdb9900404ef60e9aa6d465f8071f"
      )
    ],
    ...EXPECTED_APPROVAL
  },
  {
    id: "P1Q-TYPE-006",
    category: "product_type",
    allowedCustomerWording:
      "В каталоге представлены цоколи и цветники; также указаны гранитные основания и рамки для аккуратной геометрии участка.",
    forbiddenExtrapolations: [
      "Не утверждать обязательность, единый комплект, пригодность для любого участка или размеры."
    ],
    sources: [
      expectedSource(
        "apps/site/src/imported-pages/index.html",
        "196",
        "fcae3a14c48fdb9900404ef60e9aa6d465f8071f"
      )
    ],
    ...EXPECTED_APPROVAL
  },
  {
    id: "P1Q-MAT-001",
    category: "material",
    allowedCustomerWording: "В каталоге указан материал «габбро-диабаз».",
    forbiddenExtrapolations: [
      "Не приписывать происхождение, свойства, долговечность или наличие."
    ],
    sources: [
      expectedSource(
        "apps/site/src/imported-pages/index.html",
        "236",
        "fcae3a14c48fdb9900404ef60e9aa6d465f8071f"
      )
    ],
    ...EXPECTED_APPROVAL
  },
  {
    id: "P1Q-MAT-002",
    category: "material",
    allowedCustomerWording: "В каталоге указан дымовский гранит.",
    forbiddenExtrapolations: [
      "Не приписывать происхождение, свойства, долговечность или наличие."
    ],
    sources: [
      expectedSource(
        "apps/site/src/imported-pages/index.html",
        "237",
        "fcae3a14c48fdb9900404ef60e9aa6d465f8071f"
      )
    ],
    ...EXPECTED_APPROVAL
  },
  {
    id: "P1Q-MAT-003",
    category: "material",
    allowedCustomerWording: "В каталоге указан мансуровский гранит.",
    forbiddenExtrapolations: [
      "Не приписывать происхождение, свойства, долговечность или наличие."
    ],
    sources: [
      expectedSource(
        "apps/site/src/imported-pages/index.html",
        "238",
        "fcae3a14c48fdb9900404ef60e9aa6d465f8071f"
      )
    ],
    ...EXPECTED_APPROVAL
  },
  {
    id: "P1Q-DECOR-001",
    category: "decoration",
    allowedCustomerWording:
      "На вертикальной стеле можно разместить портрет, ФИО и эпитафию.",
    forbiddenExtrapolations: [
      "Не гарантировать качество, размер, число вариантов или допустимость любого содержания."
    ],
    sources: [
      expectedSource(
        "apps/site/src/imported-pages/vertikalnye-pamyatniki/index.html",
        "345-347",
        "995466a086ca5930d2cabbbd98865d50b884ebd9"
      )
    ],
    ...EXPECTED_APPROVAL
  },
  {
    id: "P1Q-DECOR-002",
    category: "decoration",
    allowedCustomerWording:
      "Оформление может включать резной крест, глубокую гравировку, вазу и цветник.",
    forbiddenExtrapolations: [
      "Не утверждать, что элементы входят в базовый комплект или доступны сейчас."
    ],
    sources: [
      expectedSource(
        "apps/site/src/imported-pages/vertikalnye-pamyatniki/index.html",
        "279-283",
        "995466a086ca5930d2cabbbd98865d50b884ebd9"
      )
    ],
    ...EXPECTED_APPROVAL
  },
  {
    id: "P1Q-DECOR-003",
    category: "decoration",
    allowedCustomerWording:
      "На единой стеле двойного памятника можно разместить два портрета и надписи; их согласуют заранее.",
    forbiddenExtrapolations: [
      "Не обещать конкретный макет, число правок или автоматическое принятие оформления."
    ],
    sources: [
      expectedSource(
        "apps/site/src/imported-pages/dvoinye-pamyatniki/index.html",
        "243-247,345-347",
        "d8a26e54cf8caaa2480c3837946fd241906302a3"
      )
    ],
    ...EXPECTED_APPROVAL
  },
  {
    id: "P1Q-PROC-001",
    category: "process",
    allowedCustomerWording:
      "Монтаж на подготовленное основание включает установку комплекта и проверку геометрии.",
    forbiddenExtrapolations: [
      "Не обещать срок, цену, гарантию или пригодность существующего основания."
    ],
    sources: [
      expectedSource(
        "apps/site/src/imported-pages/ustanovka-pamyatnikov/index.html",
        "213-217",
        "fb118d99ffcea108668783f07fbde1fab19846d5"
      )
    ],
    ...EXPECTED_APPROVAL
  },
  {
    id: "P1Q-PROC-002",
    category: "process",
    allowedCustomerWording:
      "Если основание не готово, процесс может включать подготовку основания перед монтажом.",
    forbiddenExtrapolations: [
      "Не обещать, что подготовка всегда возможна или входит в заказ."
    ],
    sources: [
      expectedSource(
        "apps/site/src/imported-pages/ustanovka-pamyatnikov/index.html",
        "231-235",
        "fb118d99ffcea108668783f07fbde1fab19846d5"
      )
    ],
    ...EXPECTED_APPROVAL
  },
  {
    id: "P1Q-PROC-003",
    category: "process",
    allowedCustomerWording:
      "Процесс включает фото участка, оценку работ и согласование выезда; для доставки уточняют адрес, подъезд, состав заказа и готовность участка.",
    forbiddenExtrapolations: [
      "Не обещать конкретную дату, срок, маршрут, стоимость или возможность доставки."
    ],
    sources: [
      expectedSource(
        "apps/site/src/imported-pages/ustanovka-pamyatnikov/index.html",
        "328-330",
        "fb118d99ffcea108668783f07fbde1fab19846d5"
      ),
      expectedSource(
        "apps/site/src/imported-pages/dostavka-i-montazh/index.html",
        "324-325,328-330",
        "332f0a285bab8e37d37407f1d14aa1eba71b6bf8"
      )
    ],
    ...EXPECTED_APPROVAL
  }
];

describe("live_v2 versioned assets", () => {
  it("keeps prompt and tone behavior explicit and versioned", () => {
    expect(LIVE_V2_PROMPT_ASSET.version).toBe("granit_live_v2_prompt.v1");
    expect(LIVE_V2_PROMPT_ASSET.instructions.join("\n")).toContain(
      "не повторяй фразу клиента"
    );
    expect(LIVE_V2_PROMPT_ASSET.instructions.join("\n")).toContain(
      "не больше одного вопроса"
    );
    expect(LIVE_V2_TONE_ASSET).toMatchObject({
      version: "granit_live_v2_tone.v1",
      desired: expect.arrayContaining(["meaning_first", "specific_when_sourced"]),
      avoid: expect.arrayContaining(["empty_echo", "questionnaire"])
    });
    expect(LIVE_V2_PROFILE).toMatchObject({
      id: "live_v2",
      candidateVersion: "granit_live_v2_candidate.v1",
      runtimeEnabledByDefault: false,
      provider: "openai"
    });
    expect(LIVE_V2_PROFILE).not.toHaveProperty("runtimeMode");
    expect(LIVE_V2_PROFILE).not.toHaveProperty("deploymentTier");
  });

  it("accepts a strict source-metadata-pinned test-only facts registry", () => {
    expect(TEST_LIVE_V2_FACTS.version).toBe(LIVE_V2_FACTS_VERSION);
    expect(TEST_LIVE_V2_FACTS.ownerReviewId).toBe("test-only-p1q-fixture");
    expect(TEST_LIVE_V2_FACTS.facts).toHaveLength(3);
  });

  it("loads the exact owner-approved 15-fact production snapshot", () => {
    expect(LIVE_V2_FACTS_SNAPSHOT).toMatchObject({
      version: LIVE_V2_FACTS_VERSION,
      ownerReviewId: OWNER_REVIEW_ID_FOR_ASSERTION
    });
    expect(LIVE_V2_FACTS_SNAPSHOT.facts.map((fact) => fact.id)).toEqual([
      "P1Q-TYPE-001",
      "P1Q-TYPE-002",
      "P1Q-TYPE-003",
      "P1Q-TYPE-004",
      "P1Q-TYPE-005",
      "P1Q-TYPE-006",
      "P1Q-MAT-001",
      "P1Q-MAT-002",
      "P1Q-MAT-003",
      "P1Q-DECOR-001",
      "P1Q-DECOR-002",
      "P1Q-DECOR-003",
      "P1Q-PROC-001",
      "P1Q-PROC-002",
      "P1Q-PROC-003"
    ]);
    expect(LIVE_V2_FACTS_SNAPSHOT.facts).toEqual(EXPECTED_LIVE_V2_FACTS);
    expect(
      LIVE_V2_FACTS_SNAPSHOT.facts.every(
        (fact) =>
          fact.ownerApproved &&
          fact.validFrom === VALID_FROM_FOR_ASSERTION &&
          fact.reviewBy === REVIEW_BY_FOR_ASSERTION &&
          fact.sources.every(
            (factSource) => factSource.commit === SOURCE_COMMIT_FOR_ASSERTION
          )
      )
    ).toBe(true);
    expect(
      LIVE_V2_FACTS_SNAPSHOT.facts.reduce<Record<string, number>>((counts, fact) => {
        counts[fact.category] = (counts[fact.category] ?? 0) + 1;
        return counts;
      }, {})
    ).toEqual({
      product_type: 6,
      material: 3,
      decoration: 3,
      process: 3
    });
    expect(
      LIVE_V2_FACTS_SNAPSHOT.facts.reduce(
        (sourceCount, fact) => sourceCount + fact.sources.length,
        0
      )
    ).toBe(16);
  });

  it("keeps the audited corrections and multi-source process provenance exact", () => {
    const factsById = new Map(
      LIVE_V2_FACTS_SNAPSHOT.facts.map((fact) => [fact.id, fact])
    );

    expect(factsById.get("P1Q-TYPE-005")?.allowedCustomerWording).toBe(
      "В каталоге представлены ограды, столы, лавки и вазы."
    );
    expect(factsById.get("P1Q-TYPE-006")?.allowedCustomerWording).toBe(
      "В каталоге представлены цоколи и цветники; также указаны гранитные основания и рамки для аккуратной геометрии участка."
    );
    expect(factsById.get("P1Q-TYPE-006")?.forbiddenExtrapolations).toEqual([
      "Не утверждать обязательность, единый комплект, пригодность для любого участка или размеры."
    ]);
    expect(factsById.get("P1Q-PROC-003")?.sources).toHaveLength(2);
    expect(factsById.get("P1Q-PROC-003")?.sources[1]).toMatchObject({
      path: "apps/site/src/imported-pages/dostavka-i-montazh/index.html",
      lines: "324-325,328-330",
      blobSha: "332f0a285bab8e37d37407f1d14aa1eba71b6bf8"
    });
    expect(
      [...new Set(
        LIVE_V2_FACTS_SNAPSHOT.facts.flatMap((fact) =>
          fact.sources.map((factSource) => `${factSource.path}:${factSource.blobSha}`)
        )
      )].sort()
    ).toEqual([
      "apps/site/src/imported-pages/dostavka-i-montazh/index.html:332f0a285bab8e37d37407f1d14aa1eba71b6bf8",
      "apps/site/src/imported-pages/dvoinye-pamyatniki/index.html:d8a26e54cf8caaa2480c3837946fd241906302a3",
      "apps/site/src/imported-pages/index.html:fcae3a14c48fdb9900404ef60e9aa6d465f8071f",
      "apps/site/src/imported-pages/ustanovka-pamyatnikov/index.html:fb118d99ffcea108668783f07fbde1fab19846d5",
      "apps/site/src/imported-pages/vertikalnye-pamyatniki/index.html:995466a086ca5930d2cabbbd98865d50b884ebd9"
    ]);
  });

  it("projects every production fact without owner or source metadata", () => {
    const serialized = JSON.stringify(toLiveV2ModelFactsAsset(LIVE_V2_FACTS_SNAPSHOT));

    expect(toLiveV2ModelFactsAsset(LIVE_V2_FACTS_SNAPSHOT).facts).toHaveLength(15);
    expect(serialized).not.toContain(OWNER_REVIEW_ID_FOR_ASSERTION);
    expect(serialized).not.toContain(SOURCE_COMMIT_FOR_ASSERTION);
    expect(serialized).not.toContain("ownerApproved");
    expect(serialized).not.toContain("blobSha");
    expect(serialized).not.toContain("validFrom");
  });

  it("requires a new owner review when the production snapshot review date arrives", () => {
    expect(
      parseLiveV2FactsSnapshot(LIVE_V2_FACTS_SNAPSHOT, {
        asOfDate: "2026-10-13"
      })
    ).toEqual(LIVE_V2_FACTS_SNAPSHOT);
    expect(() =>
      parseLiveV2FactsSnapshot(LIVE_V2_FACTS_SNAPSHOT, {
        asOfDate: REVIEW_BY_FOR_ASSERTION
      })
    ).toThrow("is outside its approval window");
  });

  it.each([
    {
      name: "unapproved fact",
      mutate: (value: Record<string, any>) => {
        value.facts[0].ownerApproved = false;
      }
    },
    {
      name: "unknown extra field",
      mutate: (value: Record<string, any>) => {
        value.facts[0].runtimeHint = "trust me";
      }
    },
    {
      name: "commercial wording",
      mutate: (value: Record<string, any>) => {
        value.facts[0].allowedCustomerWording = "Цена от 10000 руб.";
      }
    },
    {
      name: "duplicate fact ID",
      mutate: (value: Record<string, any>) => {
        value.facts[1].id = value.facts[0].id;
      }
    }
  ])("rejects $name", ({ mutate }) => {
    const value = structuredClone(TEST_LIVE_V2_FACTS) as Record<string, any>;
    mutate(value);

    expect(() =>
      parseLiveV2FactsSnapshot(value, { asOfDate: TEST_LIVE_V2_AS_OF_DATE })
    ).toThrow();
  });

  it.each([
    {
      name: "impossible validFrom calendar date",
      asOfDate: "2026-07-14",
      mutate: (value: Record<string, any>) => {
        value.facts[0].validFrom = "2026-02-30";
      }
    },
    {
      name: "impossible injected as-of calendar date",
      asOfDate: "2026-02-30",
      mutate: (_value: Record<string, any>) => undefined
    },
    {
      name: "fact not valid yet",
      asOfDate: "2026-07-13",
      mutate: (_value: Record<string, any>) => undefined
    },
    {
      name: "fact due for review on the reviewBy date",
      asOfDate: "2026-10-14",
      mutate: (_value: Record<string, any>) => undefined
    }
  ])("rejects $name", ({ asOfDate, mutate }) => {
    const value = structuredClone(TEST_LIVE_V2_FACTS) as Record<string, any>;
    mutate(value);

    expect(() => parseLiveV2FactsSnapshot(value, { asOfDate })).toThrow();
  });

  it("accepts facts inside the injected approval window", () => {
    expect(
      parseLiveV2FactsSnapshot(TEST_LIVE_V2_FACTS, { asOfDate: "2026-07-14" })
    ).toEqual(TEST_LIVE_V2_FACTS);
  });

  it("projects only customer-safe fact fields into the future model asset", () => {
    const modelAsset = toLiveV2ModelFactsAsset(TEST_LIVE_V2_FACTS);
    const serialized = JSON.stringify(modelAsset);

    expect(modelAsset.facts[0]).toEqual({
      id: TEST_LIVE_V2_FACTS.facts[0]!.id,
      category: TEST_LIVE_V2_FACTS.facts[0]!.category,
      allowedCustomerWording: TEST_LIVE_V2_FACTS.facts[0]!.allowedCustomerWording,
      forbiddenExtrapolations: TEST_LIVE_V2_FACTS.facts[0]!.forbiddenExtrapolations
    });
    expect(serialized).not.toContain("ownerReviewId");
    expect(serialized).not.toContain("ownerApproved");
    expect(serialized).not.toContain("blobSha");
    expect(serialized).not.toContain("validFrom");
    expect(serialized).not.toContain(SOURCE_COMMIT_FOR_ASSERTION);
  });
});
