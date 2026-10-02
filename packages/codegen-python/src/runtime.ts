/** Fixed repository-owned Python runtime. No model text is interpolated into this template. */
export const PYTHON_RUNTIME = String.raw`
class ModelError(Exception):
    def __init__(self, diagnostics, partialResult=None):
        self.diagnostics = copy.deepcopy(diagnostics)
        self.partialResult = copy.deepcopy(partialResult)
        super().__init__(diagnostics[0]["message"] if diagnostics else "Invalid model")


def _fail(code, node_id=None, message="Model execution failed"):
    diagnostic = {"code": code, "message": message}
    if node_id is not None:
        diagnostic["nodeId"] = node_id
    raise ModelError([diagnostic])


def _finite(value, node_id):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        _fail("NUMERIC_NONFINITE", node_id, "계산 결과 또는 입력이 유한한 실수가 아닙니다.")
    try:
        result = float(value)
    except (OverflowError, ValueError):
        _fail("NUMERIC_NONFINITE", node_id, "계산 결과 또는 입력이 유한한 실수가 아닙니다.")
    if not math.isfinite(result):
        _fail("NUMERIC_NONFINITE", node_id, "계산 결과 또는 입력이 유한한 실수가 아닙니다.")
    return result


def _flat(value):
    if not isinstance(value, list):
        return [value]
    return [item for row in value for item in row] if value and isinstance(value[0], list) else list(value)


def _shaped(values, shape):
    if not shape:
        return values[0]
    if len(shape) == 1:
        return list(values)
    return [list(values[row * shape[1]:(row + 1) * shape[1]]) for row in range(shape[0])]


def _check(value, descriptor, node_id):
    shape = descriptor["shape"]
    if not shape:
        valid = not isinstance(value, list)
    elif len(shape) == 1:
        valid = isinstance(value, list) and len(value) == shape[0] and not any(isinstance(item, list) for item in value)
    else:
        valid = isinstance(value, list) and len(value) == shape[0] and all(isinstance(row, list) and len(row) == shape[1] and not any(isinstance(item, list) for item in row) for row in value)
    if not valid:
        _fail("RUNTIME_SHAPE_MISMATCH", node_id, "실행 출력의 차원이 검증한 포트와 다릅니다.")
    for element in _flat(value):
        if descriptor["valueType"] == "float64":
            _finite(element, node_id)
        elif not isinstance(element, bool):
            _fail("RUNTIME_TYPE_MISMATCH", node_id, "실행 출력의 자료형이 검증한 포트와 다릅니다.")
    return value


def _zero(descriptor):
    shape = descriptor["shape"]
    count = math.prod(shape) if shape else 1
    return _shaped([False if descriptor["valueType"] == "boolean" else 0 for _ in range(count)], shape)


def _round(value):
    # JavaScript Math.round: ties go toward positive infinity, including negatives.
    # Adding .5 first loses precision immediately below a half or at large integers.
    floor = math.floor(value)
    result = float(floor + (1 if value - floor >= 0.5 else 0))
    return math.copysign(0.0, value) if result == 0 else result


def _divide(a, b, node_id):
    if b == 0:
        _fail("NUMERIC_DIVIDE_BY_ZERO", node_id, "0으로 나눌 수 없습니다. 제수 입력을 확인해 주세요.")
    return _finite(a / b, node_id)


def _function(name, args, node_id):
    a = args[0]
    if (name == "sqrt" and a < 0) or (name in ("log", "log10") and a <= 0) or (name in ("asin", "acos") and not -1 <= a <= 1):
        _fail("NUMERIC_DOMAIN", node_id, "입력값이 함수의 실수 정의역을 벗어났습니다.")
    if name == "abs":
        result = abs(a)
    elif name == "square":
        result = a * a
    elif name == "reciprocal":
        result = _divide(1, a, node_id)
    elif name == "round":
        result = _round(a)
    elif name == "min":
        result = min(a, args[1])
    elif name == "max":
        result = max(a, args[1])
    else:
        # Fixed function allowlist; model names never access Python globals or attributes.
        functions = {"sqrt": math.sqrt, "sin": math.sin, "cos": math.cos, "tan": math.tan,
                     "asin": math.asin, "acos": math.acos, "atan": math.atan, "exp": math.exp,
                     "log": math.log, "log10": math.log10, "floor": math.floor, "ceil": math.ceil, "trunc": math.trunc}
        function = functions.get(name)
        if function is None:
            _fail("EXPRESSION_SYNTAX", node_id, "허용하지 않는 수식 함수입니다.")
        try:
            result = function(a)
        except OverflowError:
            _fail("NUMERIC_NONFINITE", node_id, "계산 결과 또는 입력이 유한한 실수가 아닙니다.")
        except ValueError:
            _fail("NUMERIC_DOMAIN", node_id, "입력값이 함수의 실수 정의역을 벗어났습니다.")
    result = _finite(result, node_id)
    if name in ("floor", "ceil", "trunc", "round") and result == 0:
        return math.copysign(0.0, a)
    return result


def _expression(ast, x, node_id):
    visited = 0

    def visit(node, depth=1):
        nonlocal visited
        visited += 1
        if visited > 128 or depth > 32:
            _fail("EXPRESSION_LIMIT", node_id, "수식 AST 상한을 초과했습니다.")
        kind = node["type"]
        if kind == "number":
            return _finite(node["value"], node_id)
        if kind == "variable":
            constants = {"x": x, "pi": math.pi, "e": math.e}
            if node["name"] not in constants:
                _fail("EXPRESSION_SYNTAX", node_id)
            return constants[node["name"]]
        if kind == "unary":
            return _finite((-1 if node["operator"] == "-" else 1) * visit(node["argument"], depth + 1), node_id)
        if kind == "binary":
            a, b = visit(node["left"], depth + 1), visit(node["right"], depth + 1)
            operator = node["operator"]
            if operator == "+":
                return _finite(a + b, node_id)
            if operator == "-":
                return _finite(a - b, node_id)
            if operator == "*":
                return _finite(a * b, node_id)
            if operator == "/":
                return _divide(a, b, node_id)
            if operator == "^":
                if a < 0 and not b.is_integer():
                    _fail("NUMERIC_DOMAIN", node_id, "음수의 비정수 거듭제곱은 실수 범위를 벗어납니다.")
                if a == 0 and b < 0:
                    _fail("NUMERIC_NONFINITE", node_id)
                try:
                    return _finite(math.pow(a, b), node_id)
                except OverflowError:
                    _fail("NUMERIC_NONFINITE", node_id)
                except ValueError:
                    _fail("NUMERIC_DOMAIN", node_id)
        if kind == "call":
            return _function(node["name"], [visit(arg, depth + 1) for arg in node["args"]], node_id)
        _fail("EXPRESSION_SYNTAX", node_id)

    return visit(ast)


def _interpolate(x, points, values, interpolation, outside, node_id):
    first, last = points[0], points[-1]
    if x < first or x > last:
        if outside == "error":
            _fail("LOOKUP_RANGE", node_id, "입력이 Lookup 표 범위를 벗어났습니다.")
        return values[0 if x < first else -1]
    low, high = 0, len(points) - 1
    while low + 1 < high:
        middle = (low + high) // 2
        if x < points[middle]:
            high = middle
        else:
            low = middle
    if x == points[high]:
        return values[high]
    if interpolation == "previous" or x == points[low]:
        return values[low]
    difference = points[high] - points[low]
    if math.isfinite(difference):
        ratio = (x - points[low]) / difference
    else:
        scale = max(abs(x), abs(points[low]), abs(points[high]))
        ratio = (x / scale - points[low] / scale) / (points[high] / scale - points[low] / scale)
    return _finite(values[low] * (1 - ratio) + values[high] * ratio, node_id)


def _dataset(node, clock):
    p, node_id = node["parameters"], node["id"]
    times, values = p["times"], p["values"]
    if clock < times[0] or clock > times[-1]:
        if p["outside"] == "error":
            _fail("DATASET_TIME_RANGE", node_id, "실행 시각이 데이터 시간 범위를 벗어났습니다.")
        if p["outside"] == "zero":
            return False if p["dataKind"] == "boolean" else 0
        return values[0 if clock < times[0] else -1]
    low, high = 0, len(times) - 1
    while low < high:
        middle = (low + high + 1) // 2
        if times[middle] <= clock:
            low = middle
        else:
            high = middle - 1
    if times[low] == clock or low == len(times) - 1 or p["interpolation"] == "previous":
        return values[low]
    ratio = (clock - times[low]) / (times[low + 1] - times[low])
    return _finite((1 - ratio) * values[low] + ratio * values[low + 1], node_id)


def _kernel(node, read, clock):
    kind, node_id, p = node["blockType"], node["id"], node["parameters"]
    descriptor = node["outputs"].get("out")
    shape = descriptor["shape"] if descriptor else []
    count = math.prod(shape) if shape else 1

    def unary(function):
        return _shaped([_finite(function(_finite(value, node_id)), node_id) for value in _flat(read("in"))], shape)

    def pair(function):
        a, b = _flat(read("a")), _flat(read("b"))
        results = [function(_finite(a[0 if len(a) == 1 else index], node_id), _finite(b[0 if len(b) == 1 else index], node_id)) for index in range(count)]
        return _shaped([value if isinstance(value, bool) else _finite(value, node_id) for value in results], shape)

    if kind in ("annotation.note", "annotation.model-info"):
        return {}
    if kind in ("source.constant", "io.input"):
        value = p["value"]
    elif kind == "source.dataset":
        value = _dataset(node, clock)
    elif kind == "unit.convert":
        value = unary(lambda x: x * p["unitScale"] + p["unitOffset"])
    elif kind == "route.bus-create":
        value = [read("a"), read("b")]
    elif kind == "route.bus-select":
        value = read("in")[p["fieldIndex"]]
    elif kind == "math.gain":
        value = unary(lambda x: x * p["gain"])
    elif kind == "math.sum":
        value = pair(lambda a, b: (-a if p["signs"][0] == "-" else a) + (-b if p["signs"][1] == "-" else b))
    elif kind == "math.multiply":
        value = pair(lambda a, b: _divide(a, b, node_id) if p["operation"] == "divide" else a * b)
    elif kind in ("math.abs", "math.sqrt", "math.function", "math.trigonometric", "math.round"):
        operation = {"math.abs": "abs", "math.sqrt": "sqrt"}.get(kind, p.get("operation"))
        value = unary(lambda x: _function(operation, [x], node_id))
    elif kind == "math.minmax":
        function = max if p["operation"] == "max" else min
        value = function([_finite(item, node_id) for item in _flat(read("in"))]) if p["strategy"] == "reduce" else pair(function)
    elif kind == "logic.compare":
        functions = {"eq": lambda a, b: a == b, "ne": lambda a, b: a != b, "lt": lambda a, b: a < b,
                     "le": lambda a, b: a <= b, "gt": lambda a, b: a > b, "ge": lambda a, b: a >= b}
        value = pair(functions[p["operation"]])
    elif kind == "logic.boolean":
        a = _flat(read("a"))
        b = [] if p["operation"] == "not" else _flat(read("b"))
        results = []
        for index in range(count):
            first = a[0 if len(a) == 1 else index]
            second = b[0 if len(b) == 1 else index] if b else None
            if not isinstance(first, bool) or (p["operation"] != "not" and not isinstance(second, bool)):
                _fail("RUNTIME_TYPE_MISMATCH", node_id)
            functions = {"not": lambda: not first, "and": lambda: first and second,
                         "or": lambda: first or second, "xor": lambda: first != second}
            results.append(functions[p["operation"]]())
        value = _shaped(results, shape)
    elif kind == "route.switch":
        condition = read("condition")
        if not isinstance(condition, bool):
            _fail("RUNTIME_TYPE_MISMATCH", node_id)
        value = read("a" if condition else "b")
    elif kind == "nonlinear.saturation":
        value = unary(lambda x: min(p["upper"], max(p["lower"], x)))
    elif kind in ("route.mux", "math.concatenate"):
        value = _flat(read("a")) + _flat(read("b"))
    elif kind == "route.demux":
        values = _flat(read("in"))
        return {port: values[int(port[3:]) - 1] for port in node["outputs"]}
    elif kind == "matrix.reshape":
        value = _shaped(_flat(read("in")), shape)
    elif kind in ("sink.display", "sink.scope", "io.output", "io.terminator"):
        value = read("in")
    elif kind == "lookup.interpolated":
        value = unary(lambda x: _interpolate(x, p["breakpoints"], p["values"], p["interpolation"], p["extrapolation"], node_id))
    elif kind == "math.expression":
        value = unary(lambda x: _expression(node["expression"], x, node_id))
    elif kind == "logic.bitwise":
        mask = (1 << p["width"]) - 1

        def unsigned(port):
            number = _finite(read(port), node_id)
            if not number.is_integer() or number < 0 or number > mask:
                _fail("NUMERIC_INTEGER_RANGE", node_id, "비트 입력은 unsigned 정수여야 합니다.")
            return int(number)

        a, operation = unsigned("a"), p["operation"]
        if operation == "and":
            bits = a & unsigned("b")
        elif operation == "or":
            bits = a | unsigned("b")
        elif operation == "xor":
            bits = a ^ unsigned("b")
        elif operation == "not":
            bits = ~a
        elif operation == "shift-left":
            bits = a << p["shift"]
        else:
            bits = a >> p["shift"]
        value = bits & mask
    else:
        _fail("RUNTIME_UNSUPPORTED_BLOCK", node_id)
    return {"out": copy.deepcopy(value)}


_DISCRETE = frozenset(("source.step", "source.ramp", "source.sine-wave", "source.pulse", "source.clock", "source.digital-clock",
                       "source.random", "source.repeating-sequence", "discrete.unit-delay", "discrete.delay", "discrete.integrator",
                       "discrete.difference", "discrete.derivative", "discrete.fir", "discrete.transfer-function", "discrete.state-space",
                       "logic.edge-detect", "time.rate-transition", "source.dataset"))


def _due(node, tick):
    rate = node["sampleTime"]
    return tick >= rate["offset"] and (tick - rate["offset"]) % rate["period"] == 0


def _independent(node):
    kind, p = node["blockType"], node["parameters"]
    if kind in ("discrete.unit-delay", "discrete.delay", "discrete.integrator", "time.rate-transition"):
        return True
    if kind == "discrete.fir":
        return p["coefficients"][0] == 0
    if kind == "discrete.transfer-function":
        return p["numerator"][0] == 0
    return kind == "discrete.state-space" and p["D"] == 0


def _initial(node):
    kind, p = node["blockType"], node["parameters"]
    initial = p.get("initial")
    if kind in ("discrete.unit-delay", "discrete.integrator", "discrete.difference", "discrete.derivative", "logic.edge-detect"):
        return {"value": copy.deepcopy(initial)}
    if kind in ("discrete.delay", "discrete.fir"):
        length = p["steps"] if kind == "discrete.delay" else len(p["coefficients"]) - 1
        return {"history": [copy.deepcopy(initial) for _ in range(length)]}
    if kind == "discrete.transfer-function":
        return {"u": [initial] * (len(p["numerator"]) - 1), "y": [initial] * (len(p["denominator"]) - 1)}
    if kind == "discrete.state-space":
        return {"x": list(initial)}
    if kind == "time.rate-transition":
        return {"buffer": copy.deepcopy(initial)}
    if kind == "source.random":
        return {"seed": p["seed"]}
    return {}


def _dot(coefficients, values, node_id):
    result = 0.0
    for index, coefficient in enumerate(coefficients):
        result = _finite(result + coefficient * values[index], node_id)
    return result


def _fir(node, memory, current):
    p, node_id = node["parameters"], node["id"]
    histories = [_flat(signal) for signal in memory["history"]]
    current = _flat(current) if current is not None else None
    results = []
    for index, _ in enumerate(_flat(p["initial"])):
        result = 0.0 if p["coefficients"][0] == 0 or current is None else p["coefficients"][0] * _finite(current[index], node_id)
        for lag in range(1, len(p["coefficients"])):
            result = _finite(result + p["coefficients"][lag] * histories[lag - 1][index], node_id)
        results.append(_finite(result, node_id))
    return _shaped(results, node["outputs"]["out"]["shape"])


def _transfer(node, memory, current):
    p, node_id = node["parameters"], node["id"]
    result = 0.0 if p["numerator"][0] == 0 or current is None else p["numerator"][0] * _finite(current, node_id)
    for index in range(1, len(p["numerator"])):
        result = _finite(result + p["numerator"][index] * memory["u"][index - 1], node_id)
    for index in range(1, len(p["denominator"])):
        result = _finite(result - p["denominator"][index] * memory["y"][index - 1], node_id)
    return _finite(result / p["denominator"][0], node_id)


def _discrete_output(node, memory, read, tick, clock, step):
    kind, p, node_id = node["blockType"], node["parameters"], node["id"]
    if kind == "source.dataset":
        return _dataset(node, clock)
    if kind == "source.step":
        return p["before"] if clock < p["stepTime"] else p["after"]
    if kind == "source.ramp":
        return _finite(p["initial"] + p["slope"] * max(0, clock - p["startTime"]), node_id)
    if kind == "source.sine-wave":
        angle = _finite(2 * math.pi * p["frequency"] * clock + p["phase"], node_id)
        return _finite(p["amplitude"] * math.sin(angle) + p["bias"], node_id)
    if kind == "source.pulse":
        return p["amplitude"] if tick >= p["phase"] and (tick - p["phase"]) % p["period"] < p["width"] else 0
    if kind in ("source.clock", "source.digital-clock"):
        return clock
    if kind == "source.repeating-sequence":
        # Python's positive modulo agrees with the JS remainder plus negative adjustment.
        phase = clock % p["times"][-1]
        return _interpolate(phase, p["times"], p["values"], p["interpolation"], "clip", node_id)
    if kind == "source.random":
        def uniform():
            memory["seed"] = (1664525 * memory["seed"] + 1013904223) & 0xffffffff
            return (memory["seed"] + 0.5) / 4294967296
        if p["distribution"] == "normal":
            first, second = uniform(), uniform()
            return _finite(p["mean"] + math.sqrt(p["variance"]) * math.sqrt(-2 * math.log(first)) * math.cos(2 * math.pi * second), node_id)
        ratio = uniform()
        return _finite(p["min"] * (1 - ratio) + p["max"] * ratio, node_id)
    if kind in ("discrete.unit-delay", "discrete.integrator"):
        return memory["value"]
    if kind == "discrete.delay":
        return memory["history"][0]
    if kind in ("discrete.difference", "discrete.derivative"):
        previous, current = _flat(memory["value"]), _flat(read("in"))
        divisor = node["sampleTime"]["period"] * step if kind == "discrete.derivative" else 1
        return _shaped([_finite((_finite(item, node_id) - _finite(previous[index], node_id)) / divisor, node_id) for index, item in enumerate(current)], node["outputs"]["out"]["shape"])
    if kind == "discrete.fir":
        return _fir(node, memory, None if _independent(node) else read("in"))
    if kind == "discrete.transfer-function":
        return _transfer(node, memory, None if _independent(node) else read("in"))
    if kind == "discrete.state-space":
        direct = 0 if p["D"] == 0 else p["D"] * _finite(read("in"), node_id)
        return _finite(_dot(p["C"], memory["x"], node_id) + direct, node_id)
    if kind == "logic.edge-detect":
        previous, current = memory["value"], read("in")
        if not isinstance(previous, bool) or not isinstance(current, bool):
            _fail("RUNTIME_TYPE_MISMATCH", node_id)
        return {"rising": current and not previous, "falling": not current and previous, "either": current != previous}[p["mode"]]
    if kind == "time.rate-transition":
        return memory["buffer"]
    _fail("RUNTIME_UNSUPPORTED_BLOCK", node_id)


class _Machine:
    def __init__(self, data, charge):
        self.nodes = data["nodes"]
        self.states = data["states"]
        self.by_id = {node["id"]: node for node in self.nodes}
        self.step = data["settings"]["step"]
        self.charge = charge
        self.memory = {}
        self.held = {}
        self.extended = any(node["blockType"] in _DISCRETE and (node["blockType"] != "discrete.unit-delay" or isinstance(node["parameters"].get("initial"), (list, bool)) or node["parameters"].get("reset") == "level" or node["sampleTime"] != {"period": 1, "offset": 0}) for node in self.nodes)
        for node in self.nodes:
            node_id, kind, p = node["id"], node["blockType"], node["parameters"]
            outputs = {port: _zero(descriptor) for port, descriptor in node["outputs"].items()}
            memory = _initial(node)
            if memory:
                self.memory[node_id] = memory
            if kind in ("source.constant", "io.input"):
                outputs["out"] = copy.deepcopy(p["value"])
            if kind == "source.digital-clock":
                outputs["out"] = data["settings"]["startTime"]
            if kind in ("discrete.unit-delay", "discrete.integrator"):
                outputs["out"] = copy.deepcopy(memory["value"])
            if kind == "discrete.delay":
                outputs["out"] = copy.deepcopy(memory["history"][0])
            if kind == "time.rate-transition":
                outputs["out"] = copy.deepcopy(memory["buffer"])
            if kind == "discrete.state-space":
                outputs["out"] = _dot(p["C"], memory["x"], node_id)
            if kind == "discrete.fir":
                outputs["out"] = _fir(node, memory, None)
            if kind == "discrete.transfer-function":
                outputs["out"] = _transfer(node, memory, None)
            self.held[node_id] = outputs

    def read(self, values, node, port):
        endpoint = node["inputs"].get(port)
        if endpoint is None or endpoint["nodeId"] not in values or endpoint["portId"] not in values[endpoint["nodeId"]]:
            _fail("RUNTIME_INVALID_IR", node["id"], "연결된 입력 값을 읽을 수 없습니다.")
        return values[endpoint["nodeId"]][endpoint["portId"]]

    def evaluate(self, tick, clock):
        values = dict(self.held)

        def emit(node, outputs):
            for port, descriptor in node["outputs"].items():
                _check(outputs.get(port), descriptor, node["id"])
            self.held[node["id"]] = copy.deepcopy(outputs)
            values[node["id"]] = outputs

        # Publish all non-feedthrough states before their combinational consumers.
        for node in self.nodes:
            if _due(node, tick) and _independent(node):
                self.charge(node)
                emit(node, {"out": _discrete_output(node, self.memory[node["id"]], lambda port: _fail("RUNTIME_INVALID_IR", node["id"]), tick, clock, self.step)})
        for node in self.nodes:
            if not _due(node, tick) or _independent(node):
                continue
            self.charge(node)
            read = lambda port: self.read(values, node, port)
            outputs = {"out": _discrete_output(node, self.memory.get(node["id"], {}), read, tick, clock, self.step)} if node["blockType"] in _DISCRETE else _kernel(node, read, clock)
            emit(node, outputs)
        return values

    def transition(self, values, tick):
        next_memory = {}
        for node in self.nodes:
            node_id, kind, p = node["id"], node["blockType"], node["parameters"]
            memory = self.memory.get(node_id)
            if memory is None or kind == "source.random":
                continue
            if kind == "time.rate-transition":
                producer = self.by_id[node["inputs"]["in"]["nodeId"]]
                if _due(producer, tick):
                    self.charge(node)
                    next_memory[node_id] = {"buffer": copy.deepcopy(self.read(values, node, "in"))}
                continue
            if not _due(node, tick):
                continue
            self.charge(node)
            if p.get("reset") == "level":
                reset = self.read(values, node, "reset")
                if not isinstance(reset, bool):
                    _fail("RUNTIME_TYPE_MISMATCH", node_id)
                if reset:
                    next_memory[node_id] = _initial(node)
                    continue
            current = self.read(values, node, "in")
            if kind in ("discrete.unit-delay", "discrete.difference", "discrete.derivative", "logic.edge-detect"):
                next_memory[node_id] = {"value": copy.deepcopy(current)}
            elif kind == "discrete.delay":
                next_memory[node_id] = {"history": copy.deepcopy(memory["history"][1:] + [current])}
            elif kind == "discrete.integrator":
                input_values, scale = _flat(current), p["gain"] * node["sampleTime"]["period"] * self.step
                value = _shaped([_finite(_finite(item, node_id) + scale * _finite(input_values[index], node_id), node_id) for index, item in enumerate(_flat(memory["value"]))], node["outputs"]["out"]["shape"])
                _check(value, node["outputs"]["out"], node_id)
                next_memory[node_id] = {"value": value}
            elif kind == "discrete.fir":
                next_memory[node_id] = {"history": copy.deepcopy([current] + memory["history"][:-1]) if memory["history"] else []}
            elif kind == "discrete.transfer-function":
                next_memory[node_id] = {"u": [_finite(current, node_id)] + memory["u"][:-1] if memory["u"] else [],
                                        "y": [_finite(values[node_id]["out"], node_id)] + memory["y"][:-1] if memory["y"] else []}
            elif kind == "discrete.state-space":
                scalar = _finite(current, node_id)
                next_memory[node_id] = {"x": [_finite(_dot(row, memory["x"], node_id) + p["B"][index] * scalar, node_id) for index, row in enumerate(p["A"])]}
        # Every update reads the old snapshot; commit only once all nodes succeed.
        self.memory.update(next_memory)

    def final_state(self):
        return {node_id: copy.deepcopy(self.held[node_id]["out"]) for node_id in self.states}


def get_manifest():
    """Return an independent copy of the source/IR integrity and execution contract."""
    return json.loads(_MANIFEST_TEXT)


def _decode_data():
    # Python normally gives JSON integers arbitrary precision. All mathematical
    # values must enter the same binary64 domain as the browser, before products
    # or sums. Restore only compiler-owned structural indices/counts to integers.
    data = json.loads(_DATA_TEXT, parse_int=float)
    for node in data["nodes"]:
        node["sampleTime"] = {key: int(value) for key, value in node["sampleTime"].items()}
        node["cost"] = int(node["cost"])
        for descriptor in node["outputs"].values():
            descriptor["shape"] = [int(length) for length in descriptor["shape"]]
        p, kind = node["parameters"], node["blockType"]
        keys = {"source.random": ("seed",), "discrete.delay": ("steps",),
                "logic.bitwise": ("width", "shift"), "route.bus-select": ("fieldIndex",)}.get(kind, ())
        for key in keys:
            p[key] = int(p[key])
    for descriptor in data["outputTypes"].values():
        descriptor["shape"] = [int(length) for length in descriptor["shape"]]
    data["recordedElements"] = int(data["recordedElements"])
    data["stateElements"] = int(data["stateElements"])
    return data


def run():
    """Execute a fresh validated static/fixed-tick snapshot; no global state is reused."""
    manifest = get_manifest()
    if hashlib.sha256(_DATA_TEXT).hexdigest() != manifest["artifactDataHash"]:
        _fail("EXPORT_DATA_HASH_MISMATCH", message="The embedded IR hash does not match the manifest.")
    data = _decode_data()
    settings, nodes, outputs = data["settings"], data["nodes"], data["outputs"]
    if settings["mode"] not in ("static", "discrete"):
        _fail("PYTHON_UNSUPPORTED_MODE")
    intervals = 0 if settings["mode"] == "static" else int(_round((settings["stopTime"] - settings["startTime"]) / settings["step"]))
    if intervals < 0 or intervals > 10000:
        _fail("RUNTIME_STEP_BUDGET", message="실행 tick 수가 한도를 초과했습니다.")
    if (intervals + 1) * data["recordedElements"] > 1000000:
        _fail("RUNTIME_RECORD_BUDGET", message="결과 기록 한도를 초과했습니다.")
    if settings["mode"] == "discrete" and data["stateElements"] > 100000:
        _fail("RUNTIME_STATE_BUDGET", message="상태와 hold 메모리 한도를 초과했습니다.")
    costs = sum(node["cost"] for node in nodes)
    state_cost = sum(node["cost"] for node in nodes if node["id"] in data["states"]) * intervals if settings["mode"] == "discrete" else 0
    if (intervals + 1) * costs + state_cost > 50000000:
        _fail("RUNTIME_OPERATION_BUDGET", message="계산 연산 한도를 초과했습니다.")
    started, operations = time.monotonic(), 0

    def check_budget():
        if time.monotonic() - started > 30:
            _fail("RUNTIME_WALL_BUDGET", message="실행 시간 한도를 초과했습니다.")
        if operations > 50000000:
            _fail("RUNTIME_OPERATION_BUDGET", message="계산 연산 한도를 초과했습니다.")

    def charge(node):
        nonlocal operations
        operations += node["cost"]
        if operations > 50000000:
            _fail("RUNTIME_OPERATION_BUDGET", node["id"])
        check_budget()

    def at_tick(tick, operation):
        try:
            return operation()
        except ModelError as error:
            diagnostics = [dict(diagnostic, tick=tick, time=settings["startTime"] + tick * settings["step"]) for diagnostic in error.diagnostics]
            raise ModelError(diagnostics) from None

    machine = at_tick(0, lambda: _Machine(data, charge)) if settings["mode"] == "discrete" else None
    samples, previous, checkpoint = [], None, None

    def snapshot(status):
        result = {"samples": copy.deepcopy(samples), "finalState": machine.final_state() if machine else {}, "status": status, "steps": len(samples)}
        if machine and machine.extended:
            result["stateMemory"] = copy.deepcopy(machine.memory)
        return result

    try:
        for tick in range(intervals + 1):
            check_budget()
            if machine:
                checkpoint = (copy.deepcopy(machine.held), copy.deepcopy(machine.memory))
                if previous is not None:
                    at_tick(tick - 1, lambda: machine.transition(previous, tick - 1))
            clock = settings["startTime"] + tick * settings["step"]
            if machine:
                values = at_tick(tick, lambda: machine.evaluate(tick, clock))
            else:
                values = {}
                for node in nodes:
                    charge(node)

                    def read(port):
                        endpoint = node["inputs"].get(port)
                        if endpoint is None or endpoint["nodeId"] not in values or endpoint["portId"] not in values[endpoint["nodeId"]]:
                            _fail("RUNTIME_INVALID_IR", node["id"])
                        return values[endpoint["nodeId"]][endpoint["portId"]]

                    emitted = _kernel(node, read, clock)
                    for port, descriptor in node["outputs"].items():
                        _check(emitted.get(port), descriptor, node["id"])
                    values[node["id"]] = emitted
            samples.append({"time": clock, "values": {node_id: copy.deepcopy(_check(values[node_id]["out"], data["outputTypes"][node_id], node_id)) for node_id in outputs}})
            checkpoint, previous = None, values
        check_budget()
    except ModelError as error:
        if checkpoint is not None:
            machine.held, machine.memory = checkpoint
        raise ModelError(error.diagnostics, snapshot("failed")) from None
    # No state transition occurs after the terminal observation.
    return snapshot("completed")


if __name__ == "__main__":
    try:
        print(json.dumps({"manifest": get_manifest(), "result": run()}, ensure_ascii=True, allow_nan=False, separators=(",", ":")))
    except ModelError as error:
        failure = {"name": "ModelError", "diagnostics": error.diagnostics}
        if error.partialResult is not None:
            failure["partialResult"] = error.partialResult
        print(json.dumps({"manifest": get_manifest(), "error": failure}, ensure_ascii=True, allow_nan=False, separators=(",", ":")))
        sys.exit(1)
`;
