# Review: AI-DIALOG-P1Q-Facts — принятый facts snapshot для live_v2

Status: owner_accepted; snapshot_verified; G1Q passed
Created: 2026-07-14
Repo: `granit-operations`
Source repo: `granit-site-cms`
Source commit: `23f2ee8c39ee2af30ca79cf9f2e5c4dd0229bf2a`
Owner/agent: owner accepted exact table; Codex materialized and verified snapshot

## Назначение

Это принятая владельцем таблица для versioned `live_v2` facts snapshot. Когда `live_v2` будет
разрешён поздним gate, он получит только schema-validated repo snapshot; HTML/CMS во время
работы API читаться не будут. G1Q closure evidence:
`docs/release/evidence/AI_DIALOG_LIVE_V2_FACTS_G1Q_RU.md`.

## Source audit correction

Повторный exact-Git audit показал, что current checkout
`5c336109fc20549d0e618cb6834d24e0cc6b4ba0` на один commit впереди локально зафиксированного
`origin/redesign/full-site-v1@23f2ee8c39ee2af30ca79cf9f2e5c4dd0229bf2a`; ни один локальный
remote-tracking ref не содержит `5c336109...`. Все пять cited HTML blobs byte-for-byte одинаковы
в этих двух commits. Поэтому proposal до owner approval перепривязан к remote-resolvable parent
`23f2ee8...`; содержимое источника не менялось.

Независимый row-by-row audit также исправил две слишком широкие парафразы (`P1Q-TYPE-005` и
`P1Q-TYPE-006`), сделал терминологию `P1Q-TYPE-004`/`P1Q-DECOR-003` буквальнее и исключил из
диапазона `P1Q-PROC-003` соседнюю строку с ценой/сроком. Evidence:
`docs/release/evidence/AI_DIALOG_P1Q_FACTS_SOURCE_AUDIT_RU.md`.

## Review Table

| Candidate fact | Source path/line | Allowed customer wording | Forbidden extrapolation | Owner approved | Source version | Valid from | Review by |
|---|---|---|---|---|---|---|---|
| `P1Q-TYPE-001` | `apps/site/src/imported-pages/index.html:191` | В каталоге представлены вертикальные памятники. | Не обещать наличие модели, цену или срок. | yes — accepted 2026-07-14 | commit `23f2ee8`; blob `fcae3a14c48fdb9900404ef60e9aa6d465f8071f` | 2026-07-14 | 2026-10-14 |
| `P1Q-TYPE-002` | `apps/site/src/imported-pages/index.html:192` | В каталоге представлены горизонтальные памятники — широкие стелы для семейных надписей и двух портретов. | Не назначать размеры, комплект или вместимость сверх текста. | yes — accepted 2026-07-14 | commit `23f2ee8`; blob `fcae3a14c48fdb9900404ef60e9aa6d465f8071f` | 2026-07-14 | 2026-10-14 |
| `P1Q-TYPE-003` | `apps/site/src/imported-pages/dvoinye-pamyatniki/index.html:243-246,279-280` | Для двойного памятника возможны общая стела либо две отдельные стелы в единой композиции. | Не обещать текущую доступность вариантов или конкретные размеры. | yes — accepted 2026-07-14 | commit `23f2ee8`; blob `d8a26e54cf8caaa2480c3837946fd241906302a3` | 2026-07-14 | 2026-10-14 |
| `P1Q-TYPE-004` | `apps/site/src/imported-pages/index.html:193` | Гранитный комплекс может включать цоколь, облицовку, цветник, вазы и дополнительные элементы. | Не утверждать, что любой набор входит в базовую комплектацию. | yes — accepted 2026-07-14 | commit `23f2ee8`; blob `fcae3a14c48fdb9900404ef60e9aa6d465f8071f` | 2026-07-14 | 2026-10-14 |
| `P1Q-TYPE-005` | `apps/site/src/imported-pages/index.html:195` | В каталоге представлены ограды, столы, лавки и вазы. | Не обещать наличие, материал или включение всех элементов в заказ. | yes — accepted 2026-07-14 | commit `23f2ee8`; blob `fcae3a14c48fdb9900404ef60e9aa6d465f8071f` | 2026-07-14 | 2026-10-14 |
| `P1Q-TYPE-006` | `apps/site/src/imported-pages/index.html:196` | В каталоге представлены цоколи и цветники; также указаны гранитные основания и рамки для аккуратной геометрии участка. | Не утверждать обязательность, единый комплект, пригодность для любого участка или размеры. | yes — accepted 2026-07-14 | commit `23f2ee8`; blob `fcae3a14c48fdb9900404ef60e9aa6d465f8071f` | 2026-07-14 | 2026-10-14 |
| `P1Q-MAT-001` | `apps/site/src/imported-pages/index.html:236` | В каталоге указан материал «габбро-диабаз». | Не приписывать происхождение, свойства, долговечность или наличие. | yes — accepted 2026-07-14 | commit `23f2ee8`; blob `fcae3a14c48fdb9900404ef60e9aa6d465f8071f` | 2026-07-14 | 2026-10-14 |
| `P1Q-MAT-002` | `apps/site/src/imported-pages/index.html:237` | В каталоге указан дымовский гранит. | Не приписывать происхождение, свойства, долговечность или наличие. | yes — accepted 2026-07-14 | commit `23f2ee8`; blob `fcae3a14c48fdb9900404ef60e9aa6d465f8071f` | 2026-07-14 | 2026-10-14 |
| `P1Q-MAT-003` | `apps/site/src/imported-pages/index.html:238` | В каталоге указан мансуровский гранит. | Не приписывать происхождение, свойства, долговечность или наличие. | yes — accepted 2026-07-14 | commit `23f2ee8`; blob `fcae3a14c48fdb9900404ef60e9aa6d465f8071f` | 2026-07-14 | 2026-10-14 |
| `P1Q-DECOR-001` | `apps/site/src/imported-pages/vertikalnye-pamyatniki/index.html:345-347` | На вертикальной стеле можно разместить портрет, ФИО и эпитафию. | Не гарантировать качество, размер, число вариантов или допустимость любого содержания. | yes — accepted 2026-07-14 | commit `23f2ee8`; blob `995466a086ca5930d2cabbbd98865d50b884ebd9` | 2026-07-14 | 2026-10-14 |
| `P1Q-DECOR-002` | `apps/site/src/imported-pages/vertikalnye-pamyatniki/index.html:279-283` | Оформление может включать резной крест, глубокую гравировку, вазу и цветник. | Не утверждать, что элементы входят в базовый комплект или доступны сейчас. | yes — accepted 2026-07-14 | commit `23f2ee8`; blob `995466a086ca5930d2cabbbd98865d50b884ebd9` | 2026-07-14 | 2026-10-14 |
| `P1Q-DECOR-003` | `apps/site/src/imported-pages/dvoinye-pamyatniki/index.html:243-247,345-347` | На единой стеле двойного памятника можно разместить два портрета и надписи; их согласуют заранее. | Не обещать конкретный макет, число правок или автоматическое принятие оформления. | yes — accepted 2026-07-14 | commit `23f2ee8`; blob `d8a26e54cf8caaa2480c3837946fd241906302a3` | 2026-07-14 | 2026-10-14 |
| `P1Q-PROC-001` | `apps/site/src/imported-pages/ustanovka-pamyatnikov/index.html:213-217` | Монтаж на подготовленное основание включает установку комплекта и проверку геометрии. | Не обещать срок, цену, гарантию или пригодность существующего основания. | yes — accepted 2026-07-14 | commit `23f2ee8`; blob `fb118d99ffcea108668783f07fbde1fab19846d5` | 2026-07-14 | 2026-10-14 |
| `P1Q-PROC-002` | `apps/site/src/imported-pages/ustanovka-pamyatnikov/index.html:231-235` | Если основание не готово, процесс может включать подготовку основания перед монтажом. | Не обещать, что подготовка всегда возможна или входит в заказ. | yes — accepted 2026-07-14 | commit `23f2ee8`; blob `fb118d99ffcea108668783f07fbde1fab19846d5` | 2026-07-14 | 2026-10-14 |
| `P1Q-PROC-003` | `apps/site/src/imported-pages/ustanovka-pamyatnikov/index.html:328-330`; `apps/site/src/imported-pages/dostavka-i-montazh/index.html:324-325,328-330` | Процесс включает фото участка, оценку работ и согласование выезда; для доставки уточняют адрес, подъезд, состав заказа и готовность участка. | Не обещать конкретную дату, срок, маршрут, стоимость или возможность доставки. | yes — accepted 2026-07-14 | commit `23f2ee8`; blobs `fb118d99ffcea108668783f07fbde1fab19846d5`, `332f0a285bab8e37d37407f1d14aa1eba71b6bf8` | 2026-07-14 | 2026-10-14 |

## Категорически вне snapshot

- Цены, расчёты, сроки, наличие и доступность конкретных моделей.
- Скидки, акции, оплата, предоплата, рассрочка и возвраты.
- Договорные условия, гарантии, ответственность и юридические обещания.
- Правила кладбищ, точные размеры и характеристики без отдельной проверки.
- Популярность, спрос, тренды, собственное производство и географическое покрытие.

## Test-only fixture остаётся отдельным

`TEST_LIVE_V2_FACTS` в `apps/api/test/fixtures/live-v2-synthetic.v1.ts` содержит
`ownerApproved: true` только для проверки строгой schema, validator и synthetic corpus. Owner
decision по таблице зафиксирован отдельно; test-only fixture не является его доказательством и
не импортируется как runtime snapshot.

Все 15 строк приняты с `Valid from: 2026-07-14`. Matching production snapshot создан в
`apps/api/src/modules/ai/profiles/live-v2/facts.v1.ts` на implementation commit `1d737e0`; профиль
по-прежнему не развёрнут и не включён в active runtime.

## Recorded Owner Decision

Владелец принял все 15 строк без изменений. Snapshot materialization, exact parity, повторные
checks и G1Q result записаны в
`docs/release/evidence/AI_DIALOG_LIVE_V2_FACTS_G1Q_RU.md`; P2 разблокирован.

Exact all-row acceptance phrase for the current audited table:

> Принимаю все 15 фактов P1Q из таблицы на source commit 23f2ee8c39ee2af30ca79cf9f2e5c4dd0229bf2a без изменений.
