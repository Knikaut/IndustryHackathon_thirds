"""Демонстрационные наряды на ремонт: диагноз и действие выбирает пользователь.

Все длительности условные и измеряются рабочими тактами двойника. Это
учебный сценарий, а не инструкция по обслуживанию настоящего оборудования:
оборудованием он не управляет. История наряда живёт в памяти процесса и
пропадает при перезапуске.
"""

def iso(ts):
    return ts.isoformat(timespec="minutes") if ts else None


class UnknownOption(ValueError):
    """Такого варианта у сценария нет (HTTP 400)."""


def _opt(id, label, hint, minutes):
    return dict(id=id, label=label, hint=hint, minutes=minutes)


# public_title и symptom описывают только наблюдаемое. Поля title, cause, diagnosis, repair и part
# оставлены для прежнего интерфейса и раскрывают ответ: новый интерфейс не должен их показывать
# до конца наряда. Верный вариант стоит на разных местах и не всегда самый долгий.
CATALOG = [
    dict(id="robot-sensor", station="W3", title="Сбой датчика робота",
         public_title="На посту W3 нарушена геометрия",
         cause="Ошибка датчика", symptom="Позиция захвата расходится с заданной; робот останавливает сварку.",
         diagnosis="Сверить сигнал датчика положения с контрольной точкой и подтвердить смещение.",
         repair="Очистить разъём, заменить датчик положения и выполнить калибровку.",
         verify="Прогнать пробный кузов и проверить точность сварочных точек.",
         crew="Электромеханик + оператор", part="Датчик положения",
         diagnosis_min=10, repair_min=25, verify_min=5,
         diagnosis_options=[
             _opt("drive", "Неисправность привода", "Проверить ток и движение", 10),
             _opt("sensor", "Ошибка датчика положения", "Сверить контрольную точку", 10),
             _opt("program", "Сбита программа траектории", "Сравнить программу с эталонной копией", 15),
         ],
         repair_options=[
             _opt("replace-sensor", "Заменить датчик и откалибровать", "Нужен датчик положения", 25),
             _opt("restart-drive", "Перезапустить привод", "Без замены датчика", 10),
             _opt("reteach-points", "Заново обучить точки траектории", "Полный проход по контрольным точкам", 30),
         ]),
    dict(id="paint-filter", station="P3", title="Засор фильтра окрасочной камеры",
         public_title="Нестабильная подача краски на посту P3",
         cause="Замена фильтра", symptom="Давление в камере колеблется, покрытие получается неравномерным.",
         diagnosis="Сравнить перепад давления на фильтре с рабочим диапазоном.",
         repair="Изолировать подачу, заменить фильтр и восстановить давление.",
         verify="Нанести тестовый слой и проверить равномерность покрытия.",
         crew="Механик + маляр", part="Сменный фильтр",
         diagnosis_min=10, repair_min=20, verify_min=5,
         diagnosis_options=[
             _opt("pump", "Неисправен насос", "Проверить давление на выходе насоса", 10),
             _opt("nozzle", "Забиты форсунки", "Осмотреть факел распыла", 10),
             _opt("filter", "Засорён фильтр", "Проверить перепад давления до и после фильтра", 10),
         ],
         repair_options=[
             _opt("restart-pump", "Перезапустить насос", "Без замены фильтрующего элемента", 10),
             _opt("replace-filter", "Заменить фильтр и восстановить давление", "Потребуется сменный фильтр", 20),
             _opt("strip-nozzles", "Снять и промыть форсунки", "С разборкой распылителей", 25),
         ]),
    dict(id="conveyor-chain", station="A2", title="Обрыв цепи конвейера",
         public_title="Кузов не движется на посту A2",
         cause="Обрыв цепи", symptom="Привод вращается, но кузов не перемещается; пост сборки стоит.",
         diagnosis="Остановить привод и осмотреть цепь, звёздочку и натяжение.",
         repair="Заменить повреждённое звено, натянуть цепь и выставить привод.",
         verify="Провести холостой прогон и затем пропустить один кузов.",
         crew="Два механика", part="Соединительное звено цепи",
         diagnosis_min=15, repair_min=35, verify_min=5,
         diagnosis_options=[
             _opt("chain", "Разрыв тяговой цепи", "Остановить привод и осмотреть цепь по всей длине", 15),
             _opt("motor", "Отказ двигателя привода", "Замерить ток и обороты двигателя", 10),
             _opt("stopper", "Заклинил упор кузова", "Осмотреть упоры и фиксаторы тележки", 10),
         ],
         repair_options=[
             _opt("reset-drive", "Сбросить защиту и перезапустить привод", "Без вскрытия кожуха", 10),
             _opt("release-stopper", "Освободить и смазать упор", "Ручной инструмент", 15),
             _opt("replace-link", "Заменить звено и натянуть цепь", "Нужно соединительное звено", 35),
         ]),
    dict(id="camera-sensor", station="P5", title="Ошибка камеры контроля",
         public_title="Контроль покрытия на посту P5 не распознаёт кузов",
         cause="Ошибка датчика", symptom="Система контроля покрытия теряет опорное изображение.",
         diagnosis="Проверить объектив, подсветку и контрольный кадр.",
         repair="Очистить оптику, восстановить подсветку и перекалибровать камеру.",
         verify="Сравнить пробный снимок с эталоном и подтвердить распознавание.",
         crew="Инженер КИП + оператор", part="Комплект очистки оптики",
         diagnosis_min=10, repair_min=15, verify_min=5,
         diagnosis_options=[
             _opt("network", "Потеря связи с сервером распознавания", "Проверить канал и задержку ответа", 10),
             _opt("optics", "Загрязнена оптика, сбита калибровка", "Снять контрольный кадр и осмотреть объектив", 10),
             _opt("lighting", "Отказ блока подсветки", "Замерить освещённость в зоне съёмки", 10),
         ],
         repair_options=[
             _opt("replace-lamp", "Заменить лампы подсветки", "Запасной блок со склада", 20),
             _opt("clean-calibrate", "Очистить оптику и перекалибровать камеру", "Нужен комплект очистки", 15),
             _opt("restart-server", "Перезапустить сервис распознавания", "Без доступа к камере", 10),
         ]),
]
BY_ID = {item["id"]: item for item in CATALOG}

# Верные ответы и тексты обратной связи в каталог не попадают: их знает только сервер.
# diagnosis_miss — что показала проверка неверной гипотезы; repair_miss — наблюдаемый признак
# на пробном пуске после действия, которое причину не устранило.
ANSWERS = {
    "robot-sensor": dict(
        diagnosis="sensor", diagnosis_ok="Сигнал датчика расходится с контрольной точкой: смещение подтверждено.",
        diagnosis_miss={
            "drive": "Ток и ход привода в норме.",
            "program": "Программа совпадает с эталонной копией."},
        repair="replace-sensor", repair_ok="Пробный кузов сварен, точки в допуске.",
        repair_miss={
            "restart-drive": "Захват снова уходит от заданной позиции, робот остановил сварку.",
            "reteach-points": "Точки обучены заново, но захват приходит в них со смещением."}),
    "paint-filter": dict(
        diagnosis="filter", diagnosis_ok="Перепад давления на фильтре выше рабочего диапазона: засор подтверждён.",
        diagnosis_miss={
            "pump": "Давление на выходе насоса в норме.",
            "nozzle": "Факел распыла ровный на всех форсунках."},
        repair="replace-filter", repair_ok="Тестовый слой ровный, давление держится.",
        repair_miss={
            "restart-pump": "Давление в камере снова колеблется.",
            "strip-nozzles": "Тестовый слой неравномерный, давление в камере падает."}),
    "conveyor-chain": dict(
        diagnosis="chain", diagnosis_ok="Найдено разорванное звено тяговой цепи.",
        diagnosis_miss={
            "motor": "Двигатель набирает обороты, ток в норме.",
            "stopper": "Упоры свободны, тележка не зажата."},
        repair="replace-link", repair_ok="Холостой прогон и пробный кузов прошли.",
        repair_miss={
            "reset-drive": "Привод вращается, кузов не сдвинулся.",
            "release-stopper": "Упор свободен, но конвейер кузов не тянет."}),
    "camera-sensor": dict(
        diagnosis="optics", diagnosis_ok="Контрольный кадр размыт и смещён относительно эталона.",
        diagnosis_miss={
            "network": "Связь устойчива, сервер отвечает без задержек.",
            "lighting": "Освещённость в зоне съёмки в норме."},
        repair="clean-calibrate", repair_ok="Пробный снимок совпал с эталоном, кузов распознан.",
        repair_miss={
            "restart-server": "Сервис запущен, но пробный кадр по-прежнему не совпадает с эталоном.",
            "replace-lamp": "Света достаточно, изображение осталось размытым."}),
}
# Отчёт бригады по каждому действию: (израсходованный материал, замечание о сделанном).
# Замечание описывает только выполненные работы: помогли ли они, покажет пуск после принятия отчёта.
REPORTS = {
    "robot-sensor": {
        "replace-sensor": ("Датчик положения, 1 шт.",
                           "Разъём очищен, датчик заменён, калибровка по контрольной точке выполнена."),
        "restart-drive": ("Не потребовался", "Привод перезапущен, ошибок контроллера нет."),
        "reteach-points": ("Не потребовался", "Контрольные точки траектории обучены заново.")},
    "paint-filter": {
        "restart-pump": ("Не потребовался", "Насос перезапущен, давление на его выходе в рабочем диапазоне."),
        "replace-filter": ("Сменный фильтр, 1 шт.", "Подача изолирована, фильтр заменён, магистраль заполнена."),
        "strip-nozzles": ("Растворитель", "Форсунки сняты, промыты и установлены на место.")},
    "conveyor-chain": {
        "reset-drive": ("Не потребовался", "Защита привода сброшена, привод запущен на холостом ходу."),
        "release-stopper": ("Смазка", "Упор освобождён и смазан, тележка перемещается вручную."),
        "replace-link": ("Соединительное звено цепи, 1 шт.",
                         "Повреждённое звено заменено, цепь натянута, привод выставлен.")},
    "camera-sensor": {
        "replace-lamp": ("Блок подсветки, 1 шт.", "Лампы подсветки заменены, освещённость в зоне съёмки в норме."),
        "clean-calibrate": ("Комплект очистки оптики", "Оптика очищена, камера перекалибрована по эталонному кадру."),
        "restart-server": ("Не потребовался", "Сервис распознавания перезапущен, связь с камерой есть.")},
}
STAGE_NAME = {"diagnose": "диагностика", "repair": "устранение", "verify": "проверка", "done": "завершён"}


def _option(spec, kind, option_id):
    for o in spec[f"{kind}_options"]:
        if o["id"] == option_id:
            return o
    noun = "диагноза" if kind == "diagnosis" else "действия"
    raise UnknownOption(f"В этом сценарии нет варианта {noun} «{option_id}»")


class ScenarioLab:
    def __init__(self, engine):
        self.engine = engine
        self.active = None
        self.history = []

    def _downtime(self, case):
        # ночью журнал закрывает событие простоя и утром открывает новое:
        # простой наряда — все события поста начиная с отказа
        total = 0
        for ev in reversed(self.engine.store.events):
            if ev["id"] < case["event_id"]:
                break
            if ev["station"] == case["station"]:
                total += ev["minutes"]
        return total

    def _view(self, case):
        if case is None:
            return None
        # журнал и отчёты отдаём копиями: наряд дописывает их на месте, а уже отданный ответ меняться не должен
        reports = [dict(r) for r in case["reports"]]
        view = {**case, "log": list(case["log"]), "reports": reports, "report": reports[-1] if reports else None}
        if "downtime_min" not in case:   # у завершённого наряда итог уже зафиксирован
            view["downtime_min"] = self._downtime(case)
        return view

    def status(self):
        with self.engine.lock:
            return {"catalog": CATALOG, "active": self._view(self.active),
                    "history": [self._view(case) for case in self.history[-5:]][::-1]}

    def start(self, scenario_id):
        spec = BY_ID[scenario_id]  # неизвестный идентификатор — 404 у API
        with self.engine.lock:
            if self.active and self.active["stage"] != "done":
                raise ValueError("Сначала завершите текущий ремонт")
            sid = spec["station"]
            if self.engine.store.open_event(sid):
                raise ValueError("Пост уже находится в простое")
            if self.active:
                self.history.append(self.active)
            self.engine.sim.fail(sid, cause=spec["cause"], manual=True)
            self.engine.tick()  # отказ сразу виден на основном щите и в журнале
            ev = self.engine.store.open_event(sid)
            symptom = spec["symptom"][0].lower() + spec["symptom"][1:]
            self.active = dict(id=scenario_id, station=sid, stage="diagnose",
                               started=iso(ev["start"]), finished=None, event_id=ev["id"],
                               repair_id=None, mistakes=0, feedback=None, reports=[],
                               log=[dict(stage="fault", at=iso(ev["start"]), text=f"Остановка {sid}: {symptom}")])
            return self._view(self.active)

    # --- шаги наряда ----------------------------------------------------
    def _case(self, stage):
        case = self.active
        if not case or case["stage"] == "done":
            raise ValueError("Нет активного ремонта")
        if case["stage"] != stage:
            raise ValueError(f"Сейчас этап «{STAGE_NAME[case['stage']]}»: шаг «{STAGE_NAME[stage]}» недоступен")
        return case, BY_ID[case["id"]]

    def _spend(self, minutes):
        # добавочное модельное время: пост удерживается в простое, каждый такт прибавляет ему 5 минут
        for _ in range(max(1, minutes // 5)):
            self.engine.tick()

    def _log(self, case, stage, text):
        case["log"].append(dict(stage=stage, at=iso(self.engine.clock), text=text))

    def diagnose(self, option_id):
        with self.engine.lock:
            case, spec = self._case("diagnose")
            opt, ans = _option(spec, "diagnosis", option_id), ANSWERS[spec["id"]]
            self._spend(opt["minutes"])
            if option_id == ans["diagnosis"]:
                case["stage"] = "repair"
                case["feedback"] = dict(kind="success", text=ans["diagnosis_ok"])
                self._log(case, "diagnose", f"Диагноз «{opt['label']}» подтверждён")
            else:
                # время потрачено, этап прежний; верную причину не подсказываем
                seen = ans["diagnosis_miss"].get(option_id, "Гипотеза не подтвердилась.")
                case["mistakes"] += 1
                case["feedback"] = dict(kind="warning",
                                        text=f"{seen} Причина простоя ещё не найдена: потеряно {opt['minutes']} мин.")
                self._log(case, "diagnose", f"Диагноз «{opt['label']}» не подтвердился: {seen}")
            return self._view(case)

    def repair(self, option_id):
        with self.engine.lock:
            case, spec = self._case("repair")
            opt = _option(spec, "repair", option_id)
            # до этапа «устранение» наряд доходит только с подтверждённой причиной
            cause = _option(spec, "diagnosis", ANSWERS[spec["id"]]["diagnosis"])
            material, note = REPORTS[spec["id"]][option_id]
            self._spend(opt["minutes"])
            # помогло ли действие, покажет только пуск после принятия отчёта: пост по-прежнему удерживается в простое
            case["repair_id"], case["stage"], case["feedback"] = option_id, "verify", None
            case["reports"].append(dict(at=iso(self.engine.clock), crew=spec["crew"], diagnosis=cause["label"],
                                        action=opt["label"], minutes=opt["minutes"], material=material, note=note,
                                        status="pending", closed_at=None))
            self._log(case, "repair", f"Поступил отчёт бригады по действию «{opt['label']}»")
            return self._view(case)

    def _close_report(self, case, status):
        report = case["reports"][-1]
        report["status"], report["closed_at"] = status, iso(self.engine.clock)
        return report

    def _review(self):
        # на странице шага «проверка» больше нет, поэтому у решений по отчёту свой текст отказа
        case = self.active
        if case and case["stage"] in ("diagnose", "repair"):
            raise ValueError("Решение по этому отчёту уже принято: выберите следующее действие" if case["reports"]
                             else "Отчёт бригады ещё не поступил: сначала выполните работы")
        return self._case("verify")

    def accept_report(self):
        """Диспетчер принял отчёт и разрешил пуск: результат работ показывает сам пуск."""
        with self.engine.lock:
            self._review()
            return self._launch()

    def _launch(self):
        with self.engine.lock:
            case, spec = self._case("verify")
            ans = ANSWERS[spec["id"]]
            if case["repair_id"] == ans["repair"]:
                self.engine.sim.repair(case["station"])
                self.engine.tick()  # проверочный пуск закрывает событие простоя
                case["stage"], case["finished"] = "done", iso(self.engine.clock)
                case["feedback"] = dict(kind="success", text=f"{ans['repair_ok']} Пост возвращён в работу.")
                self._close_report(case, "accepted")
                self._log(case, "verify", f"Отчёт принят, пост запущен: {ans['repair_ok']}")
                case["downtime_min"] = self._downtime(case)
            else:
                # причина не устранена: пост стоит дальше, состояние узла не восстанавливается
                self._spend(spec["verify_min"])
                seen = ans["repair_miss"].get(case["repair_id"], "Неисправность проявилась снова.")
                case["stage"] = "repair"
                case["mistakes"] += 1
                case["feedback"] = dict(kind="error",
                                        text=f"Проверочный пуск не пройден. {seen} Пост остаётся в простое: выберите другое действие.")
                self._close_report(case, "failed")
                self._log(case, "verify", f"Отчёт принят, но проверочный пуск не пройден: {seen}")
            return self._view(case)

    def return_report(self):
        """Диспетчер вернул работу бригаде без пуска: время модели не тратится, ошибкой это не считается."""
        with self.engine.lock:
            case, _ = self._review()
            report = self._close_report(case, "returned")
            case["stage"] = "repair"
            case["feedback"] = dict(kind="warning", text="Отчёт возвращён бригаде. Выберите другое действие.")
            self._log(case, "verify", f"Отчёт возвращён бригаде без пуска: {report['action']}")
            return self._view(case)

    def verify(self):
        """Прежнее имя шага: проверочный пуск и есть принятие отчёта."""
        return self._launch()

    def advance(self):
        """Прежний маршрут без выбора: каждый вызов делает очередной шаг по верному пути."""
        with self.engine.lock:
            case = self.active
            if not case or case["stage"] == "done":
                raise ValueError("Нет активного ремонта")
            ans = ANSWERS[case["id"]]
            if case["stage"] == "diagnose":
                return self.diagnose(ans["diagnosis"])
            if case["stage"] == "repair":
                return self.repair(ans["repair"])
            return self.verify()
