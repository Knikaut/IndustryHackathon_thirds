"""Проверка управляемого ремонта на живом движке двойника."""

import json
import os
import unittest
from datetime import timedelta
from unittest.mock import patch

from fastapi import HTTPException

from app.engine import Engine
from app import main
from app.scenarios import ANSWERS, BY_ID, CATALOG, REPORTS, UnknownOption


def make_engine(now="2026-10-06T09:00"):
    """Движок с заданным моментом старта: вторник, начало первой смены."""
    with patch.dict(os.environ, {"TWIN_NOW": now}):
        return Engine()


def right(spec, kind):
    answer = ANSWERS[spec["id"]]["diagnosis" if kind == "diagnosis" else "repair"]
    return next(o for o in spec[f"{kind}_options"] if o["id"] == answer)


def wrong(spec, kind):
    answer = right(spec, kind)["id"]
    return next(o for o in spec[f"{kind}_options"] if o["id"] != answer)


class ScenarioFlowTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = Engine()

    def test_fault_is_held_until_diagnosis_repair_and_verification(self):
        e = self.engine
        catalog = e.scenarios.status()["catalog"]
        self.assertGreaterEqual(len(catalog), 3)
        self.assertEqual(len({item["station"] for item in catalog}), len(catalog))

        case = e.scenarios.start("paint-filter")
        self.assertEqual(case["stage"], "diagnose")
        sid = case["station"]
        self.assertEqual(e.store.open_event(sid)["cause"], "Замена фильтра")
        self.assertEqual(e.snapshot["stations"][next(i for i, s in enumerate(e.snapshot["stations"]) if s["id"] == sid)]["state"], "down")

        for _ in range(15):
            e.tick()
        self.assertIsNotNone(e.store.open_event(sid), "управляемый отказ не должен исчезнуть сам")
        with self.assertRaises(ValueError):
            e.scenarios.start("robot-sensor")

        case = e.scenarios.advance()
        self.assertEqual(case["stage"], "repair")
        self.assertIsNotNone(e.store.open_event(sid))
        case = e.scenarios.advance()
        self.assertEqual(case["stage"], "verify")
        self.assertIsNotNone(e.store.open_event(sid))
        case = e.scenarios.advance()
        self.assertEqual(case["stage"], "done")
        self.assertIsNone(e.store.open_event(sid))
        self.assertGreater(case["downtime_min"], 0)
        self.assertEqual(e.scenarios.status()["active"]["stage"], "done")

        next_case = e.scenarios.start("robot-sensor")
        self.assertEqual(next_case["stage"], "diagnose")

    def test_unknown_scenario_is_rejected(self):
        with self.assertRaises(KeyError):
            self.engine.scenarios.start("not-a-scenario")


class CatalogContractTest(unittest.TestCase):
    def test_every_scenario_offers_a_choice_without_revealing_the_answer(self):
        self.assertEqual(len(CATALOG), 4)
        for spec in CATALOG:
            ans = ANSWERS[spec["id"]]
            self.assertTrue(spec["public_title"])
            for kind, key in (("diagnosis", "diagnosis"), ("repair", "repair")):
                options = spec[f"{kind}_options"]
                self.assertGreaterEqual(len(options), 2, spec["id"])
                self.assertEqual(len({o["id"] for o in options}), len(options))
                for o in options:
                    self.assertEqual(set(o), {"id", "label", "hint", "minutes"})
                    self.assertTrue(o["minutes"] > 0 and o["minutes"] % 5 == 0)
                self.assertIn(ans[key], {o["id"] for o in options})
                # у каждого неверного варианта есть свой наблюдаемый результат
                self.assertEqual(set(ans[f"{key}_miss"]), {o["id"] for o in options} - {ans[key]})
            # на верном пути время то же, что у прежнего маршрута без выбора
            self.assertEqual(right(spec, "diagnosis")["minutes"], spec["diagnosis_min"])
            self.assertEqual(right(spec, "repair")["minutes"], spec["repair_min"])
            shown = (spec["public_title"] + " " + spec["symptom"]).casefold()
            for secret in (spec["cause"], right(spec, "diagnosis")["label"], right(spec, "repair")["label"]):
                self.assertNotIn(secret.casefold(), shown, spec["id"])

    def test_answers_stay_on_the_server(self):
        public = json.dumps(CATALOG, ensure_ascii=False)
        self.assertNotIn('"correct"', public)
        for ans in ANSWERS.values():
            for text in (ans["diagnosis_ok"], ans["repair_ok"], *ans["diagnosis_miss"].values(), *ans["repair_miss"].values()):
                self.assertNotIn(text, public)
        # верный вариант нельзя угадать по месту в списке или по длительности
        for kind in ("diagnosis", "repair"):
            places = {spec[f"{kind}_options"].index(right(spec, kind)) for spec in CATALOG}
            self.assertGreater(len(places), 1, kind)
        longest = [right(s, "repair")["minutes"] == max(o["minutes"] for o in s["repair_options"]) for s in CATALOG]
        self.assertFalse(all(longest))


class LabCase(unittest.TestCase):
    def setUp(self):
        self.e = make_engine()
        self.lab = self.e.scenarios

    def unit(self, sid):
        return self.e.sim._find(sid)

    def shown_state(self, sid):
        return next(s["state"] for s in self.e.snapshot["stations"] if s["id"] == sid)


class InteractiveRepairTest(LabCase):
    def test_right_path_closes_downtime_only_after_verification(self):
        spec, sid = BY_ID["robot-sensor"], "W3"
        case = self.lab.start("robot-sensor")
        self.assertEqual((case["stage"], case["feedback"], case["downtime_min"]), ("diagnose", None, 5))
        self.assertNotIn(spec["cause"], case["log"][0]["text"])

        choice = right(spec, "diagnosis")
        case = self.lab.diagnose(choice["id"])
        self.assertEqual((case["stage"], case["feedback"]["kind"]), ("repair", "success"))
        self.assertEqual(case["downtime_min"], 5 + choice["minutes"])

        action = right(spec, "repair")
        case = self.lab.repair(action["id"])
        self.assertEqual((case["stage"], case["repair_id"]), ("verify", action["id"]))
        self.assertIn(action["label"], case["log"][-1]["text"])
        self.assertEqual(case["downtime_min"], 5 + choice["minutes"] + action["minutes"])
        # до проверочного пуска пост стоит, узел не восстановлен
        self.assertIsNotNone(self.e.store.open_event(sid))
        self.assertEqual(self.shown_state(sid), "down")
        self.assertTrue(self.unit(sid).manual_hold)

        case = self.lab.verify()
        self.assertEqual((case["stage"], case["feedback"]["kind"], case["mistakes"]), ("done", "success", 0))
        self.assertIsNotNone(case["finished"])
        self.assertIsNone(self.e.store.open_event(sid))
        self.assertFalse(self.unit(sid).manual_hold)
        self.assertAlmostEqual(self.unit(sid).h, 0.97, delta=0.005)
        total = case["downtime_min"]
        for _ in range(6):
            self.e.tick()
        self.assertEqual(self.lab.status()["active"]["downtime_min"], total, "итог наряда не должен расти после закрытия")
        json.dumps(self.lab.status(), allow_nan=False)

    def test_wrong_diagnosis_costs_time_and_keeps_the_stage(self):
        spec, sid = BY_ID["paint-filter"], "P3"
        case = self.lab.start("paint-filter")
        miss, clock = wrong(spec, "diagnosis"), self.e.clock

        case = self.lab.diagnose(miss["id"])
        self.assertEqual((case["stage"], case["feedback"]["kind"], case["mistakes"]), ("diagnose", "warning", 1))
        self.assertEqual(case["downtime_min"], 5 + miss["minutes"])
        self.assertEqual(self.e.clock - clock, timedelta(minutes=miss["minutes"]))
        self.assertEqual(len(case["log"]), 2)
        self.assertIn(miss["label"], case["log"][-1]["text"])
        # верная причина не подсказывается
        told = case["feedback"]["text"] + case["log"][-1]["text"]
        self.assertNotIn(right(spec, "diagnosis")["label"], told)
        self.assertNotIn(spec["cause"], told)
        self.assertEqual(self.shown_state(sid), "down")

        case = self.lab.diagnose(miss["id"])   # та же ошибка снова стоит времени
        self.assertEqual((case["stage"], case["mistakes"], case["downtime_min"]), ("diagnose", 2, 5 + 2 * miss["minutes"]))
        case = self.lab.diagnose(right(spec, "diagnosis")["id"])
        self.assertEqual((case["stage"], case["feedback"]["kind"]), ("repair", "success"))

    def test_wrong_repair_fails_verification_and_leaves_the_unit_broken(self):
        spec, sid = BY_ID["conveyor-chain"], "A2"
        self.lab.start("conveyor-chain")
        self.lab.diagnose(right(spec, "diagnosis")["id"])
        health, event_id = self.unit(sid).h, self.e.store.open_event(sid)["id"]

        miss = wrong(spec, "repair")
        case = self.lab.repair(miss["id"])
        self.assertEqual((case["stage"], case["feedback"]), ("verify", None))
        before = case["downtime_min"]

        case = self.lab.verify()
        self.assertEqual((case["stage"], case["feedback"]["kind"], case["mistakes"]), ("repair", "error", 1))
        self.assertIn("не пройден", case["log"][-1]["text"])
        self.assertEqual(case["downtime_min"], before + spec["verify_min"])
        self.assertIsNone(case["finished"])
        # событие простоя то же и открыто; узел не восстановлен
        self.assertEqual(self.e.store.open_event(sid)["id"], event_id)
        self.assertEqual(self.shown_state(sid), "down")
        self.assertTrue(self.unit(sid).manual_hold)
        self.assertEqual(self.unit(sid).h, health)

        for _ in range(12):   # и сам пост не оживает
            self.e.tick()
        self.assertIsNotNone(self.e.store.open_event(sid))

        case = self.lab.repair(right(spec, "repair")["id"])
        self.assertEqual(case["stage"], "verify")
        self.assertIsNotNone(self.e.store.open_event(sid), "простой закрывает только удачная проверка")
        case = self.lab.verify()
        self.assertEqual((case["stage"], case["feedback"]["kind"]), ("done", "success"))
        self.assertIsNone(self.e.store.open_event(sid))
        self.assertAlmostEqual(self.unit(sid).h, 0.97, delta=0.005)

    def test_wrong_stage_and_unknown_option_change_nothing(self):
        with self.assertRaises(ValueError):
            self.lab.diagnose("sensor")   # наряда ещё нет
        spec = BY_ID["camera-sensor"]
        self.lab.start("camera-sensor")
        clock = self.e.clock

        with self.assertRaises(UnknownOption):
            self.lab.diagnose("no-such-option")
        with self.assertRaises(UnknownOption):   # вариант ремонта — не диагноз
            self.lab.diagnose(right(spec, "repair")["id"])
        for step in (lambda: self.lab.repair(right(spec, "repair")["id"]), self.lab.verify):
            with self.assertRaises(ValueError) as stage_error:
                step()
            self.assertNotIsInstance(stage_error.exception, UnknownOption)

        case = self.lab.status()["active"]
        self.assertEqual((case["stage"], case["downtime_min"], len(case["log"]), case["mistakes"]), ("diagnose", 5, 1, 0))
        self.assertEqual(self.e.clock, clock, "отклонённая команда не тратит модельное время")

    def test_second_order_is_blocked_and_station_does_not_recover_itself(self):
        self.lab.start("robot-sensor")
        for _ in range(60):   # пять часов модели без действий
            self.e.tick()
        self.assertIsNotNone(self.e.store.open_event("W3"))
        self.assertEqual(self.shown_state("W3"), "down")
        self.assertEqual(self.lab.status()["active"]["downtime_min"], 5 + 60 * 5)
        with self.assertRaises(ValueError):
            self.lab.start("paint-filter")
        self.assertEqual(self.lab.status()["active"]["id"], "robot-sensor")

    def test_old_advance_route_still_finishes_the_order(self):
        spec = BY_ID["paint-filter"]
        self.lab.start("paint-filter")
        self.lab.diagnose(right(spec, "diagnosis")["id"])
        self.lab.repair(wrong(spec, "repair")["id"])
        self.assertEqual(self.lab.advance()["stage"], "repair")   # проверка неудачна
        self.assertEqual(self.lab.advance()["stage"], "verify")
        self.assertEqual(self.lab.advance()["stage"], "done")
        self.assertIsNone(self.e.store.open_event("P3"))


REPORT_FIELDS = {"at", "crew", "diagnosis", "action", "minutes", "material", "note", "status", "closed_at"}


class CrewReportTest(LabCase):
    def to_repair(self, scenario_id):
        spec = BY_ID[scenario_id]
        self.lab.start(scenario_id)
        self.lab.diagnose(right(spec, "diagnosis")["id"])
        return spec, spec["station"]

    def test_action_produces_a_pending_report(self):
        spec = BY_ID["robot-sensor"]
        case = self.lab.start("robot-sensor")
        self.assertEqual((case["report"], case["reports"]), (None, []))
        case = self.lab.diagnose(right(spec, "diagnosis")["id"])
        self.assertEqual((case["report"], case["reports"]), (None, []), "до работ отчёта нет")

        action, lines = right(spec, "repair"), len(case["log"])
        case = self.lab.repair(action["id"])
        report = case["report"]
        self.assertEqual(set(report), REPORT_FIELDS)
        self.assertEqual(report, dict(
            at=self.e.clock.isoformat(timespec="minutes"), crew="Электромеханик + оператор",
            diagnosis=right(spec, "diagnosis")["label"], action=action["label"], minutes=action["minutes"],
            material="Датчик положения, 1 шт.",
            note="Разъём очищен, датчик заменён, калибровка по контрольной точке выполнена.",
            status="pending", closed_at=None))
        self.assertEqual(case["reports"], [report])
        self.assertEqual((case["stage"], case["feedback"]), ("verify", None))
        self.assertEqual(len(case["log"]), lines + 1)
        self.assertIn("отчёт", case["log"][-1]["text"].casefold())
        self.assertIn(action["label"], case["log"][-1]["text"])
        self.assertEqual(case, self.lab.status()["active"])
        json.dumps(case, allow_nan=False)

    def test_accepting_the_report_after_the_right_action_restarts_the_station(self):
        spec, sid = self.to_repair("paint-filter")
        pending = self.lab.repair(right(spec, "repair")["id"])
        self.assertIsNotNone(self.e.store.open_event(sid), "до решения диспетчера пост стоит")
        self.assertTrue(self.unit(sid).manual_hold)

        case = self.lab.accept_report()
        self.assertEqual((case["stage"], case["feedback"]["kind"], case["mistakes"]), ("done", "success", 0))
        self.assertEqual((case["report"]["status"], case["report"]["closed_at"]), ("accepted", case["finished"]))
        self.assertEqual(case["reports"], [case["report"]])
        self.assertIsNone(self.e.store.open_event(sid))
        self.assertNotEqual(self.shown_state(sid), "down")
        self.assertFalse(self.unit(sid).manual_hold)
        self.assertAlmostEqual(self.unit(sid).h, 0.97, delta=0.005)
        self.assertEqual(len(case["log"]), len(pending["log"]) + 1)
        self.assertIn("Отчёт принят", case["log"][-1]["text"])
        # уже отданный ответ задним числом не меняется
        self.assertEqual((pending["report"]["status"], pending["report"]["closed_at"]), ("pending", None))
        total = case["downtime_min"]
        for _ in range(6):
            self.e.tick()
        self.assertEqual(self.lab.status()["active"]["downtime_min"], total)
        json.dumps(self.lab.status(), allow_nan=False)

    def test_accepting_the_report_after_a_wrong_action_fails_the_launch(self):
        spec, sid = self.to_repair("conveyor-chain")
        health, event_id = self.unit(sid).h, self.e.store.open_event(sid)["id"]
        miss = wrong(spec, "repair")
        pending = self.lab.repair(miss["id"])

        case = self.lab.accept_report()
        self.assertEqual((case["stage"], case["feedback"]["kind"], case["mistakes"]), ("repair", "error", 1))
        seen = ANSWERS[spec["id"]]["repair_miss"][miss["id"]]
        self.assertIn(seen, case["feedback"]["text"])
        self.assertEqual(case["report"]["status"], "failed")
        self.assertEqual(case["report"]["closed_at"], self.e.clock.isoformat(timespec="minutes"))
        self.assertEqual(case["downtime_min"], pending["downtime_min"] + spec["verify_min"])
        self.assertIsNone(case["finished"])
        self.assertEqual(len(case["log"]), len(pending["log"]) + 1)
        self.assertIn("не пройден", case["log"][-1]["text"])
        # событие простоя то же и открыто; узел не восстановлен
        self.assertEqual(self.e.store.open_event(sid)["id"], event_id)
        self.assertEqual(self.shown_state(sid), "down")
        self.assertTrue(self.unit(sid).manual_hold)
        self.assertEqual(self.unit(sid).h, health)
        json.dumps(case, allow_nan=False)

    def test_returning_the_report_costs_nothing_and_keeps_the_station_down(self):
        spec, sid = self.to_repair("camera-sensor")
        health, event_id = self.unit(sid).h, self.e.store.open_event(sid)["id"]
        first = wrong(spec, "repair")
        pending = self.lab.repair(first["id"])
        clock = self.e.clock

        case = self.lab.return_report()
        self.assertEqual((case["stage"], case["mistakes"], case["finished"]), ("repair", 0, None))
        self.assertEqual(case["feedback"], {"kind": "warning", "text": "Отчёт возвращён бригаде. Выберите другое действие."})
        self.assertEqual((case["report"]["status"], case["report"]["closed_at"]),
                         ("returned", clock.isoformat(timespec="minutes")))
        self.assertEqual(self.e.clock, clock, "возврат не тратит модельное время")
        self.assertEqual(case["downtime_min"], pending["downtime_min"])
        self.assertEqual(len(case["log"]), len(pending["log"]) + 1)
        self.assertIn("возвращён", case["log"][-1]["text"])
        self.assertIn(first["label"], case["log"][-1]["text"])
        self.assertEqual(self.e.store.open_event(sid)["id"], event_id)
        self.assertEqual(self.shown_state(sid), "down")
        self.assertTrue(self.unit(sid).manual_hold)
        self.assertEqual(self.unit(sid).h, health)
        for _ in range(12):   # и сам пост без нового действия не оживает
            self.e.tick()
        self.assertIsNotNone(self.e.store.open_event(sid))

        # новое действие — новый отчёт; прежний остаётся в наряде
        second = right(spec, "repair")
        case = self.lab.repair(second["id"])
        self.assertEqual([r["status"] for r in case["reports"]], ["returned", "pending"])
        self.assertEqual([r["action"] for r in case["reports"]], [first["label"], second["label"]])
        self.assertEqual(case["report"], case["reports"][-1])
        case = self.lab.accept_report()
        self.assertEqual((case["stage"], case["mistakes"]), ("done", 0))
        self.assertEqual([r["status"] for r in case["reports"]], ["returned", "accepted"])
        self.assertIsNone(self.e.store.open_event(sid))
        json.dumps(self.lab.status(), allow_nan=False)

    def test_report_commands_need_a_report_under_review(self):
        commands = (self.lab.accept_report, self.lab.return_report)

        def refused(why="Нет активного ремонта"):
            for command in commands:
                with self.assertRaises(ValueError) as error:
                    command()
                self.assertNotIsInstance(error.exception, UnknownOption)
                # шага «проверка» на странице нет: отказ говорит об отчёте
                self.assertIn(why, str(error.exception))
                self.assertNotIn("проверка", str(error.exception))

        refused()   # наряда ещё нет
        spec = BY_ID["robot-sensor"]
        self.lab.start("robot-sensor")
        clock = self.e.clock
        refused("ещё не поступил")   # этап «диагностика»
        case = self.lab.status()["active"]
        self.assertEqual((case["stage"], case["downtime_min"], len(case["log"]), case["mistakes"], case["report"]),
                         ("diagnose", 5, 1, 0, None))
        self.assertEqual(self.e.clock, clock, "отклонённая команда не тратит модельное время")

        self.lab.diagnose(right(spec, "diagnosis")["id"])
        refused("ещё не поступил")   # этап «устранение»: отчёта ещё нет
        with self.assertRaises(ValueError) as old_name:
            self.lab.verify()   # у прежнего шага текст отказа прежний
        self.assertIn("проверка", str(old_name.exception))
        self.lab.repair(wrong(spec, "repair")["id"])
        self.lab.return_report()
        refused("уже принято")   # возвращённый отчёт второй раз не рассматривается
        self.assertEqual([r["status"] for r in self.lab.status()["active"]["reports"]], ["returned"])
        self.lab.repair(right(spec, "repair")["id"])
        self.lab.accept_report()
        refused()   # наряд закрыт
        self.assertEqual([r["status"] for r in self.lab.status()["active"]["reports"]], ["returned", "accepted"])

    def test_old_verify_and_advance_decide_on_the_report(self):
        spec, sid = self.to_repair("paint-filter")
        self.lab.repair(wrong(spec, "repair")["id"])
        case = self.lab.verify()
        self.assertEqual((case["stage"], case["report"]["status"], case["mistakes"]), ("repair", "failed", 1))
        self.lab.repair(wrong(spec, "repair")["id"])
        case = self.lab.advance()   # на этапе проверки прежний маршрут принимает отчёт
        self.assertEqual((case["stage"], case["report"]["status"]), ("repair", "failed"))
        case = self.lab.advance()
        self.assertEqual((case["stage"], case["report"]["status"]), ("verify", "pending"))
        self.assertEqual(case["report"]["action"], right(spec, "repair")["label"])
        case = self.lab.verify()
        self.assertEqual((case["stage"], case["report"]["status"]), ("done", "accepted"))
        self.assertEqual([r["status"] for r in case["reports"]], ["failed", "failed", "accepted"])
        self.assertIsNone(self.e.store.open_event(sid))

    def test_report_says_what_was_done_but_not_whether_it_helped(self):
        public = json.dumps(CATALOG, ensure_ascii=False)
        for spec in CATALOG:
            ans = ANSWERS[spec["id"]]
            self.assertEqual(set(REPORTS[spec["id"]]), {o["id"] for o in spec["repair_options"]})
            self.lab.start(spec["id"])
            self.lab.diagnose(ans["diagnosis"])
            # верное действие — последним: остальные отчёты возвращаем без пуска
            actions = sorted(spec["repair_options"], key=lambda o: o["id"] == ans["repair"])
            for action in actions:
                case = self.lab.repair(action["id"])
                report = case["report"]
                material, note = REPORTS[spec["id"]][action["id"]]
                self.assertEqual(set(report), REPORT_FIELDS, action["id"])
                self.assertEqual((report["status"], report["material"], report["note"], report["minutes"]),
                                 ("pending", material, note, action["minutes"]))
                self.assertTrue(material and note)
                self.assertIsNone(case["feedback"])
                # ни отчёт, ни запись журнала не говорят, чем кончится пуск
                told = json.dumps([report, case["log"][-1]], ensure_ascii=False)
                for outcome in (ans["repair_ok"], *ans["repair_miss"].values()):
                    self.assertNotIn(outcome, told, action["id"])
                self.assertNotIn(note, public)
                json.dumps(case, allow_nan=False)
                if action["id"] != ans["repair"]:
                    self.lab.return_report()
            case = self.lab.accept_report()
            self.assertEqual((case["stage"], case["mistakes"], len(case["reports"])), ("done", 0, len(actions)))
        self.assertNotIn('"correct"', public)
        self.assertNotIn('"report', public)
        history = self.lab.status()["history"]
        self.assertEqual([c["report"]["status"] for c in history], ["accepted"] * (len(CATALOG) - 1))
        json.dumps(self.lab.status(), allow_nan=False)


class NightBoundaryTest(unittest.TestCase):
    def test_downtime_keeps_growing_across_the_night(self):
        e = make_engine("2026-10-06T23:40")
        lab, spec, sid = e.scenarios, BY_ID["paint-filter"], "P3"
        case = lab.start("paint-filter")
        first_event, miss = case["event_id"], wrong(spec, "diagnosis")
        lab.diagnose(miss["id"])
        case = lab.diagnose(miss["id"])   # второй раз уже через полночь
        self.assertEqual((e.clock.hour, e.clock.day), (8, 7))
        # журнал открыл новое событие, а простой наряда считается по обоим
        self.assertNotEqual(e.store.open_event(sid)["id"], first_event)
        self.assertEqual(case["downtime_min"], 5 + 2 * miss["minutes"])

        lab.diagnose(right(spec, "diagnosis")["id"])
        lab.repair(right(spec, "repair")["id"])
        case = lab.verify()
        self.assertEqual(case["stage"], "done")
        self.assertIsNone(e.store.open_event(sid))
        self.assertEqual(case["downtime_min"], 5 + 2 * miss["minutes"] + spec["diagnosis_min"] + spec["repair_min"])

    def test_report_written_at_night_arrives_with_the_morning_shift(self):
        e = make_engine("2026-10-06T23:40")
        lab, spec, sid = e.scenarios, BY_ID["paint-filter"], "P3"
        lab.start("paint-filter")
        lab.diagnose(right(spec, "diagnosis")["id"])
        case = lab.repair(wrong(spec, "repair")["id"])   # работы уходят за полночь
        self.assertEqual((e.clock.hour, e.clock.day), (8, 7))
        self.assertEqual(case["report"]["at"], e.clock.isoformat(timespec="minutes"))
        down = case["downtime_min"]

        case = lab.return_report()
        self.assertEqual((case["report"]["status"], case["report"]["closed_at"]), ("returned", case["report"]["at"]))
        self.assertEqual(case["downtime_min"], down)
        lab.repair(right(spec, "repair")["id"])
        case = lab.accept_report()
        self.assertEqual([r["status"] for r in case["reports"]], ["returned", "accepted"])
        self.assertEqual((case["stage"], case["report"]["closed_at"]), ("done", case["finished"]))
        self.assertIsNone(e.store.open_event(sid))


class ScenarioApiTest(unittest.TestCase):
    def test_direct_page_and_scenario_commands(self):
        e = Engine()
        with patch.object(main, "engine", e):
            page = main.scenarios_page()
            self.assertTrue(str(page.path).endswith("index.html"))
            self.assertEqual(len(main.get_scenarios()["catalog"]), 4)
            self.assertEqual(main.start_scenario("conveyor-chain")["stage"], "diagnose")
            with self.assertRaises(HTTPException) as protected:
                main.demo_repair("A2")
            self.assertEqual(protected.exception.status_code, 409)
            with self.assertRaises(HTTPException) as conflict:
                main.start_scenario("paint-filter")
            self.assertEqual(conflict.exception.status_code, 409)
            self.assertEqual(main.advance_scenario()["stage"], "repair")
            self.assertEqual(main.advance_scenario()["stage"], "verify")
            self.assertEqual(main.advance_scenario()["stage"], "done")
            with self.assertRaises(HTTPException) as finished:
                main.advance_scenario()
            self.assertEqual(finished.exception.status_code, 409)
            with self.assertRaises(HTTPException) as missing:
                main.start_scenario("missing")
            self.assertEqual(missing.exception.status_code, 404)

    def rejected(self, status, call, *args):
        with self.assertRaises(HTTPException) as caught:
            call(*args)
        self.assertEqual(caught.exception.status_code, status)
        self.assertIsInstance(caught.exception.detail, str)   # интерфейс показывает detail как текст
        self.assertTrue(caught.exception.detail)

    def test_choice_commands_and_their_errors(self):
        e = make_engine()
        spec = BY_ID["robot-sensor"]
        ok_diagnosis, ok_repair = right(spec, "diagnosis")["id"], right(spec, "repair")["id"]
        with patch.object(main, "engine", e):
            self.rejected(409, main.diagnose_scenario, {"option_id": ok_diagnosis})   # наряда нет
            self.rejected(409, main.verify_scenario)
            self.assertEqual(main.start_scenario("robot-sensor")["stage"], "diagnose")

            for body in (None, {}, {"option_id": ""}, {"option_id": 5}, [ok_diagnosis], "sensor"):
                self.rejected(400, main.diagnose_scenario, body)
            self.rejected(400, main.diagnose_scenario, {"option_id": "no-such-option"})
            self.rejected(409, main.repair_scenario, {"option_id": ok_repair})   # ещё не тот этап
            self.rejected(409, main.verify_scenario)

            reply = main.diagnose_scenario({"option_id": wrong(spec, "diagnosis")["id"]})
            self.assertEqual(reply, main.get_scenarios()["active"])
            self.assertEqual((reply["stage"], reply["feedback"]["kind"]), ("diagnose", "warning"))
            self.assertEqual(main.diagnose_scenario({"option_id": ok_diagnosis})["stage"], "repair")
            self.rejected(400, main.repair_scenario, {"option_id": ok_diagnosis})   # диагноз — не действие
            self.assertEqual(main.repair_scenario({"option_id": wrong(spec, "repair")["id"]})["stage"], "verify")
            reply = main.verify_scenario()
            self.assertEqual((reply["stage"], reply["feedback"]["kind"]), ("repair", "error"))
            self.assertEqual(reply, main.get_scenarios()["active"])

            # после неудачной проверки пост по-прежнему занят нарядом
            for demo in (main.demo_repair, main.demo_fail, main.demo_degrade):
                self.rejected(409, demo, "W3")
            self.rejected(409, main.start_scenario, "paint-filter")
            self.assertEqual(main.demo_degrade("L1"), {"ok": True})   # другие посты доступны

            self.assertEqual(main.repair_scenario({"option_id": ok_repair})["stage"], "verify")
            reply = main.verify_scenario()
            self.assertEqual((reply["stage"], reply["feedback"]["kind"]), ("done", "success"))
            self.assertEqual(reply, main.get_scenarios()["active"])
            json.dumps(main.get_scenarios(), allow_nan=False)

            self.rejected(409, main.diagnose_scenario, {"option_id": ok_diagnosis})
            self.rejected(409, main.verify_scenario)
            self.rejected(404, main.start_scenario, "missing")
            self.assertEqual(main.demo_repair("W3"), {"ok": True})   # наряд закрыт — пост свободен


    def test_report_commands_and_their_errors(self):
        paths = {r.path: r.methods for r in main.app.routes if "/report/" in getattr(r, "path", "")}
        self.assertEqual(paths, {"/api/scenarios/report/accept": {"POST"}, "/api/scenarios/report/return": {"POST"}})
        e = make_engine()
        spec = BY_ID["conveyor-chain"]
        with patch.object(main, "engine", e):
            for command in (main.accept_scenario_report, main.return_scenario_report):
                self.rejected(409, command)   # наряда нет
            self.assertEqual(main.start_scenario("conveyor-chain")["report"], None)
            main.diagnose_scenario({"option_id": right(spec, "diagnosis")["id"]})
            for command in (main.accept_scenario_report, main.return_scenario_report):
                self.rejected(409, command)   # отчёт ещё не поступил

            reply = main.repair_scenario({"option_id": wrong(spec, "repair")["id"]})
            self.assertEqual((reply["stage"], reply["report"]["status"]), ("verify", "pending"))
            reply = main.return_scenario_report()
            self.assertEqual((reply["stage"], reply["report"]["status"], reply["feedback"]["kind"]),
                             ("repair", "returned", "warning"))
            self.assertEqual(reply, main.get_scenarios()["active"])
            self.rejected(409, main.accept_scenario_report)
            self.rejected(409, main.demo_repair, "A2")   # после возврата пост по-прежнему занят нарядом

            main.repair_scenario({"option_id": wrong(spec, "repair")["id"]})
            reply = main.accept_scenario_report()
            self.assertEqual((reply["stage"], reply["report"]["status"], reply["feedback"]["kind"]),
                             ("repair", "failed", "error"))
            self.assertEqual(reply, main.get_scenarios()["active"])

            main.repair_scenario({"option_id": right(spec, "repair")["id"]})
            reply = main.accept_scenario_report()
            self.assertEqual((reply["stage"], reply["report"]["status"], reply["feedback"]["kind"]),
                             ("done", "accepted", "success"))
            self.assertEqual([r["status"] for r in reply["reports"]], ["returned", "failed", "accepted"])
            self.assertEqual(reply, main.get_scenarios()["active"])
            json.dumps(main.get_scenarios(), allow_nan=False)
            for command in (main.accept_scenario_report, main.return_scenario_report):
                self.rejected(409, command)   # наряд закрыт


if __name__ == "__main__":
    unittest.main()
