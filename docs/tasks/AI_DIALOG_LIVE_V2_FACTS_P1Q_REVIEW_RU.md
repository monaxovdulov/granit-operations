# Review: AI-DIALOG-P1Q-Facts — кандидат facts snapshot для live_v2

Status: needs_review
Created: 2026-07-14
Repo: `granit-operations`
Source repo: `granit-site-cms`
Source commit: `5c336109fc20549d0e618cb6834d24e0cc6b4ba0`
Owner/agent: owner review required; Codex prepared proposal

## Назначение

Это точный proposal для будущего versioned `live_v2` facts snapshot. Строки ниже **не считаются
owner-approved**, пока владелец явно не примет эту таблицу. До принятия runtime validator обязан
отклонять ссылки на эти факты. HTML/CMS не читаются во время работы API.

## Review Table

| Candidate fact | Source path/line | Allowed customer wording | Forbidden extrapolation | Owner approved | Source version | Valid from | Review by |
|---|---|---|---|---|---|---|---|
| `P1Q-TYPE-001` | `apps/site/src/imported-pages/index.html:191` | В каталоге представлены вертикальные памятники. | Не обещать наличие модели, цену или срок. | no — pending | commit `5c336109`; blob `fcae3a14c48fdb9900404ef60e9aa6d465f8071f` | after approval | 2026-10-14 |
| `P1Q-TYPE-002` | `apps/site/src/imported-pages/index.html:192` | В каталоге представлены горизонтальные памятники — широкие стелы для семейных надписей и двух портретов. | Не назначать размеры, комплект или вместимость сверх текста. | no — pending | commit `5c336109`; blob `fcae3a14c48fdb9900404ef60e9aa6d465f8071f` | after approval | 2026-10-14 |
| `P1Q-TYPE-003` | `apps/site/src/imported-pages/dvoinye-pamyatniki/index.html:243-246,279-280` | Для двойного памятника возможны общая стела либо две отдельные стелы в единой композиции. | Не обещать текущую доступность вариантов или конкретные размеры. | no — pending | commit `5c336109`; blob `d8a26e54cf8caaa2480c3837946fd241906302a3` | after approval | 2026-10-14 |
| `P1Q-TYPE-004` | `apps/site/src/imported-pages/index.html:193` | Мемориальный комплекс может включать цоколь, облицовку, цветник, вазы и дополнительные элементы. | Не утверждать, что любой набор входит в базовую комплектацию. | no — pending | commit `5c336109`; blob `fcae3a14c48fdb9900404ef60e9aa6d465f8071f` | after approval | 2026-10-14 |
| `P1Q-TYPE-005` | `apps/site/src/imported-pages/index.html:195` | К элементам благоустройства относятся ограды, столы, лавки и вазы. | Не обещать наличие, материал или включение всех элементов в заказ. | no — pending | commit `5c336109`; blob `fcae3a14c48fdb9900404ef60e9aa6d465f8071f` | after approval | 2026-10-14 |
| `P1Q-TYPE-006` | `apps/site/src/imported-pages/index.html:196` | В каталоге предусмотрены гранитные цоколи, цветники и рамки для основания участка. | Не утверждать обязательность, пригодность для любого участка или размеры. | no — pending | commit `5c336109`; blob `fcae3a14c48fdb9900404ef60e9aa6d465f8071f` | after approval | 2026-10-14 |
| `P1Q-MAT-001` | `apps/site/src/imported-pages/index.html:236` | В каталоге указан материал «габбро-диабаз». | Не приписывать происхождение, свойства, долговечность или наличие. | no — pending | commit `5c336109`; blob `fcae3a14c48fdb9900404ef60e9aa6d465f8071f` | after approval | 2026-10-14 |
| `P1Q-MAT-002` | `apps/site/src/imported-pages/index.html:237` | В каталоге указан дымовский гранит. | Не приписывать происхождение, свойства, долговечность или наличие. | no — pending | commit `5c336109`; blob `fcae3a14c48fdb9900404ef60e9aa6d465f8071f` | after approval | 2026-10-14 |
| `P1Q-MAT-003` | `apps/site/src/imported-pages/index.html:238` | В каталоге указан мансуровский гранит. | Не приписывать происхождение, свойства, долговечность или наличие. | no — pending | commit `5c336109`; blob `fcae3a14c48fdb9900404ef60e9aa6d465f8071f` | after approval | 2026-10-14 |
| `P1Q-DECOR-001` | `apps/site/src/imported-pages/vertikalnye-pamyatniki/index.html:345-347` | На вертикальной стеле можно разместить портрет, ФИО и эпитафию. | Не гарантировать качество, размер, число вариантов или допустимость любого содержания. | no — pending | commit `5c336109`; blob `995466a086ca5930d2cabbbd98865d50b884ebd9` | after approval | 2026-10-14 |
| `P1Q-DECOR-002` | `apps/site/src/imported-pages/vertikalnye-pamyatniki/index.html:279-283` | Оформление может включать резной крест, глубокую гравировку, вазу и цветник. | Не утверждать, что элементы входят в базовый комплект или доступны сейчас. | no — pending | commit `5c336109`; blob `995466a086ca5930d2cabbbd98865d50b884ebd9` | after approval | 2026-10-14 |
| `P1Q-DECOR-003` | `apps/site/src/imported-pages/dvoinye-pamyatniki/index.html:243-247,345-347` | На общей двойной стеле можно разместить два портрета и надписи; их согласуют заранее. | Не обещать конкретный макет, число правок или автоматическое принятие оформления. | no — pending | commit `5c336109`; blob `d8a26e54cf8caaa2480c3837946fd241906302a3` | after approval | 2026-10-14 |
| `P1Q-PROC-001` | `apps/site/src/imported-pages/ustanovka-pamyatnikov/index.html:213-217` | Монтаж на подготовленное основание включает установку комплекта и проверку геометрии. | Не обещать срок, цену, гарантию или пригодность существующего основания. | no — pending | commit `5c336109`; blob `fb118d99ffcea108668783f07fbde1fab19846d5` | after approval | 2026-10-14 |
| `P1Q-PROC-002` | `apps/site/src/imported-pages/ustanovka-pamyatnikov/index.html:231-235` | Если основание не готово, процесс может включать подготовку основания перед монтажом. | Не обещать, что подготовка всегда возможна или входит в заказ. | no — pending | commit `5c336109`; blob `fb118d99ffcea108668783f07fbde1fab19846d5` | after approval | 2026-10-14 |
| `P1Q-PROC-003` | `apps/site/src/imported-pages/ustanovka-pamyatnikov/index.html:328-330`; `apps/site/src/imported-pages/dostavka-i-montazh/index.html:324-330` | Процесс включает фото участка, оценку работ и согласование выезда; для доставки уточняют адрес, подъезд, состав заказа и готовность участка. | Не обещать конкретную дату, срок, маршрут, стоимость или возможность доставки. | no — pending | commit `5c336109`; blobs `fb118d99ffcea108668783f07fbde1fab19846d5`, `332f0a285bab8e37d37407f1d14aa1eba71b6bf8` | after approval | 2026-10-14 |

## Категорически вне snapshot

- Цены, расчёты, сроки, наличие и доступность конкретных моделей.
- Скидки, акции, оплата, предоплата, рассрочка и возвраты.
- Договорные условия, гарантии, ответственность и юридические обещания.
- Правила кладбищ, точные размеры и характеристики без отдельной проверки.
- Популярность, спрос, тренды, собственное производство и географическое покрытие.

## Требуемое решение владельца

Явно принять все 15 строк либо перечислить ID строк, которые нужно изменить/исключить. Только
после такого решения их можно перенести в `facts.v1.ts` с `ownerApproved: true` и датой начала
действия.
