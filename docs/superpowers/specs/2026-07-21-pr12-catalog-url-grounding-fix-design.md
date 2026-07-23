# Дизайн: fail-closed проверка catalog URL для PR #12

## Контекст

PR #12 подключает versioned catalog knowledge provider к website widget AI. Текущий prompt требует публиковать только точный `frontend.url` выбранной published-записи, а semantic verifier должен сослаться на неё через `path=/frontend/url`.

App-side validation сейчас подтверждает только существование записи и JSON pointer. Она не сравнивает текст claim с фактическим значением поля. Поэтому verifier может пометить выдуманный URL как supported, сослаться на реальную запись и `/frontend/url`, а `validateWidgetAiVerification` не вернёт contract issue. Такой `pass` формально допускает ответ к дальнейшему render/send path.

В legacy policy есть отдельная регрессия приоритета: calculation fallback выполняется раньше правила для гарантии, договора и других обязательных коммерческих условий. Смешанный запрос вроде «Нужен расчёт памятника с гарантией и договором» поэтому остаётся в AI-консультации вместо handoff менеджеру.

## Цель

Закрыть подтверждённые fail-open и policy-ordering дефекты минимальным изменением, достаточным для merge-readiness PR #12:

- URL каталога проходит точную app-owned проверку;
- выдуманный или изменённый URL не может стать customer-facing ответом;
- обязательные коммерческие условия имеют приоритет над расчётным fallback;
- документация и evidence описывают фактический runtime текущего head.

## Выбранный scope

### 1. Каноническое значение URL

Для catalog claim с `catalogReference.path === "/frontend/url"` каноническим значением считается только top-level `frontend.url` записи из `CatalogSnapshot`.

Перед чтением значения сохраняются существующие identity и eligibility проверки:

- `catalogVersion` reference совпадает с версией snapshot;
- одна и та же пара `recordId + revision` присутствует в `selectedRecords` и snapshot;
- обе записи имеют статус `published`;
- snapshot-запись активна на `inboundMessage.submittedAt`;
- у snapshot-записи есть непустой top-level `frontend.url`.

Дублированное значение `data.frontend.url` не является источником истины для этой проверки. Оно не должно позволять пройти validation, если top-level `frontend` отсутствует или невалиден.

### 2. Точное сравнение claim

После обычной проверки claim span приложение сравнивает `claim.text` с каноническим URL строгим строковым сравнением (`===`) с учётом регистра. Claim span должен содержать только URL. URL не декодируется, не нормализуется и не исправляется автоматически.

- Точное совпадение допускается.
- Любое отличие создаёт новый controlled contract issue `catalog_claim_value_mismatch`.
- Contract issue делает `isPass` ложным и не позволяет отправить ответ.

Retry state machine не меняется. Если verifier сам вернул `repair`, остаётся существующая одна bounded repair-попытка. Если verifier вернул `pass`, но app-side validation нашёл mismatch, ход закрывается текущим fail-closed путём `grounding_validation_failed`; автоматический дополнительный repair для такого случая не добавляется.

Проверка значения ограничена `/frontend/url`. Названия, описания, материалы и другие catalog claims продолжают проходить существующую semantic verification и structural reference validation. Точное сравнение всех scalar-полей в этот PR не добавляется.

### 3. Приоритет legacy policy

В `buildWidgetAiPolicyReply` правила применяются в таком порядке:

1. явный запрос менеджера;
2. юридические, похоронные и наследственные вопросы;
3. запрос финальной/точной цены или коммерческого предложения;
4. гарантия, договор, наличие, оплата, скидка и другие обязательные условия;
5. безопасный calculation fallback.

Поэтому смешанный запрос «расчёт + гарантия/договор» всегда получает manager handoff, а grounded provider и verifier для этого хода не вызываются. Изменение поведения сопровождается повышением `WIDGET_AI_POLICY_VERSION`.

## Runtime flow после изменения

Основной путь остаётся прежним:

`generator -> semantic verifier -> app-side contract validation -> plan normalization/rendering -> send-time gate -> persistence`.

App-side contract validation добавляет узкую точную проверку catalog URL до формирования reply candidate. Plan renderer по-прежнему может заменить проверенный model text детерминированным app-owned текстом на коммерческих ходах. Send-time gate остаётся последней атомарной защитой после manager takeover.

## Ошибки и безопасное поведение

- Reference на отсутствующую, draft, retired, неактивную или невыбранную запись остаётся `invalid_catalog_reference`.
- Reference `/frontend/url` без валидного top-level URL остаётся `invalid_catalog_reference`.
- Валидная reference с несовпадающим claim text даёт `catalog_claim_value_mismatch`.
- Ни mismatch, ни verifier/contract failure не обходят текущий unavailable/fallback path и send-time gate.
- Система не конструирует и не «чинит» URL из `section`, `anchor` или `entity id` во время ответа.

## Тестирование

Добавить regression coverage в существующие test suites:

1. Реальная published-запись «Арфа» из checked-in snapshot и выдуманный URL с корректной reference `/frontend/url` дают `catalog_claim_value_mismatch`.
2. Точный URL той же записи проходит validator.
3. Service-level сценарий с fake provider/verifier не превращает fabricated URL в reply candidate и заканчивается `grounding_validation_failed`.
4. Смешанный запрос «расчёт + гарантия/договор» создаёт manager handoff до provider call.
5. Существующие проверки обычных catalog claims, plan-render, manager takeover, stale-draft send gate и Telegram outbound block остаются зелёными.

Финальные локальные gates:

- `npm test -- --maxWorkers=1`;
- `npm run typecheck`;
- `npm run build`;
- `npm run eval:widget-ai:offline`;
- `npm run eval:widget-ai:dry-run`;
- `git diff --check origin/main...HEAD`.

## Документация и release evidence

- Обновить `docs/AI_POLICY.md`: в `enforce` model-authored ответ требует generator + verifier + app-side validation, но после этого plan-render слой может сформировать детерминированный app-owned текст.
- Убрать обнаруженную лишнюю пустую строку в конце `catalog-prompt-record.ts`, чтобы полный `git diff --check origin/main...HEAD` был чистым; это изменение не затрагивает runtime behavior.
- Добавить merge-readiness evidence для PR #12 по repository template.
- В evidence явно разделить исторический staging proof для operations SHA `38a3e9c4d35c7837650456169ee9ebac9846ac46` и локальные проверки финального head. Историческое доказательство нельзя представлять как новый staging deploy текущего head.
- После реализации опубликовать commits в существующую ветку PR #12 и обновить его описание результатами проверок; PR не merge-ить.

## Вне scope

- точное app-owned сравнение всех catalog scalar values;
- price/action resolver, persistent catalog navigation и работа issue #13;
- изменение catalog snapshot schema или public widget contracts;
- новый provider, orchestrator или отдельный AI runtime;
- staging/production deploy без отдельного owner authority;
- перевод PR из draft, merge или production enablement.

## Rollback

Кодовый rollback — revert implementation commit этого исправления. Операционный rollback остаётся прежним: `AI_WIDGET_GROUNDED_MODE=off` возвращает legacy path, `AI_WIDGET_ENABLED=false` полностью отключает website AI. Любое включение или переключение окружения требует отдельного owner authority.

## Критерии приёмки

- fabricated catalog URL не проходит app-side validation даже при verifier verdict `pass` и формально валидной reference;
- точный allowlisted `frontend.url` выбранной published/active записи проходит проверку;
- поведение не расширяется на остальные catalog facts;
- binding terms побеждают calculation fallback;
- policy docs соответствуют фактическому plan-render runtime;
- полный набор локальных gates проходит, а merge-readiness evidence не смешивает исторический staging SHA с текущим head;
- deployment и merge не выполняются.
