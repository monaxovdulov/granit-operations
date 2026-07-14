import {
  LIVE_V2_FACTS_VERSION,
  parseLiveV2FactsSnapshot
} from "./live-v2-assets.js";

const LIVE_V2_FACTS_SOURCE_COMMIT =
  "23f2ee8c39ee2af30ca79cf9f2e5c4dd0229bf2a" as const;
const LIVE_V2_FACTS_VALID_FROM = "2026-07-14" as const;
const LIVE_V2_FACTS_REVIEW_BY = "2026-10-14" as const;
const LIVE_V2_FACTS_OWNER_REVIEW_ID =
  "G1Q-2026-07-14-owner-accepted-all-15-23f2ee8c" as const;

function source(path: string, lines: string, blobSha: string) {
  return {
    repo: "granit-site-cms" as const,
    commit: LIVE_V2_FACTS_SOURCE_COMMIT,
    path,
    lines,
    blobSha
  };
}

export const LIVE_V2_FACTS_SNAPSHOT = parseLiveV2FactsSnapshot(
  {
    version: LIVE_V2_FACTS_VERSION,
    ownerReviewId: LIVE_V2_FACTS_OWNER_REVIEW_ID,
    facts: [
      {
        id: "P1Q-TYPE-001",
        category: "product_type",
        allowedCustomerWording: "В каталоге представлены вертикальные памятники.",
        forbiddenExtrapolations: ["Не обещать наличие модели, цену или срок."],
        sources: [
          source(
            "apps/site/src/imported-pages/index.html",
            "191",
            "fcae3a14c48fdb9900404ef60e9aa6d465f8071f"
          )
        ],
        ownerApproved: true,
        validFrom: LIVE_V2_FACTS_VALID_FROM,
        reviewBy: LIVE_V2_FACTS_REVIEW_BY
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
          source(
            "apps/site/src/imported-pages/index.html",
            "192",
            "fcae3a14c48fdb9900404ef60e9aa6d465f8071f"
          )
        ],
        ownerApproved: true,
        validFrom: LIVE_V2_FACTS_VALID_FROM,
        reviewBy: LIVE_V2_FACTS_REVIEW_BY
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
          source(
            "apps/site/src/imported-pages/dvoinye-pamyatniki/index.html",
            "243-246,279-280",
            "d8a26e54cf8caaa2480c3837946fd241906302a3"
          )
        ],
        ownerApproved: true,
        validFrom: LIVE_V2_FACTS_VALID_FROM,
        reviewBy: LIVE_V2_FACTS_REVIEW_BY
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
          source(
            "apps/site/src/imported-pages/index.html",
            "193",
            "fcae3a14c48fdb9900404ef60e9aa6d465f8071f"
          )
        ],
        ownerApproved: true,
        validFrom: LIVE_V2_FACTS_VALID_FROM,
        reviewBy: LIVE_V2_FACTS_REVIEW_BY
      },
      {
        id: "P1Q-TYPE-005",
        category: "product_type",
        allowedCustomerWording: "В каталоге представлены ограды, столы, лавки и вазы.",
        forbiddenExtrapolations: [
          "Не обещать наличие, материал или включение всех элементов в заказ."
        ],
        sources: [
          source(
            "apps/site/src/imported-pages/index.html",
            "195",
            "fcae3a14c48fdb9900404ef60e9aa6d465f8071f"
          )
        ],
        ownerApproved: true,
        validFrom: LIVE_V2_FACTS_VALID_FROM,
        reviewBy: LIVE_V2_FACTS_REVIEW_BY
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
          source(
            "apps/site/src/imported-pages/index.html",
            "196",
            "fcae3a14c48fdb9900404ef60e9aa6d465f8071f"
          )
        ],
        ownerApproved: true,
        validFrom: LIVE_V2_FACTS_VALID_FROM,
        reviewBy: LIVE_V2_FACTS_REVIEW_BY
      },
      {
        id: "P1Q-MAT-001",
        category: "material",
        allowedCustomerWording: "В каталоге указан материал «габбро-диабаз».",
        forbiddenExtrapolations: [
          "Не приписывать происхождение, свойства, долговечность или наличие."
        ],
        sources: [
          source(
            "apps/site/src/imported-pages/index.html",
            "236",
            "fcae3a14c48fdb9900404ef60e9aa6d465f8071f"
          )
        ],
        ownerApproved: true,
        validFrom: LIVE_V2_FACTS_VALID_FROM,
        reviewBy: LIVE_V2_FACTS_REVIEW_BY
      },
      {
        id: "P1Q-MAT-002",
        category: "material",
        allowedCustomerWording: "В каталоге указан дымовский гранит.",
        forbiddenExtrapolations: [
          "Не приписывать происхождение, свойства, долговечность или наличие."
        ],
        sources: [
          source(
            "apps/site/src/imported-pages/index.html",
            "237",
            "fcae3a14c48fdb9900404ef60e9aa6d465f8071f"
          )
        ],
        ownerApproved: true,
        validFrom: LIVE_V2_FACTS_VALID_FROM,
        reviewBy: LIVE_V2_FACTS_REVIEW_BY
      },
      {
        id: "P1Q-MAT-003",
        category: "material",
        allowedCustomerWording: "В каталоге указан мансуровский гранит.",
        forbiddenExtrapolations: [
          "Не приписывать происхождение, свойства, долговечность или наличие."
        ],
        sources: [
          source(
            "apps/site/src/imported-pages/index.html",
            "238",
            "fcae3a14c48fdb9900404ef60e9aa6d465f8071f"
          )
        ],
        ownerApproved: true,
        validFrom: LIVE_V2_FACTS_VALID_FROM,
        reviewBy: LIVE_V2_FACTS_REVIEW_BY
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
          source(
            "apps/site/src/imported-pages/vertikalnye-pamyatniki/index.html",
            "345-347",
            "995466a086ca5930d2cabbbd98865d50b884ebd9"
          )
        ],
        ownerApproved: true,
        validFrom: LIVE_V2_FACTS_VALID_FROM,
        reviewBy: LIVE_V2_FACTS_REVIEW_BY
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
          source(
            "apps/site/src/imported-pages/vertikalnye-pamyatniki/index.html",
            "279-283",
            "995466a086ca5930d2cabbbd98865d50b884ebd9"
          )
        ],
        ownerApproved: true,
        validFrom: LIVE_V2_FACTS_VALID_FROM,
        reviewBy: LIVE_V2_FACTS_REVIEW_BY
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
          source(
            "apps/site/src/imported-pages/dvoinye-pamyatniki/index.html",
            "243-247,345-347",
            "d8a26e54cf8caaa2480c3837946fd241906302a3"
          )
        ],
        ownerApproved: true,
        validFrom: LIVE_V2_FACTS_VALID_FROM,
        reviewBy: LIVE_V2_FACTS_REVIEW_BY
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
          source(
            "apps/site/src/imported-pages/ustanovka-pamyatnikov/index.html",
            "213-217",
            "fb118d99ffcea108668783f07fbde1fab19846d5"
          )
        ],
        ownerApproved: true,
        validFrom: LIVE_V2_FACTS_VALID_FROM,
        reviewBy: LIVE_V2_FACTS_REVIEW_BY
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
          source(
            "apps/site/src/imported-pages/ustanovka-pamyatnikov/index.html",
            "231-235",
            "fb118d99ffcea108668783f07fbde1fab19846d5"
          )
        ],
        ownerApproved: true,
        validFrom: LIVE_V2_FACTS_VALID_FROM,
        reviewBy: LIVE_V2_FACTS_REVIEW_BY
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
          source(
            "apps/site/src/imported-pages/ustanovka-pamyatnikov/index.html",
            "328-330",
            "fb118d99ffcea108668783f07fbde1fab19846d5"
          ),
          source(
            "apps/site/src/imported-pages/dostavka-i-montazh/index.html",
            "324-325,328-330",
            "332f0a285bab8e37d37407f1d14aa1eba71b6bf8"
          )
        ],
        ownerApproved: true,
        validFrom: LIVE_V2_FACTS_VALID_FROM,
        reviewBy: LIVE_V2_FACTS_REVIEW_BY
      }
    ]
  },
  { asOfDate: LIVE_V2_FACTS_VALID_FROM }
);
