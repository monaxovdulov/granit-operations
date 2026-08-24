import { describe, expect, it } from "vitest";

import { buildLiveV2TurnView } from "../src/modules/ai/profiles/live-v2/live-v2-context.js";
import { validateLiveV2Candidate } from "../src/modules/ai/profiles/live-v2/live-v2-validator.js";
import {
  TEST_LIVE_V2_FACTS,
  answerCandidate,
  buildLiveV2TestTurn,
  clarifyingCandidate,
  contextMessage,
  handoffCandidate
} from "./fixtures/live-v2-synthetic.v1.js";

describe("live_v2 strict candidate validator", () => {
  it("normalizes and accepts a sourced answer with at most one next question", () => {
    const turnView = buildLiveV2TurnView(buildLiveV2TestTurn());
    const candidate = answerCandidate({
      replyDraft:
        "  В каталоге представлены вертикальные памятники. Какой стиль вам ближе?  "
    });

    expect(validate(candidate, turnView)).toEqual({
      ok: true,
      decision: {
        ...candidate,
        replyDraft: "В каталоге представлены вертикальные памятники. Какой стиль вам ближе?"
      }
    });
  });

  it.each([
    {
      name: "top-level extra key",
      mutate: (candidate: Record<string, any>) => {
        candidate.rationale = "hidden chain";
      },
      code: "invalid_shape"
    },
    {
      name: "nested signal extra key",
      mutate: (candidate: Record<string, any>) => {
        candidate.signals.confidence = 0.9;
      },
      code: "invalid_signals"
    },
    {
      name: "wrong reason",
      mutate: (candidate: Record<string, any>) => {
        candidate.reason = "manager_requested";
      },
      code: "invalid_reason"
    },
    {
      name: "two missing slots for one question",
      mutate: (candidate: Record<string, any>) => {
        candidate.action = "ask_clarifying_question";
        candidate.reason = "missing_required_slot";
        candidate.missingSlots = ["city", "material"];
      },
      code: "invalid_missing_slots"
    }
  ])("rejects strict schema violation: $name", ({ mutate, code }) => {
    const candidate = structuredClone(answerCandidate()) as Record<string, any>;
    mutate(candidate);

    expect(validate(candidate)).toEqual({ ok: false, code });
  });

  it("requires declared approved-fact evidence to contain unique known source IDs", () => {
    const noSource = answerCandidate({
      replyDraft: "В каталоге представлены вертикальные памятники.",
      factIds: []
    });
    expect(validate(noSource)).toEqual({ ok: false, code: "fact_evidence_mismatch" });

    noSource.evidence.basis.push("approved_facts");
    expect(validate(noSource)).toEqual({ ok: false, code: "fact_evidence_mismatch" });

    expect(validate(answerCandidate({ factIds: ["P1Q-TYPE-999"] }))).toEqual({
      ok: false,
      code: "unknown_fact_id"
    });

    expect(
      validate(answerCandidate({ factIds: ["P1Q-TYPE-001", "P1Q-TYPE-001"] }))
    ).toEqual({ ok: false, code: "invalid_evidence" });
  });

  it.each([
    "Цена составит 120 000 руб.",
    "Цена составит 120000.",
    "Цена — двадцать тысяч.",
    "Стоимость составит сто двадцать тысяч рублей.",
    "Изготовим за 14 дней.",
    "Сделаем за две недели.",
    "Срок — две недели.",
    "Установим к пятнице.",
    "Доставим завтра.",
    "Эта модель точно в наличии.",
    "Эта модель есть на складе.",
    "Доступна к заказу прямо сейчас.",
    "Модель доступна сейчас.",
    "Сделаем скидку.",
    "Берём предоплату 50 процентов.",
    "Оплатить можно картой при получении.",
    "Оплата картой.",
    "Возврат оформим без проблем.",
    "Предоставим гарантию и заключим договор.",
    "Дадим гарантию.",
    "Гарантия действует пять лет.",
    "Гарантия 5 лет.",
    "Работаем по договору.",
    "За любые дефекты отвечаем мы.",
    "По закону вам нужно оформить захоронение именно так.",
    "На этом кладбище установка разрешена без согласования.",
    "Для монтажа разрешение не требуется.",
    "По правилам кладбища размер стелы не ограничен.",
    "Документы можно не оформлять.",
    "Габбро-диабаз служит больше ста лет.",
    "Дымовский гранит не выцветает и не трескается.",
    "Мансуровский гранит добывают в России.",
    "Стандартный размер стелы — 120 на 60 сантиметров.",
    "У нас собственное производство.",
    "Доставляем по всей России.",
    "Это самая популярная модель."
  ])("does not classify free-form claim prose with a semantic regex: %s", (replyDraft) => {
    expect(validate(answerCandidate({ replyDraft }))).toMatchObject({
      ok: true,
      decision: { replyDraft }
    });
  });

  it.each([
    "Точную цену рассчитает и подтвердит менеджер после уточнения деталей.",
    "Срок изготовления и монтажа подтвердит менеджер после оценки.",
    "Наличие конкретной модели подтвердит менеджер после проверки.",
    "Скидки, способы оплаты и условия возврата уточнит менеджер.",
    "Гарантийные и договорные условия нужно уточнить у менеджера.",
    "Правила кладбища и требования к документам нужно уточнить у менеджера или администрации кладбища.",
    "Свойства и происхождение материала нужно уточнить у менеджера по документам поставщика.",
    "Точные размеры подберёт менеджер после оценки участка.",
    "Возможность доставки по адресу нужно уточнить у менеджера.",
    "Я не могу обещать цену, срок или гарантию; условия подтвердит менеджер.",
    "Наличие этой модели пока не подтверждено; его уточнит менеджер."
  ])("allows a non-binding manager deferral: %s", (replyDraft) => {
    expect(validate(answerCandidate({ replyDraft, factIds: [] }))).toMatchObject({
      ok: true,
      decision: { action: "answer" }
    });
  });

  it("uses structural manager signals rather than reply text mentions", () => {
    expect(
      validate(
        answerCandidate({
          replyDraft:
            "В каталоге есть вертикальные памятники; менеджер позже может уточнить условия."
        })
      )
    ).toMatchObject({ ok: true, decision: { action: "answer" } });

    expect(validate(answerCandidate({ managerRequest: "negated" }))).toMatchObject({
      ok: true,
      decision: { action: "answer", signals: { managerRequest: "negated" } }
    });

    expect(validate(answerCandidate({ managerRequest: "explicit" }))).toEqual({
      ok: false,
      code: "action_signal_mismatch"
    });

    expect(validate(handoffCandidate())).toMatchObject({
      ok: true,
      decision: { action: "handoff_to_manager", reason: "explicit_manager_request" }
    });
  });

  it("allows one useful unknown slot but rejects known-slot repeats and questionnaires", () => {
    expect(
      validate(
        clarifyingCandidate({
          slot: "material",
          replyDraft: "Какой материал вы рассматриваете?"
        })
      )
    ).toMatchObject({ ok: true, decision: { action: "ask_clarifying_question" } });

    const withKnownCity = buildLiveV2TurnView(buildLiveV2TestTurn({ city: "Москва" }));
    expect(
      validate(
        clarifyingCandidate({ slot: "city", replyDraft: "В каком городе нужен монтаж?" }),
        withKnownCity
      )
    ).toEqual({ ok: false, code: "known_slot_requested" });

    expect(
      validate(
        clarifyingCandidate({
          slot: "material",
          replyDraft: "Какой материал? Какое оформление?"
        })
      )
    ).toEqual({ ok: false, code: "question_limit_exceeded" });
  });

  it("leaves echo, repetition and tone to offline quality evaluation", () => {
    const turnView = buildLiveV2TurnView(
      buildLiveV2TestTurn({
        inbound: "Нужен вертикальный памятник",
        previousMessagesNewestFirst: [
          contextMessage({
            id: 1,
            role: "assistant",
            text: "В каталоге есть вертикальные памятники."
          })
        ]
      })
    );

    expect(
      validate(
        answerCandidate({ replyDraft: "Нужен вертикальный памятник", factIds: [] }),
        turnView
      )
    ).toMatchObject({ ok: true });
    expect(
      validate(
        answerCandidate({ replyDraft: "В каталоге есть вертикальные памятники." }),
        turnView
      )
    ).toMatchObject({ ok: true });
    expect(
      validate(answerCandidate({ replyDraft: "Искренне сочувствую. Оставьте ваш телефон." }))
    ).toMatchObject({ ok: true });

    expect(
      validate(
        handoffCandidate({ managerRequest: "absent", reason: "manager_required" }),
        turnView
      )
    ).toMatchObject({ ok: true });

    const pressuredHandoff = handoffCandidate({
      managerRequest: "absent",
      reason: "manager_required"
    });
    pressuredHandoff.replyDraft = "Оставьте ваш телефон, и менеджер свяжется с вами.";
    expect(validate(pressuredHandoff, turnView)).toMatchObject({ ok: true });
  });

  it("does not use a normalized previous message as a live send gate", () => {
    const turnView = buildLiveV2TurnView(
      buildLiveV2TestTurn({
        inbound: "Я пока не решил",
        previousMessagesNewestFirst: [
          contextMessage({
            id: 1,
            role: "assistant",
            text: "Какой материал вам ближе?"
          })
        ]
      })
    );

    expect(
      validate(
        clarifyingCandidate({
          slot: "material",
          replyDraft: "Уточните, пожалуйста: какой материал вам ближе?"
        }),
        turnView
      )
    ).toMatchObject({ ok: true });
  });
});

function validate(
  value: unknown,
  turnView = buildLiveV2TurnView(buildLiveV2TestTurn())
) {
  return validateLiveV2Candidate({
    value,
    turnView,
    approvedFacts: TEST_LIVE_V2_FACTS
  });
}
