# CalcWeave 현행 지원 매트릭스

엔진 0.17.0-m16 · 운영자 JTech-Co · [기계 판독 JSON](support-matrix.json). 이 문서는 생성기로 결정적으로 작성한다.

원본 R2024b 385행(339개 이름)의 결정·근거·미확정 이유를 전수 추적한다. 선택 subset 367행과 미지원 18행을 분리한다. 공식 원본의 전체 옵션 inventory는 385행 모두 미검증이며 전체 동등성 승인 행은 0개다.

계산 registry 337개, UI model-widget 5개, 미지원 목적 canonical 10개(18행)은 서로 다른 계약이다. 로컬 parameter default/enum/bounds는 선언 schema이며 해당 값 또는 모든 조합의 수치 QA 완료를 뜻하지 않는다.

Python 69개와 WASM 16개의 versioned allowlist는 실제 모델의 dtype·mode·parameter·샘플링·resource 진단을 통과해야 하는 후보 목록이다. TypeScript typed15 wire를 모든 consumer가 지원한다고 해석하지 않는다. C/C++ native 실행 generator는 환경 미지원이다.

[공식 Block Support Table](https://www.mathworks.com/help/simulink/slref/blocksupporttable.html)은 dtype 조회 UI이며 코드 생성 지원을 대신 확인하지 않는다. [Dashboard Display](https://www.mathworks.com/help/simulink/slref/dashboarddisplay.html)의 연결형 UI와 [Sinks Display](https://www.mathworks.com/help/simulink/slref/display.html)의 신호 포트 목적을 원본 ID로 구분한다. 현재 웹 문서의 개념 확인은 R2024b 전수 옵션 inventory 승인 근거가 아니다.

| 원본 ID | 블럭명 | 결정 | 분류 | 구현 계약 | 옵션 inventory |
| --- | --- | --- | --- | --- | --- |
| 01-001 | Bus Creator | selected-subset | native-capability | route.structured-bus | unverified |
| 01-002 | Bus Selector | selected-subset | native-capability | route.structured-select | unverified |
| 01-003 | Constant | selected-subset | native-capability | source.constant | unverified |
| 01-004 | Data Type Conversion | selected-subset | native-capability | signal.cast | unverified |
| 01-005 | Delay | selected-subset | native-capability | discrete.delay | unverified |
| 01-006 | Demux | selected-subset | native-capability | route.demux | unverified |
| 01-007 | Discrete-Time Integrator | selected-subset | native-capability | discrete.integrator | unverified |
| 01-008 | Gain | selected-subset | native-capability | math.gain | unverified |
| 01-009 | Ground | selected-subset | preset | source.constant | unverified |
| 01-010 | Inport | selected-subset | native-capability | io.structured-input | unverified |
| 01-011 | Integrator | selected-subset | native-capability | continuous.integrator | unverified |
| 01-012 | Logical Operator | selected-subset | native-capability | logic.boolean | unverified |
| 01-013 | Mux | selected-subset | native-capability | route.mux | unverified |
| 01-014 | Outport | selected-subset | native-capability | io.structured-output | unverified |
| 01-015 | Product | selected-subset | native-capability | math.multiply | unverified |
| 01-016 | Relational Operator | selected-subset | native-capability | logic.compare | unverified |
| 01-017 | Saturation | selected-subset | native-capability | nonlinear.saturation | unverified |
| 01-018 | Scope | selected-subset | native-capability | sink.scope | unverified |
| 01-019 | Subsystem | selected-subset | native-capability | hierarchy.subsystem | unverified |
| 01-020 | Sum | selected-subset | native-capability | math.sum | unverified |
| 01-021 | Switch | selected-subset | native-capability | route.switch | unverified |
| 01-022 | Terminator | selected-subset | native-capability | io.terminator | unverified |
| 01-023 | Vector Concatenate | selected-subset | shared-configuration | math.concatenate | unverified |
| 02-001 | Derivative | selected-subset | native-capability | continuous.derivative | unverified |
| 02-002 | Descriptor State-Space | selected-subset | shared-configuration | continuous.descriptor | unverified |
| 02-003 | First Order Hold | selected-subset | native-capability | time.first-order-hold | unverified |
| 02-004 | Integrator | selected-subset | native-capability | continuous.integrator | unverified |
| 02-005 | Integrator Limited | selected-subset | shared-configuration | continuous.integrator-limited | unverified |
| 02-006 | PID Controller | selected-subset | native-capability | continuous.pid | unverified |
| 02-007 | PID Controller (2DOF) | selected-subset | shared-configuration | continuous.pid-2dof | unverified |
| 02-008 | Second-Order Integrator | selected-subset | native-capability | continuous.second-order-integrator | unverified |
| 02-009 | Second-Order Integrator Limited | selected-subset | shared-configuration | continuous.second-order-limited | unverified |
| 02-010 | State-Space | selected-subset | native-capability | continuous.state-space | unverified |
| 02-011 | Transfer Fcn | selected-subset | shared-configuration | continuous.transfer-function | unverified |
| 02-012 | Transport Delay | selected-subset | native-capability | time.transport-delay | unverified |
| 02-013 | Variable Time Delay | selected-subset | native-capability | time.variable-delay | unverified |
| 02-014 | Variable Transport Delay | selected-subset | native-capability | time.variable-transport-delay | unverified |
| 02-015 | Zero-Pole | selected-subset | shared-configuration | continuous.zero-pole | unverified |
| 02-016 | Entity Transport Delay | selected-subset | independent-alternative | adapter.entity-transport | unverified |
| 03-001 | Callback Button | selected-subset | independent-alternative | dashboard.action | unverified |
| 03-002 | Check Box | selected-subset | independent-alternative | dashboard.control | unverified |
| 03-003 | Combo Box | selected-subset | independent-alternative | dashboard.control | unverified |
| 03-004 | Dashboard Scope | selected-subset | native-capability | dashboard.scope | unverified |
| 03-005 | Display | selected-subset | native-capability | dashboard.readout | unverified |
| 03-006 | Edit | selected-subset | independent-alternative | dashboard.control | unverified |
| 03-007 | Gauge | selected-subset | shared-configuration | dashboard.gauge | unverified |
| 03-008 | Half Gauge | selected-subset | independent-alternative | dashboard.indicator | unverified |
| 03-009 | Knob | selected-subset | independent-alternative | dashboard.control | unverified |
| 03-010 | Lamp | selected-subset | independent-alternative | dashboard.indicator | unverified |
| 03-011 | Linear Gauge | selected-subset | independent-alternative | dashboard.indicator | unverified |
| 03-012 | MultiStateImage | selected-subset | independent-alternative | dashboard.indicator | unverified |
| 03-013 | Push Button | selected-subset | independent-alternative | dashboard.control | unverified |
| 03-014 | Quarter Gauge | selected-subset | independent-alternative | dashboard.indicator | unverified |
| 03-015 | Radio Button | selected-subset | independent-alternative | dashboard.control | unverified |
| 03-016 | Rocker Switch | selected-subset | independent-alternative | dashboard.control | unverified |
| 03-017 | Rotary Switch | selected-subset | independent-alternative | dashboard.control | unverified |
| 03-018 | Slider | selected-subset | shared-configuration | dashboard.slider | unverified |
| 03-019 | Slider Switch | selected-subset | independent-alternative | dashboard.control | unverified |
| 03-020 | Toggle Switch | selected-subset | native-capability | dashboard.toggle-switch | unverified |
| 03-021 | Callback Button | selected-subset | independent-alternative | dashboard.action | unverified |
| 03-022 | Check Box | selected-subset | independent-alternative | dashboard.control | unverified |
| 03-023 | Circular Gauge | selected-subset | independent-alternative | dashboard.indicator | unverified |
| 03-024 | Display | selected-subset | independent-alternative | dashboard.indicator | unverified |
| 03-025 | Half Gauge | selected-subset | independent-alternative | dashboard.indicator | unverified |
| 03-026 | Horizontal Gauge | selected-subset | independent-alternative | dashboard.indicator | unverified |
| 03-027 | Horizontal Slider | selected-subset | independent-alternative | dashboard.control | unverified |
| 03-028 | Knob | selected-subset | independent-alternative | dashboard.control | unverified |
| 03-029 | Lamp | selected-subset | independent-alternative | dashboard.indicator | unverified |
| 03-030 | Push Button | selected-subset | independent-alternative | dashboard.control | unverified |
| 03-031 | Quarter Gauge | selected-subset | independent-alternative | dashboard.indicator | unverified |
| 03-032 | Rocker Switch | selected-subset | independent-alternative | dashboard.control | unverified |
| 03-033 | Rotary Switch | selected-subset | independent-alternative | dashboard.control | unverified |
| 03-034 | Slider Switch | selected-subset | independent-alternative | dashboard.control | unverified |
| 03-035 | Toggle Switch | selected-subset | independent-alternative | dashboard.control | unverified |
| 03-036 | Vertical Gauge | selected-subset | independent-alternative | dashboard.indicator | unverified |
| 03-037 | Vertical Slider | selected-subset | independent-alternative | dashboard.control | unverified |
| 04-001 | Backlash | selected-subset | native-capability | nonlinear.backlash | unverified |
| 04-002 | Coulomb and Viscous Friction | selected-subset | native-capability | nonlinear.friction | unverified |
| 04-003 | Dead Zone | selected-subset | native-capability | nonlinear.dead-zone | unverified |
| 04-004 | Dead Zone Dynamic | selected-subset | shared-configuration | nonlinear.dead-zone-dynamic | unverified |
| 04-005 | Hit Crossing | selected-subset | native-capability | logic.hit-crossing | unverified |
| 04-006 | PWM | selected-subset | native-capability | source.pwm | unverified |
| 04-007 | Quantizer | selected-subset | native-capability | nonlinear.quantizer | unverified |
| 04-008 | Rate Limiter | selected-subset | native-capability | nonlinear.rate-limiter-continuous | unverified |
| 04-009 | Rate Limiter Dynamic | selected-subset | shared-configuration | nonlinear.rate-limiter-dynamic | unverified |
| 04-010 | Relay | selected-subset | native-capability | nonlinear.relay | unverified |
| 04-011 | Saturation | selected-subset | native-capability | nonlinear.saturation | unverified |
| 04-012 | Saturation Dynamic | selected-subset | shared-configuration | nonlinear.saturation-dynamic | unverified |
| 04-013 | Variable Pulse Generator | selected-subset | shared-configuration | source.variable-pulse | unverified |
| 04-014 | Wrap To Zero | selected-subset | independent-alternative | nonlinear.wrap-to-zero | unverified |
| 05-001 | Delay | selected-subset | native-capability | discrete.delay | unverified |
| 05-002 | Difference | selected-subset | shared-configuration | discrete.difference | unverified |
| 05-003 | Discrete Derivative | selected-subset | shared-configuration | discrete.derivative | unverified |
| 05-004 | Discrete FIR Filter | selected-subset | native-capability | discrete.fir | unverified |
| 05-005 | Discrete Filter | selected-subset | native-capability | discrete.filter | unverified |
| 05-006 | Discrete PID Controller | selected-subset | native-capability | discrete.pid | unverified |
| 05-007 | Discrete PID Controller (2DOF) | selected-subset | shared-configuration | discrete.pid-2dof | unverified |
| 05-008 | Discrete State-Space | selected-subset | native-capability | discrete.state-space | unverified |
| 05-009 | Discrete Transfer Fcn | selected-subset | preset | discrete.filter | unverified |
| 05-010 | Discrete Zero-Pole | selected-subset | shared-configuration | discrete.zero-pole | unverified |
| 05-011 | Discrete-Time Integrator | selected-subset | native-capability | discrete.integrator | unverified |
| 05-012 | Memory | selected-subset | native-capability | time.memory | unverified |
| 05-013 | Propagation Delay | selected-subset | native-capability | discrete.propagation-delay | unverified |
| 05-014 | Resettable Delay | selected-subset | shared-configuration | discrete.delay | unverified |
| 05-015 | Tapped Delay | selected-subset | shared-configuration | discrete.tapped-delay | unverified |
| 05-016 | Transfer Fcn First Order | selected-subset | independent-alternative | discrete.filter | unverified |
| 05-017 | Transfer Fcn Lead or Lag | selected-subset | independent-alternative | discrete.filter | unverified |
| 05-018 | Transfer Fcn Real Zero | selected-subset | independent-alternative | discrete.filter | unverified |
| 05-019 | Unit Delay | selected-subset | native-capability | discrete.unit-delay | unverified |
| 05-020 | Variable Integer Delay | selected-subset | shared-configuration | discrete.delay-configured | unverified |
| 05-021 | Zero-Order Hold | selected-subset | native-capability | time.zero-order-hold | unverified |
| 06-001 | Bit Clear | selected-subset | preset | logic.bit-mask | unverified |
| 06-002 | Bit Set | selected-subset | preset | logic.bit-mask | unverified |
| 06-003 | Bit to Integer Converter | selected-subset | native-capability | logic.bits-to-integer | unverified |
| 06-004 | Bitwise Operator | selected-subset | native-capability | logic.bitwise-typed | unverified |
| 06-005 | Combinatorial Logic | selected-subset | native-capability | logic.truth-table | unverified |
| 06-006 | Compare To Constant | selected-subset | shared-configuration | logic.compare-constant | unverified |
| 06-007 | Compare To Zero | selected-subset | preset | logic.compare-constant | unverified |
| 06-008 | Detect Change | selected-subset | shared-configuration | logic.edge-detect | unverified |
| 06-009 | Detect Decrease | selected-subset | preset | logic.numeric-edge | unverified |
| 06-010 | Detect Fall Negative | selected-subset | preset | logic.numeric-edge | unverified |
| 06-011 | Detect Fall Nonpositive | selected-subset | preset | logic.numeric-edge | unverified |
| 06-012 | Detect Increase | selected-subset | preset | logic.numeric-edge | unverified |
| 06-013 | Detect Rise Nonnegative | selected-subset | preset | logic.numeric-edge | unverified |
| 06-014 | Detect Rise Positive | selected-subset | preset | logic.numeric-edge | unverified |
| 06-015 | Extract Bits | selected-subset | native-capability | logic.extract-bits | unverified |
| 06-016 | Float Extract Bits | selected-subset | native-capability | logic.float-extract-bits | unverified |
| 06-017 | Integer to Bit Converter | selected-subset | native-capability | logic.integer-to-bits | unverified |
| 06-018 | Interval Test | selected-subset | shared-configuration | logic.interval | unverified |
| 06-019 | Interval Test Dynamic | selected-subset | shared-configuration | logic.interval-dynamic | unverified |
| 06-020 | Logical Operator | selected-subset | native-capability | logic.boolean | unverified |
| 06-021 | Relational Operator | selected-subset | native-capability | logic.compare | unverified |
| 06-022 | Shift Arithmetic | selected-subset | native-capability | logic.shift-arithmetic | unverified |
| 07-001 | 1-D Lookup Table | selected-subset | shared-configuration | lookup.interpolated | unverified |
| 07-002 | 2-D Lookup Table | selected-subset | shared-configuration | lookup.2d | unverified |
| 07-003 | Cosine | selected-subset | independent-alternative | fixed.trigonometric | unverified |
| 07-004 | Direct Lookup Table (n-D) | selected-subset | native-capability | lookup.direct | unverified |
| 07-005 | Interpolation Using Prelookup | selected-subset | native-capability | lookup.interpolate-prelookup | unverified |
| 07-006 | Lookup Table Dynamic | selected-subset | native-capability | lookup.dynamic | unverified |
| 07-007 | Prelookup | selected-subset | native-capability | lookup.prelookup | unverified |
| 07-008 | Sine | selected-subset | independent-alternative | fixed.trigonometric | unverified |
| 07-009 | n-D Lookup Table | selected-subset | shared-configuration | lookup.nd | unverified |
| 08-001 | Abs | selected-subset | native-capability | math.abs | unverified |
| 08-002 | Add | selected-subset | preset | math.sum | unverified |
| 08-003 | Algebraic Constraint | selected-subset | native-capability | solver.algebraic-constraint | unverified |
| 08-004 | Assignment | selected-subset | native-capability | matrix.assign | unverified |
| 08-005 | Bias | selected-subset | native-capability | math.bias | unverified |
| 08-006 | Complex to Magnitude-Angle | selected-subset | shared-configuration | complex.to-polar | unverified |
| 08-007 | Complex to Real-Imag | selected-subset | shared-configuration | complex.to-parts | unverified |
| 08-008 | Divide | selected-subset | native-capability | math.multiply | unverified |
| 08-009 | Dot Product | selected-subset | native-capability | vector.dot | unverified |
| 08-010 | Find Nonzero Elements | selected-subset | independent-alternative | matrix.find-nonzero | unverified |
| 08-011 | Gain | selected-subset | native-capability | math.gain | unverified |
| 08-012 | Magnitude-Angle to Complex | selected-subset | shared-configuration | complex.from-polar | unverified |
| 08-013 | Math Function | selected-subset | native-capability | math.function | unverified |
| 08-014 | Matrix Concatenate | selected-subset | shared-configuration | matrix.horizontal | unverified |
| 08-015 | Matrix Multiply | selected-subset | shared-configuration | math.matrix-multiply | unverified |
| 08-016 | MinMax | selected-subset | native-capability | math.minmax | unverified |
| 08-017 | MinMax Running Resettable | selected-subset | independent-alternative | math.running-minmax | unverified |
| 08-018 | Permute Dimensions | selected-subset | native-capability | matrix.permute-dimensions | unverified |
| 08-019 | Polynomial | selected-subset | native-capability | math.polynomial | unverified |
| 08-020 | Product | selected-subset | native-capability | math.multiply | unverified |
| 08-021 | Product of Elements | selected-subset | shared-configuration | reduce.product | unverified |
| 08-022 | Real-Imag to Complex | selected-subset | shared-configuration | complex.from-parts | unverified |
| 08-023 | Reciprocal Sqrt | selected-subset | shared-configuration | math.reciprocal-sqrt | unverified |
| 08-024 | Reshape | selected-subset | native-capability | matrix.reshape | unverified |
| 08-025 | Rounding Function | selected-subset | native-capability | math.round | unverified |
| 08-026 | Sign | selected-subset | native-capability | math.sign | unverified |
| 08-027 | Signed Sqrt | selected-subset | shared-configuration | math.signed-sqrt | unverified |
| 08-028 | Sine Wave Function | selected-subset | native-capability | math.sine-wave-function | unverified |
| 08-029 | Slider Gain | selected-subset | shared-configuration | math.gain | unverified |
| 08-030 | Sqrt | selected-subset | native-capability | math.sqrt | unverified |
| 08-031 | Squeeze | selected-subset | native-capability | matrix.squeeze | unverified |
| 08-032 | Subtract | selected-subset | preset | math.sum | unverified |
| 08-033 | Sum | selected-subset | native-capability | math.sum | unverified |
| 08-034 | Sum of Elements | selected-subset | shared-configuration | reduce.sum | unverified |
| 08-035 | Trigonometric Function | selected-subset | native-capability | math.trigonometric | unverified |
| 08-036 | Unary Minus | selected-subset | native-capability | math.negate | unverified |
| 08-037 | Vector Concatenate | selected-subset | shared-configuration | math.concatenate | unverified |
| 08-038 | Weighted Sample Time Math | selected-subset | native-capability | time.weighted-math | unverified |
| 09-001 | Array Processing Subsystem | selected-subset | independent-alternative | hierarchy.array-processing | unverified |
| 09-002 | Create Diagonal Matrix | selected-subset | native-capability | matrix.diag-create | unverified |
| 09-003 | Cross Product | selected-subset | native-capability | vector.cross | unverified |
| 09-004 | Expand Scalar | selected-subset | native-capability | matrix.expand-scalar | unverified |
| 09-005 | Extract Diagonal | selected-subset | native-capability | matrix.diagonal | unverified |
| 09-006 | Hermitian Transpose | selected-subset | shared-configuration | complex.hermitian | unverified |
| 09-007 | Identity Matrix | selected-subset | native-capability | matrix.identity | unverified |
| 09-008 | IsHermitian | selected-subset | native-capability | complex.is-hermitian | unverified |
| 09-009 | IsSymmetric | selected-subset | native-capability | matrix.is-symmetric | unverified |
| 09-010 | IsTriangular | selected-subset | native-capability | matrix.is-triangular | unverified |
| 09-011 | Matrix Concatenate | selected-subset | shared-configuration | matrix.horizontal | unverified |
| 09-012 | Matrix Multiply | selected-subset | shared-configuration | math.matrix-multiply | unverified |
| 09-013 | Matrix Square | selected-subset | shared-configuration | matrix.square | unverified |
| 09-014 | Neighborhood Processing Subsystem | selected-subset | independent-alternative | hierarchy.neighborhood-processing | unverified |
| 09-015 | Permute Matrix | selected-subset | native-capability | matrix.permute-rows-cols | unverified |
| 09-016 | Pixel Processing Subsystem | selected-subset | independent-alternative | hierarchy.pixel-processing | unverified |
| 09-017 | Product | selected-subset | native-capability | math.multiply | unverified |
| 09-018 | Submatrix | selected-subset | shared-configuration | matrix.select | unverified |
| 09-019 | Transpose | selected-subset | native-capability | matrix.transpose | unverified |
| 10-001 | Hit Crossing | selected-subset | native-capability | logic.hit-crossing | unverified |
| 10-002 | Hit Scheduler | selected-subset | independent-alternative | events.hit-scheduler | unverified |
| 10-003 | Message Merge | selected-subset | native-capability | events.message-merge | unverified |
| 10-004 | Message Triggered Subsystem | unsupported | native-capability | hierarchy.message-triggered | unverified |
| 10-005 | Queue | selected-subset | native-capability | events.queue | unverified |
| 10-006 | Receive | selected-subset | native-capability | events.receive | unverified |
| 10-007 | Send | selected-subset | native-capability | events.send | unverified |
| 10-008 | Sequence Viewer | selected-subset | native-capability | sink.sequence-viewer | unverified |
| 11-001 | Assertion | selected-subset | native-capability | verify.assert | unverified |
| 11-002 | Check Discrete Gradient | selected-subset | native-capability | verify.gradient | unverified |
| 11-003 | Check Dynamic Gap | selected-subset | shared-configuration | verify.bounds | unverified |
| 11-004 | Check Dynamic Lower Bound | selected-subset | shared-configuration | verify.bounds | unverified |
| 11-005 | Check Dynamic Range | selected-subset | shared-configuration | verify.bounds | unverified |
| 11-006 | Check Dynamic Upper Bound | selected-subset | shared-configuration | verify.bounds | unverified |
| 11-007 | Check Input Resolution | selected-subset | native-capability | verify.resolution | unverified |
| 11-008 | Check Static Gap | selected-subset | shared-configuration | verify.bounds | unverified |
| 11-009 | Check Static Lower Bound | selected-subset | shared-configuration | verify.bounds | unverified |
| 11-010 | Check Static Range | selected-subset | shared-configuration | verify.bounds | unverified |
| 11-011 | Check Static Upper Bound | selected-subset | shared-configuration | verify.bounds | unverified |
| 12-001 | Block Support Table | selected-subset | independent-alternative | model.support-catalog | unverified |
| 12-002 | DocBlock | selected-subset | native-capability | annotation.note | unverified |
| 12-003 | Model Info | selected-subset | native-capability | annotation.model-info | unverified |
| 12-004 | Timed-Based Linearization | selected-subset | independent-alternative | analysis.linearization | unverified |
| 12-005 | Trigger-Based Linearization | selected-subset | independent-alternative | analysis.linearization | unverified |
| 13-001 | Atomic Subsystem | selected-subset | shared-configuration | hierarchy.atomic | unverified |
| 13-002 | Enable | selected-subset | native-capability | hierarchy.enabled | unverified |
| 13-003 | Enabled Subsystem | selected-subset | native-capability | hierarchy.enabled | unverified |
| 13-004 | Enabled and Triggered Subsystem | selected-subset | shared-configuration | hierarchy.enabled-triggered | unverified |
| 13-005 | For Each Subsystem | selected-subset | shared-configuration | hierarchy.for-each | unverified |
| 13-006 | For Iterator Subsystem | selected-subset | shared-configuration | hierarchy.for-iterator | unverified |
| 13-007 | Function Element | selected-subset | independent-alternative | functions.element | unverified |
| 13-008 | Function Element Call | selected-subset | independent-alternative | functions.call | unverified |
| 13-009 | Function-Call Feedback Latch | selected-subset | native-capability | events.feedback-latch | unverified |
| 13-010 | Function-Call Generator | selected-subset | native-capability | events.function-call-generator | unverified |
| 13-011 | Function-Call Split | selected-subset | native-capability | events.function-call-split | unverified |
| 13-012 | Function-Call Subsystem | selected-subset | native-capability | hierarchy.function-call | unverified |
| 13-013 | If | selected-subset | native-capability | hierarchy.if | unverified |
| 13-014 | If Action Subsystem | selected-subset | shared-configuration | hierarchy.action | unverified |
| 13-015 | In Bus Element | unsupported | native-capability | io.bus-input | unverified |
| 13-016 | Inport | selected-subset | native-capability | io.structured-input | unverified |
| 13-017 | Model | unsupported | native-capability | hierarchy.model-reference | unverified |
| 13-018 | Out Bus Element | unsupported | native-capability | io.bus-output | unverified |
| 13-019 | Outport | selected-subset | native-capability | io.structured-output | unverified |
| 13-020 | Resettable Subsystem | selected-subset | native-capability | hierarchy.resettable | unverified |
| 13-021 | Subsystem | selected-subset | native-capability | hierarchy.subsystem | unverified |
| 13-022 | Subsystem Reference | unsupported | shared-configuration | hierarchy.model-reference | unverified |
| 13-023 | Switch Case | selected-subset | native-capability | hierarchy.switch-case | unverified |
| 13-024 | Switch Case Action Subsystem | selected-subset | shared-configuration | hierarchy.action | unverified |
| 13-025 | Trigger | selected-subset | native-capability | hierarchy.triggered | unverified |
| 13-026 | Triggered Subsystem | selected-subset | native-capability | hierarchy.triggered | unverified |
| 13-027 | Unit System Configuration | selected-subset | independent-alternative | signal.unit-system | unverified |
| 13-028 | Variant Subsystem | selected-subset | native-capability | hierarchy.variant | unverified |
| 13-029 | While Iterator Subsystem | selected-subset | shared-configuration | hierarchy.while-iterator | unverified |
| 14-001 | Bus to Vector | selected-subset | native-capability | signal.bus-to-vector | unverified |
| 14-002 | Data Type Conversion | selected-subset | native-capability | signal.cast | unverified |
| 14-003 | Data Type Conversion Inherited | selected-subset | shared-configuration | signal.cast-inherited | unverified |
| 14-004 | Data Type Duplicate | selected-subset | shared-configuration | signal.type-duplicate | unverified |
| 14-005 | Data Type Propagation | selected-subset | native-capability | signal.type-propagation | unverified |
| 14-006 | Data Type Scaling Strip | selected-subset | native-capability | signal.scaling-strip | unverified |
| 14-007 | IC | selected-subset | native-capability | signal.initial-condition | unverified |
| 14-008 | Probe | selected-subset | independent-alternative | signal.probe | unverified |
| 14-009 | Rate Transition | selected-subset | native-capability | time.rate-transition | unverified |
| 14-010 | Signal Conversion | selected-subset | independent-alternative | signal.representation | unverified |
| 14-011 | Signal Specification | selected-subset | native-capability | signal.specification | unverified |
| 14-012 | Unit Conversion | selected-subset | native-capability | unit.convert | unverified |
| 14-013 | Weighted Sample Time | selected-subset | preset | time.weighted-math | unverified |
| 14-014 | Width | selected-subset | native-capability | signal.width | unverified |
| 15-001 | Bus Assignment | selected-subset | native-capability | route.structured-assign | unverified |
| 15-002 | Bus Creator | selected-subset | native-capability | route.structured-bus | unverified |
| 15-003 | Bus Selector | selected-subset | native-capability | route.structured-select | unverified |
| 15-004 | Data Store Memory | selected-subset | shared-configuration | route.data-store-memory | unverified |
| 15-005 | Data Store Read | selected-subset | shared-configuration | route.data-store-read | unverified |
| 15-006 | Data Store Write | selected-subset | shared-configuration | route.data-store-write | unverified |
| 15-007 | Demux | selected-subset | native-capability | route.demux | unverified |
| 15-008 | From | selected-subset | shared-configuration | route.from | unverified |
| 15-009 | Goto | selected-subset | shared-configuration | route.goto | unverified |
| 15-010 | Goto Tag Visibility | selected-subset | shared-configuration | route.tag-visibility | unverified |
| 15-011 | Index Vector | selected-subset | shared-configuration | vector.select | unverified |
| 15-012 | Manual Switch | selected-subset | shared-configuration | route.manual-switch | unverified |
| 15-013 | Manual Variant Sink | unsupported | shared-configuration | route.variant | unverified |
| 15-014 | Manual Variant Source | unsupported | shared-configuration | route.variant | unverified |
| 15-015 | Merge | selected-subset | native-capability | route.merge | unverified |
| 15-016 | Multiport Switch | selected-subset | native-capability | route.multiport-switch | unverified |
| 15-017 | Mux | selected-subset | native-capability | route.mux | unverified |
| 15-018 | Parameter Writer | selected-subset | native-capability | state.parameter-writer | unverified |
| 15-019 | Selector | selected-subset | native-capability | vector.select | unverified |
| 15-020 | State Reader | selected-subset | native-capability | state.reader | unverified |
| 15-021 | State Writer | selected-subset | native-capability | state.writer | unverified |
| 15-022 | Switch | selected-subset | native-capability | route.switch | unverified |
| 15-023 | Variant End | unsupported | shared-configuration | route.variant | unverified |
| 15-024 | Variant Sink | unsupported | shared-configuration | route.variant | unverified |
| 15-025 | Variant Source | unsupported | shared-configuration | route.variant | unverified |
| 15-026 | Variant Start | unsupported | shared-configuration | route.variant | unverified |
| 15-027 | Vector Concatenate | selected-subset | shared-configuration | math.concatenate | unverified |
| 16-001 | Display | selected-subset | native-capability | sink.display | unverified |
| 16-002 | Floating Scope | selected-subset | shared-configuration | sink.floating-scope | unverified |
| 16-003 | Out Bus Element | unsupported | native-capability | io.bus-output | unverified |
| 16-004 | Outport | selected-subset | native-capability | io.structured-output | unverified |
| 16-005 | Record | selected-subset | native-capability | sink.record | unverified |
| 16-006 | Scope | selected-subset | native-capability | sink.scope | unverified |
| 16-007 | Stop Simulation | selected-subset | native-capability | sink.stop | unverified |
| 16-008 | Terminator | selected-subset | native-capability | io.terminator | unverified |
| 16-009 | To File | selected-subset | independent-alternative | data.output-file | unverified |
| 16-010 | To Workspace | selected-subset | independent-alternative | data.output-dataset | unverified |
| 16-011 | XY Graph | selected-subset | shared-configuration | sink.xy-graph | unverified |
| 17-001 | Band-Limited White Noise | selected-subset | native-capability | source.band-limited-noise | unverified |
| 17-002 | Chirp Signal | selected-subset | native-capability | source.chirp | unverified |
| 17-003 | Clock | selected-subset | native-capability | source.clock | unverified |
| 17-004 | Constant | selected-subset | native-capability | source.constant | unverified |
| 17-005 | Counter Free-Running | selected-subset | shared-configuration | source.counter | unverified |
| 17-006 | Counter Limited | selected-subset | preset | source.counter | unverified |
| 17-007 | Digital Clock | selected-subset | native-capability | source.digital-clock | unverified |
| 17-008 | Enumerated Constant | selected-subset | independent-alternative | source.enum | unverified |
| 17-009 | From File | selected-subset | native-capability | source.dataset | unverified |
| 17-010 | From Spreadsheet | selected-subset | independent-alternative | data.input-table | unverified |
| 17-011 | From Workspace | selected-subset | native-capability | source.dataset | unverified |
| 17-012 | Ground | selected-subset | preset | source.constant | unverified |
| 17-013 | In Bus Element | unsupported | native-capability | io.bus-input | unverified |
| 17-014 | Inport | selected-subset | native-capability | io.structured-input | unverified |
| 17-015 | Playback | selected-subset | native-capability | source.dataset | unverified |
| 17-016 | Pulse Generator | selected-subset | native-capability | source.pulse | unverified |
| 17-017 | Ramp | selected-subset | native-capability | source.ramp | unverified |
| 17-018 | Random Number | selected-subset | shared-configuration | source.random | unverified |
| 17-019 | Repeating Sequence | selected-subset | shared-configuration | source.repeating-sequence | unverified |
| 17-020 | Repeating Sequence Interpolated | selected-subset | shared-configuration | source.repeating-sequence | unverified |
| 17-021 | Repeating Sequence Stair | selected-subset | shared-configuration | source.repeating-sequence | unverified |
| 17-022 | Signal Editor | selected-subset | independent-alternative | data.signal-editor | unverified |
| 17-023 | Signal Generator | selected-subset | native-capability | source.signal-generator | unverified |
| 17-024 | Sine Wave | selected-subset | native-capability | source.sine-wave | unverified |
| 17-025 | Step | selected-subset | native-capability | source.step | unverified |
| 17-026 | Uniform Random Number | selected-subset | shared-configuration | source.random | unverified |
| 17-027 | Waveform Generator | selected-subset | independent-alternative | source.waveform | unverified |
| 18-001 | ASCII to String | selected-subset | native-capability | string.ascii-to-string | unverified |
| 18-002 | Compose String | selected-subset | native-capability | string.compose | unverified |
| 18-003 | Scan String | selected-subset | native-capability | string.scan | unverified |
| 18-004 | String Compare | selected-subset | native-capability | string.string-compare | unverified |
| 18-005 | String Concatenate | selected-subset | native-capability | string.string-concatenate | unverified |
| 18-006 | String Constant | selected-subset | native-capability | source.string-constant | unverified |
| 18-007 | String Contains | selected-subset | native-capability | string.string-contains | unverified |
| 18-008 | String Count | selected-subset | native-capability | string.string-count | unverified |
| 18-009 | String Find | selected-subset | native-capability | string.string-find | unverified |
| 18-010 | String Length | selected-subset | native-capability | string.string-length | unverified |
| 18-011 | String to ASCII | selected-subset | native-capability | string.string-to-ascii | unverified |
| 18-012 | String to Double | selected-subset | shared-configuration | string.parse-number | unverified |
| 18-013 | String to Enum | selected-subset | native-capability | string.parse-enum | unverified |
| 18-014 | String to Single | selected-subset | shared-configuration | string.parse-number | unverified |
| 18-015 | Substring | selected-subset | native-capability | string.substring | unverified |
| 18-016 | To String | selected-subset | native-capability | string.to-string | unverified |
| 19-001 | C Caller | selected-subset | independent-alternative | adapter.wasm-affine | unverified |
| 19-002 | C Function | selected-subset | independent-alternative | adapter.wasm-accumulator | unverified |
| 19-003 | Fcn | selected-subset | independent-alternative | math.expression | unverified |
| 19-004 | Function Caller | selected-subset | native-capability | functions.call | unverified |
| 19-005 | Initialize Function | selected-subset | shared-configuration | functions.initialize | unverified |
| 19-006 | Interpreted MATLAB Function | legacy-unavailable | legacy | adapter.matlab-legacy | unverified |
| 19-007 | Level-2 MATLAB S-Function | unsupported | conditional-adapter | adapter.matlab-s-function | unverified |
| 19-008 | MATLAB Function | selected-subset | independent-alternative | functions.typed | unverified |
| 19-009 | MATLAB System | unsupported | conditional-adapter | adapter.system-object | unverified |
| 19-010 | Reinitialize Function | selected-subset | shared-configuration | functions.reinitialize | unverified |
| 19-011 | Reset Function | selected-subset | shared-configuration | functions.reset | unverified |
| 19-012 | S-Function | unsupported | conditional-adapter | adapter.s-function | unverified |
| 19-013 | S-Function Builder | unsupported | conditional-adapter | adapter.native-code | unverified |
| 19-014 | Simulink Function | selected-subset | independent-alternative | functions.call | unverified |
| 19-015 | Terminate Function | selected-subset | shared-configuration | functions.terminate | unverified |
| 20-001 | Fixed-Point State-Space | selected-subset | shared-configuration | fixed.state-space | unverified |
| 20-002 | Transfer Fcn Direct Form II | selected-subset | preset | discrete.filter | unverified |
| 20-003 | Transfer Fcn Direct Form II Time Varying | selected-subset | native-capability | discrete.filter-time-varying | unverified |
| 20-004 | Decrement Real World | selected-subset | preset | math.increment | unverified |
| 20-005 | Decrement Stored Integer | selected-subset | preset | fixed.integer-increment | unverified |
| 20-006 | Decrement Time To Zero | selected-subset | native-capability | time.decrement-to-zero | unverified |
| 20-007 | Decrement To Zero | selected-subset | preset | math.increment | unverified |
| 20-008 | Increment Real World | selected-subset | preset | math.increment | unverified |
| 20-009 | Increment Stored Integer | selected-subset | preset | fixed.integer-increment | unverified |
| 21-001 | Eulers Number | selected-subset | preset | source.constant | unverified |
| 21-002 | Inf | selected-subset | preset | source.typed | unverified |
| 21-003 | NaN | selected-subset | preset | source.typed | unverified |
| 21-004 | Negative Inf | selected-subset | preset | source.typed | unverified |
| 21-005 | One | selected-subset | preset | source.constant | unverified |
| 21-006 | Pi | selected-subset | preset | source.constant | unverified |
| 21-007 | Zero | selected-subset | preset | source.constant | unverified |
| 21-008 | Square Root | selected-subset | preset | math.sqrt | unverified |
| 21-009 | Signed Square Root | selected-subset | shared-configuration | math.signed-sqrt | unverified |
| 21-010 | Reciprocal Square Root | selected-subset | shared-configuration | math.reciprocal-sqrt | unverified |
| 21-011 | Signal Copy | selected-subset | preset | signal.representation | unverified |
| 21-012 | To Virtual Bus | selected-subset | independent-alternative | signal.representation | unverified |
| 21-013 | To Nonvirtual Bus | selected-subset | independent-alternative | signal.representation | unverified |
| 21-014 | Discrete State-Space | selected-subset | shared-configuration | discrete.state-space | unverified |

모든 행의 exact 선택 parameter/fixture/증거 SHA, dtype·mode·target 경계, 외부 조건과 개별 미지원 이유는 JSON에 있다. 일부 과거 단계에 source-specific profile JSON이 없으면 수치 승인을 새로 만들지 않고 미확정으로 기록한다. `tsx scripts/generate-support-matrix.ts --check`로 byte-identical 생성과 역사25개 hash·registry337개 객체를 검증한다.
