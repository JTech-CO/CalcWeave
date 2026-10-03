/** Repository-owned bounded string/typed-leaf extension; formats and model text stay inert data. */
export const PYTHON_M15_EXTENSION = String.raw`

import struct

_m7_check, _m7_zero, _m7_kernel, _m7_decode_data = _check, _zero, _kernel, _decode_data
_M15_INTS = {"int8": (8, True), "uint8": (8, False), "int16": (16, True), "uint16": (16, False),
             "int32": (32, True), "uint32": (32, False), "int64": (64, True), "uint64": (64, False)}
_M15_SPACE = frozenset("\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")


def _m15_text(text, node_id):
    if not isinstance(text, str):
        _fail("M13_STRING_TYPE", node_id)
    if any(0xd800 <= ord(point) <= 0xdfff for point in text):
        _fail("M13_UNICODE", node_id)
    if sum(2 if ord(point) > 0xffff else 1 for point in text) > 256:
        _fail("M13_STRING_BUDGET", node_id)
    return text


def _m15_signal(dtype, value, shape=None, **metadata):
    return {"kind": "typed", "dtype": dtype, "shape": [] if shape is None else list(shape),
            "data": list(value) if shape else [value], **copy.deepcopy(metadata)}


def _m15_f32(value):
    try:
        return struct.unpack(">f", struct.pack(">f", value))[0]
    except OverflowError:
        return math.copysign(math.inf, value)


def _m15_encode(value):
    if math.isnan(value):
        return "NaN"
    if math.isinf(value):
        return "Infinity" if value > 0 else "-Infinity"
    return "-0" if value == 0 and math.copysign(1, value) < 0 else value


def _m15_float(value):
    if isinstance(value, str):
        return {"-0": -0.0, "NaN": math.nan, "Infinity": math.inf, "-Infinity": -math.inf}[value]
    return float(value)


def _m15_typed(value, node_id):
    if not isinstance(value, dict) or value.get("kind") != "typed":
        _fail("TYPED_VALUE_INVALID", node_id)
    dtype, shape, cells = value.get("dtype"), value.get("shape"), value.get("data")
    if not isinstance(shape, list) or not isinstance(cells, list) or any(type(axis) is not int or not 1 <= axis <= 1024 for axis in shape):
        _fail("TYPED_VALUE_INVALID", node_id)
    if len(shape) > 8 or math.prod(shape) != len(cells) or len(cells) > 1024:
        _fail("TYPED_RESOURCE_LIMIT", node_id)
    if dtype not in (*_M15_INTS, "fixed", "enum", "boolean", "string", "float32", "float64"):
        _fail("PYTHON_UNSUPPORTED_DTYPE", node_id)
    expected_keys = {"kind", "dtype", "shape", "data"} | ({"fixed"} if dtype == "fixed" else {"enum"} if dtype == "enum" else set())
    if set(value) != expected_keys:
        _fail("TYPED_VALUE_INVALID", node_id)
    if dtype == "fixed":
        spec = value.get("fixed")
        if not isinstance(spec, dict) or set(spec) != {"signed", "wordLength", "fractionLength"} or type(spec["signed"]) is not bool or type(spec["wordLength"]) is not int or not 1 <= spec["wordLength"] <= 64 or type(spec["fractionLength"]) is not int or not -64 <= spec["fractionLength"] <= 64:
            _fail("TYPED_VALUE_INVALID", node_id)
        width, signed = spec["wordLength"], spec["signed"]
    elif dtype in _M15_INTS:
        width, signed = _M15_INTS[dtype]
    if dtype == "enum":
        spec = value.get("enum")
        if not isinstance(spec, dict) or set(spec) != {"name", "labels"} or not isinstance(spec["name"], str) or not spec["name"] or len(spec["name"]) > 64 or not ("A" <= spec["name"][0] <= "Z" or "a" <= spec["name"][0] <= "z") or any(point not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-" for point in spec["name"]) or not isinstance(spec["labels"], list) or not 1 <= len(spec["labels"]) <= 64 or any(not isinstance(label, str) or not label or sum(2 if ord(point) > 0xffff else 1 for point in label) > 64 for label in spec["labels"]) or len(set(spec["labels"])) != len(spec["labels"]):
            _fail("TYPED_VALUE_INVALID", node_id)
    for cell in cells:
        if dtype in _M15_INTS or dtype == "fixed":
            if not isinstance(cell, str) or not cell or len(cell) > 21 or cell == "-0":
                _fail("TYPED_VALUE_INVALID", node_id)
            digits = cell[1:] if cell.startswith("-") else cell
            if not digits or any(point not in "0123456789" for point in digits) or len(digits) > 1 and digits[0] == "0":
                _fail("TYPED_VALUE_INVALID", node_id)
            integer = int(cell)
            if not (-(1 << (width - 1)) if signed else 0) <= integer <= ((1 << (width - 1)) - 1 if signed else (1 << width) - 1):
                _fail("TYPED_OVERFLOW", node_id)
        elif dtype in ("float64", "float32"):
            if isinstance(cell, str):
                if cell not in ("-0", "NaN", "Infinity", "-Infinity"):
                    _fail("TYPED_VALUE_INVALID", node_id)
            elif type(cell) not in (int, float) or not math.isfinite(cell) or cell == 0 and math.copysign(1, cell) < 0:
                _fail("TYPED_VALUE_INVALID", node_id)
            elif dtype == "float32" and _m15_f32(cell) != cell:
                _fail("TYPED_FLOAT32_REPRESENTATION", node_id)
        elif dtype == "boolean":
            if type(cell) is not bool:
                _fail("TYPED_VALUE_INVALID", node_id)
        elif not isinstance(cell, str) or sum(2 if ord(point) > 0xffff else 1 for point in cell) > 256:
            _fail("TYPED_VALUE_INVALID", node_id)
        elif dtype == "enum" and cell not in value["enum"]["labels"]:
            _fail("TYPED_ENUM_VALUE", node_id)
    return value


def _check(value, descriptor, node_id):
    if descriptor["valueType"] != "typed":
        return _m7_check(value, descriptor, node_id)
    _m15_typed(value, node_id)
    metadata = {key: value[key] for key in ("dtype", "fixed", "enum") if key in value}
    if metadata != descriptor["typed"]:
        _fail("RUNTIME_TYPE_MISMATCH", node_id)
    if value["shape"] != descriptor["shape"]:
        _fail("RUNTIME_SHAPE_MISMATCH", node_id)
    return value


def _zero(descriptor):
    if descriptor["valueType"] != "typed":
        return _m7_zero(descriptor)
    spec = copy.deepcopy(descriptor["typed"])
    dtype = spec.pop("dtype")
    initial = "0" if dtype in _M15_INTS or dtype == "fixed" else False if dtype == "boolean" else "" if dtype == "string" else spec["enum"]["labels"][0] if dtype == "enum" else 0
    return _m15_signal(dtype, [initial] * math.prod(descriptor["shape"]) if descriptor["shape"] else initial, descriptor["shape"], **spec)


def _m15_normalise(value):
    if isinstance(value, dict):
        if value.get("kind") == "typed":
            value["shape"] = [int(axis) for axis in value["shape"]]
        if "fixed" in value:
            for key in ("wordLength", "fractionLength"):
                value["fixed"][key] = int(value["fixed"][key])
        for child in value.values():
            _m15_normalise(child)
    elif isinstance(value, list):
        for child in value:
            _m15_normalise(child)


def _decode_data():
    data = _m7_decode_data()
    for node in data["nodes"]:
        _m15_normalise(node["parameters"])
        _m15_normalise(node["outputs"])
        for key in ("capacity", "count", "firstN"):
            if key in node["parameters"]:
                node["parameters"][key] = int(node["parameters"][key])
        for token in node["parameters"].get("formatTokens", []):
            if "precision" in token:
                token["precision"] = int(token["precision"])
    _m15_normalise(data["outputTypes"])
    return data


def _m15_read_text(value, node_id):
    value = _m15_typed(value, node_id)
    if value["dtype"] != "string" or value["shape"]:
        _fail("M13_STRING_TYPE", node_id)
    return _m15_text(value["data"][0], node_id)


def _m15_integer(value, node_id):
    if type(value) in (int, float) and math.isfinite(value) and value == int(value) and abs(value) <= 9007199254740991:
        return int(value)
    if isinstance(value, dict):
        value = _m15_typed(value, node_id)
        if value["dtype"] in _M15_INTS and not value["shape"]:
            return int(value["data"][0])
    _fail("M13_INTEGER_TYPE", node_id)


def _m15_scalar_float(value, node_id):
    if type(value) in (int, float) and math.isfinite(value):
        return float(value)
    if isinstance(value, dict):
        value = _m15_typed(value, node_id)
        if value["dtype"] in ("float32", "float64") and not value["shape"]:
            return _m15_float(value["data"][0])
    _fail("M13_FLOAT_TYPE", node_id)


def _m15_trim(text):
    first, last = 0, len(text)
    while first < last and text[first] in _M15_SPACE:
        first += 1
    while last > first and text[last - 1] in _M15_SPACE:
        last -= 1
    return text[first:last]


def _m15_number_end(text, integer=False):
    index = 1 if text[:1] in ("+", "-") else 0
    digits = 0
    while index < len(text) and text[index] in "0123456789":
        index, digits = index + 1, digits + 1
    if not integer and index < len(text) and text[index] == ".":
        index += 1
        while index < len(text) and text[index] in "0123456789":
            index, digits = index + 1, digits + 1
    if not digits:
        return 0
    if not integer and index < len(text) and text[index] in "eE":
        exponent = index + 1
        if exponent < len(text) and text[exponent] in "+-":
            exponent += 1
        start = exponent
        while exponent < len(text) and text[exponent] in "0123456789":
            exponent += 1
        if exponent != start:
            index = exponent
    return index


def _m15_parse_number(text, dtype, node_id, invalid="error", special="error"):
    literal = _m15_trim(text)
    decimal = bool(literal) and _m15_number_end(literal) == len(literal)
    tagged = literal in ("NaN", "Infinity", "+Infinity", "-Infinity")
    def error():
        if invalid == "zero":
            return _m15_signal(dtype, 0)
        _fail("M13_NUMBER_PARSE", node_id)
    if not decimal and not (tagged and special == "preserve"):
        return error()
    number = float(literal)
    if decimal and not math.isfinite(number) or special == "error" and not math.isfinite(number):
        return error()
    mantissa = literal.lower().split("e")[0]
    if decimal and number == 0 and any(point in "123456789" for point in mantissa):
        return error()
    if dtype == "float32":
        rounded = _m15_f32(number)
        if math.isfinite(number) and (not math.isfinite(rounded) or number != 0 and rounded == 0):
            return error()
        number = rounded
    return _m15_signal(dtype, _m15_encode(number))


def _m15_quantise(numerator, denominator, places):
    if places >= 0:
        numerator *= 10 ** places
    else:
        denominator *= 10 ** -places
    quotient, remainder = divmod(numerator, denominator)
    return quotient + (1 if 2 * remainder >= denominator else 0)


def _m15_format_float(number, kind, precision):
    if not math.isfinite(number):
        return _m15_encode(number)
    negative = math.copysign(1, number) < 0
    number = abs(number)
    numerator, denominator = number.as_integer_ratio()
    sign = "-" if negative else ""
    if kind == "f":
        if number >= 1e21:
            return sign + str(int(number)) + ("." + "0" * precision if precision else "")
        digits = str(_m15_quantise(numerator, denominator, precision)).zfill(precision + 1)
        return sign + (digits[:-precision] + "." + digits[-precision:] if precision else digits)
    exponent = 0
    if number:
        while numerator >= denominator * 10 ** (exponent + 1) if exponent >= -1 else numerator * 10 ** -(exponent + 1) >= denominator:
            exponent += 1
        while numerator < denominator * 10 ** exponent if exponent >= 0 else numerator * 10 ** -exponent < denominator:
            exponent -= 1
    significant = precision + 1 if kind == "e" else precision
    digits = str(_m15_quantise(numerator, denominator, significant - 1 - exponent)).zfill(significant)
    if len(digits) > significant:
        exponent += 1
        digits = digits[:-1]
    if kind == "e" or exponent < -4 or exponent >= significant:
        mantissa = digits[0] + ("." + digits[1:] if len(digits) > 1 else "")
        if kind == "g":
            mantissa = mantissa.rstrip("0").rstrip(".") if "." in mantissa else mantissa
        return sign + mantissa + "e" + ("+" if exponent >= 0 else "-") + str(abs(exponent)).zfill(2)
    point = exponent + 1
    expanded = "0." + "0" * -point + digits if point <= 0 else digits + "0" * (point - len(digits)) if point >= len(digits) else digits[:point] + "." + digits[point:]
    return sign + (expanded.rstrip("0").rstrip(".") if "." in expanded else expanded)


def _m15_compose(tokens, read, node_id):
    parts, index = [], 0
    for token in tokens:
        if "literal" in token:
            parts.append(token["literal"])
            continue
        index += 1
        value, kind = read(index), token["kind"]
        if kind == "s":
            text = _m15_read_text(value, node_id)
        elif kind in ("d", "u"):
            integer = _m15_integer(value, node_id)
            if kind == "u" and integer < 0:
                _fail("M13_FORMAT_TYPE", node_id)
            text = str(integer)
        else:
            text = _m15_format_float(_m15_scalar_float(value, node_id), kind, token.get("precision", 6))
        parts.append(text)
    return _m15_signal("string", _m15_text("".join(parts), node_id))


def _m15_to_string(value, node_id):
    if type(value) is bool:
        return "true" if value else "false"
    value = _m15_typed(value, node_id)
    dtype, cell = value["dtype"], value["data"][0]
    if value["shape"]:
        _fail("M13_SCALAR_TYPE", node_id)
    if dtype == "boolean":
        return "true" if cell else "false"
    if dtype in ("string", "enum") or dtype in _M15_INTS:
        return cell
    if dtype == "fixed":
        code, fraction = int(cell), value["fixed"]["fractionLength"]
        if fraction <= 0:
            return str(code << -fraction)
        digits = str(abs(code) * 5 ** fraction).zfill(fraction + 1)
        return (("-" if code < 0 else "") + digits[:-fraction] + "." + digits[-fraction:]).rstrip("0").rstrip(".")
    _fail("M13_SCALAR_TYPE", node_id)


def _m15_scan(tokens, text, node_id, invalid):
    cursor, output, result = 0, 0, {}
    try:
        for token in tokens:
            if "literal" in token:
                for point in token["literal"]:
                    if point in _M15_SPACE:
                        while cursor < len(text) and text[cursor] in _M15_SPACE:
                            cursor += 1
                    elif cursor >= len(text) or text[cursor] != point:
                        _fail("M13_SCAN_MATCH", node_id)
                    else:
                        cursor += 1
                continue
            kind = token["kind"]
            if kind != "c":
                while cursor < len(text) and text[cursor] in _M15_SPACE:
                    cursor += 1
            remaining = text[cursor:]
            if kind == "c":
                literal = remaining[:1]
            elif kind == "s":
                end = 0
                while end < len(remaining) and remaining[end] not in _M15_SPACE:
                    end += 1
                literal = remaining[:end]
            else:
                end = _m15_number_end(remaining, kind in ("d", "u"))
                literal = remaining[:end]
                if not literal and kind == "f":
                    literal = next((tag for tag in ("NaN", "+Infinity", "-Infinity", "Infinity") if remaining.startswith(tag)), "")
            if not literal:
                _fail("M13_SCAN_MATCH", node_id)
            cursor += len(literal)
            dtype = token["dtype"]
            if kind in ("s", "c"):
                value = _m15_signal("string", _m15_text(literal, node_id))
            elif kind in ("d", "u"):
                integer = int(literal)
                if not (-2147483648 if kind == "d" else 0) <= integer <= (2147483647 if kind == "d" else 4294967295):
                    _fail("M13_SCAN_RANGE", node_id)
                value = _m15_signal(dtype, str(integer))
            else:
                value = _m15_parse_number(literal, dtype, node_id, "error", "preserve")
            output += 1
            result["out" + str(output)] = value
        if _m15_trim(text[cursor:]):
            _fail("M13_SCAN_MATCH", node_id)
    except ModelError as error:
        if invalid != "zero" or any(item["code"] not in ("M13_SCAN_MATCH", "M13_SCAN_RANGE", "M13_NUMBER_PARSE") for item in error.diagnostics):
            raise
        fields = [token for token in tokens if "kind" in token]
        for index in range(output, len(fields)):
            dtype = fields[index]["dtype"]
            result["out" + str(index + 1)] = _m15_signal(dtype, "" if dtype == "string" else "0" if dtype in _M15_INTS else 0)
    return result


def _kernel(node, read, clock):
    kind, node_id, p = node["blockType"], node["id"], node["parameters"]
    if kind in ("source.typed", "source.enum", "source.signal"):
        return {"out": copy.deepcopy(p["value"])}
    if kind == "source.string-constant":
        return {"out": _m15_signal("string", _m15_text(p["value"], node_id))}
    if not kind.startswith("string."):
        return _m7_kernel(node, read, clock)
    text = lambda port="in": _m15_read_text(read(port), node_id)
    fold = lambda value: "".join(chr(ord(point) + 32) if "A" <= point <= "Z" else point for point in value) if p.get("caseSensitive") == "no" else value
    if kind == "string.ascii-to-string":
        source = _m15_typed(read("in"), node_id)
        if source["dtype"] != "uint8" or len(source["shape"]) != 1 or len(source["data"]) > 256:
            _fail("M13_ASCII_TYPE", node_id)
        codes = [int(code) for code in source["data"]]
        if any(code > 127 for code in codes):
            _fail("M13_ASCII_RANGE", node_id)
        end = codes.index(0) if 0 in codes else len(codes)
        value = _m15_signal("string", _m15_text("".join(chr(code) for code in codes[:end]), node_id))
    elif kind == "string.string-to-ascii":
        string, capacity = text(), p["capacity"]
        codes = [ord(point) for point in string]
        if any(code > 127 for code in codes):
            _fail("M13_ASCII_RANGE", node_id)
        if len(codes) > capacity:
            _fail("M13_ASCII_CAPACITY", node_id)
        return {"out": _m15_signal("uint8", [str(code) for code in codes] + ["0"] * (capacity - len(codes)), [capacity]), "length": _m15_signal("uint32", str(len(codes)))}
    elif kind == "string.string-length":
        value = _m15_signal("uint32", str(len(text())))
    elif kind in ("string.string-contains", "string.string-find", "string.string-count"):
        source, pattern = fold(text()), fold(text("pattern"))
        index = source.find(pattern)
        value = index >= 0 if kind == "string.string-contains" else _m15_signal("int32", str(index + 1 if index >= 0 else -1)) if kind == "string.string-find" else _m15_signal("uint32", str(source.count(pattern)))
    elif kind == "string.string-compare":
        first, second = fold(text("a")), fold(text("b"))
        value = first[:p["firstN"]] == second[:p["firstN"]] if p["firstN"] else first == second
    elif kind == "string.string-concatenate":
        value = _m15_signal("string", _m15_text("".join(text("in" + str(index)) for index in range(1, p["count"] + 1)), node_id))
    elif kind == "string.substring":
        first = _m15_integer(read("start"), node_id)
        length = None if p["toEnd"] == "yes" else _m15_integer(read("length"), node_id)
        if not 1 <= first <= 4294967295 or length is not None and not 0 <= length <= 4294967295:
            _fail("M13_STRING_INDEX", node_id)
        value = _m15_signal("string", _m15_text(text()[first - 1:] if length is None else text()[first - 1:first - 1 + length], node_id))
    elif kind == "string.parse-number":
        value = _m15_parse_number(text(), p["dtype"], node_id, p["invalid"], p["special"])
    elif kind == "string.parse-enum":
        literal = text()
        if literal not in p["type"]["enum"]["labels"]:
            _fail("M13_ENUM_PARSE", node_id)
        value = _m15_signal("enum", literal, enum=p["type"]["enum"])
    elif kind == "string.compose":
        value = _m15_compose(p["formatTokens"], lambda index: read("arg" + str(index)), node_id)
    elif kind == "string.scan":
        return _m15_scan(p["formatTokens"], text(), node_id, p["invalid"])
    elif kind == "string.to-string":
        source = read("in")
        value = _m15_compose(p["formatTokens"], lambda index: source, node_id) if type(source) in (int, float) or isinstance(source, dict) and source.get("dtype") in ("float32", "float64") else _m15_signal("string", _m15_text(_m15_to_string(source, node_id), node_id))
    else:
        _fail("RUNTIME_UNSUPPORTED_BLOCK", node_id)
    return {"out": copy.deepcopy(value)}
`;
