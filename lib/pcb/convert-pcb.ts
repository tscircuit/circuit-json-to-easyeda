import type {
  CircuitJson,
  PcbBoard,
  PcbComponent,
  PcbCutout,
  PcbHole,
  PcbPlatedHole,
  PcbPort,
  PcbSilkscreenLine,
  PcbSilkscreenPath,
  PcbSilkscreenText,
  PcbSmtPad,
  PcbTrace,
  Point,
  SourcePort,
} from "circuit-json"
import {
  EasyEdaHole,
  EasyEdaLibrary,
  EasyEdaPad,
  EasyEdaPcbText,
  type EasyEdaShape,
  EasyEdaSolidRegion,
  EasyEdaTrack,
  EasyEdaVia,
} from "easyedats/lib/index"
import {
  toEasyEdaLength,
  toEasyEdaPoint,
  toEasyEdaRotation,
} from "../coordinates"
import { createEasyEdaPcbDocument } from "../easyeda-document"
import { toEasyEdaShapeId } from "../element-id"
import type { CircuitJsonToEasyEdaDiagnostic } from "../types"

type CircuitLayer =
  | string
  | {
      name: string
    }

interface PcbTraceWithConnectsTo extends PcbTrace {
  connectsTo?: string[]
}

interface PcbConversionMaps {
  sourceComponentById: Map<string, SourceComponentElement>
  sourcePortById: Map<string, SourcePort>
  pcbPortById: Map<string, PcbPort>
  netByPcbPortId: Map<string, string>
}

type SourceComponentElement = Extract<
  CircuitJson[number],
  { type: "source_component" }
>

function getLayerName(layer: CircuitLayer): string {
  return typeof layer === "string" ? layer : layer.name
}

function getCopperLayerId(layer: CircuitLayer): number {
  return getLayerName(layer) === "bottom" ? 2 : 1
}

function getSilkscreenLayerId(layer: CircuitLayer): number {
  return getLayerName(layer) === "bottom" ? 4 : 3
}

function getPadNumber(params: {
  pcbPortId?: string
  maps: PcbConversionMaps
}): string {
  if (!params.pcbPortId) return ""
  const pcbPort = params.maps.pcbPortById.get(params.pcbPortId)
  if (!pcbPort) return ""
  const sourcePort = params.maps.sourcePortById.get(pcbPort.source_port_id)
  return String(sourcePort?.pin_number ?? sourcePort?.name ?? "")
}

function getPadNet(params: {
  pcbPortId?: string
  maps: PcbConversionMaps
}): string {
  return params.pcbPortId
    ? (params.maps.netByPcbPortId.get(params.pcbPortId) ?? "")
    : ""
}

function getSmtPadGeometry(pad: PcbSmtPad): {
  shape: string
  width: number
  height: number
  polygonPoints: string
  clockwiseRotationDegrees: number
} {
  if (pad.shape === "circle") {
    return {
      shape: "ELLIPSE",
      width: toEasyEdaLength(pad.radius * 2),
      height: toEasyEdaLength(pad.radius * 2),
      polygonPoints: "",
      clockwiseRotationDegrees: 0,
    }
  }
  if (pad.shape === "polygon") {
    const points = pad.points.map(toEasyEdaPoint)
    const xs = points.map((point) => point.x)
    const ys = points.map((point) => point.y)
    return {
      shape: "POLYGON",
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      polygonPoints: points.map((point) => `${point.x} ${point.y}`).join(" "),
      clockwiseRotationDegrees: 0,
    }
  }
  return {
    shape: pad.shape.includes("pill") ? "OVAL" : "RECT",
    width: toEasyEdaLength(pad.width),
    height: toEasyEdaLength(pad.height),
    polygonPoints: "",
    clockwiseRotationDegrees:
      "ccw_rotation" in pad ? toEasyEdaRotation(pad.ccw_rotation) : 0,
  }
}

function getSmtPadCenter(pad: PcbSmtPad): Point {
  if ("x" in pad && "y" in pad) return { x: pad.x, y: pad.y }
  if (pad.points.length === 0) return { x: 0, y: 0 }
  return {
    x: pad.points.reduce((sum, point) => sum + point.x, 0) / pad.points.length,
    y: pad.points.reduce((sum, point) => sum + point.y, 0) / pad.points.length,
  }
}

function createSmtPad(params: {
  pad: PcbSmtPad
  maps: PcbConversionMaps
}): EasyEdaPad {
  const point = toEasyEdaPoint(getSmtPadCenter(params.pad))
  const geometry = getSmtPadGeometry(params.pad)
  return new EasyEdaPad({
    fields: [
      geometry.shape,
      String(point.x),
      String(point.y),
      String(geometry.width),
      String(geometry.height),
      String(getCopperLayerId(params.pad.layer)),
      getPadNet({ pcbPortId: params.pad.pcb_port_id, maps: params.maps }),
      getPadNumber({ pcbPortId: params.pad.pcb_port_id, maps: params.maps }),
      "0",
      geometry.polygonPoints,
      String(geometry.clockwiseRotationDegrees),
      toEasyEdaShapeId(params.pad.pcb_smtpad_id),
    ],
  })
}

function getPlatedHoleGeometry(platedHole: PcbPlatedHole): {
  shape: string
  width: number
  height: number
  holeRadius: number
  clockwiseRotationDegrees: number
} {
  if (platedHole.shape === "circle") {
    return {
      shape: "ELLIPSE",
      width: toEasyEdaLength(platedHole.outer_diameter),
      height: toEasyEdaLength(platedHole.outer_diameter),
      holeRadius: toEasyEdaLength(platedHole.hole_diameter / 2),
      clockwiseRotationDegrees: 0,
    }
  }
  if (platedHole.shape === "oval" || platedHole.shape === "pill") {
    return {
      shape: "OVAL",
      width: toEasyEdaLength(platedHole.outer_width),
      height: toEasyEdaLength(platedHole.outer_height),
      holeRadius: toEasyEdaLength(
        Math.min(platedHole.hole_width, platedHole.hole_height) / 2,
      ),
      clockwiseRotationDegrees: toEasyEdaRotation(platedHole.ccw_rotation),
    }
  }
  if (
    platedHole.shape === "pill_hole_with_rect_pad" ||
    platedHole.shape === "rotated_pill_hole_with_rect_pad"
  ) {
    return {
      shape: "RECT",
      width: toEasyEdaLength(platedHole.rect_pad_width),
      height: toEasyEdaLength(platedHole.rect_pad_height),
      holeRadius: toEasyEdaLength(
        Math.min(platedHole.hole_width, platedHole.hole_height) / 2,
      ),
      clockwiseRotationDegrees:
        platedHole.shape === "rotated_pill_hole_with_rect_pad"
          ? toEasyEdaRotation(platedHole.rect_ccw_rotation)
          : 0,
    }
  }
  if (platedHole.shape === "circular_hole_with_rect_pad") {
    return {
      shape: "RECT",
      width: toEasyEdaLength(platedHole.rect_pad_width),
      height: toEasyEdaLength(platedHole.rect_pad_height),
      holeRadius: toEasyEdaLength(platedHole.hole_diameter / 2),
      clockwiseRotationDegrees: toEasyEdaRotation(platedHole.rect_ccw_rotation),
    }
  }
  if (!("pad_outline" in platedHole)) {
    return {
      shape: "OVAL",
      width: toEasyEdaLength(platedHole.outer_width),
      height: toEasyEdaLength(platedHole.outer_height),
      holeRadius: toEasyEdaLength(
        Math.min(platedHole.hole_width, platedHole.hole_height) / 2,
      ),
      clockwiseRotationDegrees: toEasyEdaRotation(platedHole.ccw_rotation),
    }
  }
  const xs = platedHole.pad_outline.map((point) => Number(point.x))
  const ys = platedHole.pad_outline.map((point) => Number(point.y))
  const holeWidth = platedHole.hole_diameter ?? platedHole.hole_width ?? 0
  return {
    shape: "POLYGON",
    width: toEasyEdaLength(Math.max(...xs) - Math.min(...xs)),
    height: toEasyEdaLength(Math.max(...ys) - Math.min(...ys)),
    holeRadius: toEasyEdaLength(holeWidth / 2),
    clockwiseRotationDegrees: toEasyEdaRotation(platedHole.ccw_rotation),
  }
}

function createPlatedHole(params: {
  platedHole: PcbPlatedHole
  maps: PcbConversionMaps
}): EasyEdaPad {
  const point = toEasyEdaPoint(params.platedHole)
  const geometry = getPlatedHoleGeometry(params.platedHole)
  const polygonPoints =
    params.platedHole.shape === "hole_with_polygon_pad"
      ? params.platedHole.pad_outline
          .map(toEasyEdaPoint)
          .map((polygonPoint) => `${polygonPoint.x} ${polygonPoint.y}`)
          .join(" ")
      : ""
  return new EasyEdaPad({
    fields: [
      geometry.shape,
      String(point.x),
      String(point.y),
      String(geometry.width),
      String(geometry.height),
      "11",
      getPadNet({
        pcbPortId: params.platedHole.pcb_port_id,
        maps: params.maps,
      }),
      getPadNumber({
        pcbPortId: params.platedHole.pcb_port_id,
        maps: params.maps,
      }),
      String(geometry.holeRadius),
      polygonPoints,
      String(geometry.clockwiseRotationDegrees),
      toEasyEdaShapeId(params.platedHole.pcb_plated_hole_id),
    ],
  })
}

function createSilkscreenTrack(params: {
  id: string
  layer: CircuitLayer
  strokeWidth: number
  points: Point[]
}): EasyEdaTrack {
  const points = params.points.map(toEasyEdaPoint)
  return new EasyEdaTrack({
    fields: [
      String(toEasyEdaLength(params.strokeWidth)),
      String(getSilkscreenLayerId(params.layer)),
      "",
      points.map((point) => `${point.x} ${point.y}`).join(" "),
      toEasyEdaShapeId(params.id),
    ],
  })
}

function createPcbText(text: PcbSilkscreenText): EasyEdaPcbText {
  const point = toEasyEdaPoint(text.anchor_position)
  return new EasyEdaPcbText({
    fields: [
      "P",
      String(point.x),
      String(point.y),
      "0.7",
      String(toEasyEdaRotation(text.ccw_rotation)),
      "",
      String(getSilkscreenLayerId(text.layer)),
      "",
      String(toEasyEdaLength(text.font_size)),
      text.text,
      "",
      toEasyEdaShapeId(text.pcb_silkscreen_text_id),
    ],
  })
}

function createComponentLibrary(params: {
  pcbComponent: PcbComponent
  circuitJson: CircuitJson
  maps: PcbConversionMaps
}): EasyEdaLibrary {
  const sourceComponent = params.maps.sourceComponentById.get(
    params.pcbComponent.source_component_id,
  )
  const children: EasyEdaShape[] = []
  for (const element of params.circuitJson) {
    if (
      element.type === "pcb_smtpad" &&
      element.pcb_component_id === params.pcbComponent.pcb_component_id
    ) {
      children.push(createSmtPad({ pad: element, maps: params.maps }))
    } else if (
      element.type === "pcb_plated_hole" &&
      element.pcb_component_id === params.pcbComponent.pcb_component_id
    ) {
      children.push(
        createPlatedHole({ platedHole: element, maps: params.maps }),
      )
    } else if (
      element.type === "pcb_silkscreen_path" &&
      element.pcb_component_id === params.pcbComponent.pcb_component_id
    ) {
      children.push(
        createSilkscreenTrack({
          id: element.pcb_silkscreen_path_id,
          layer: element.layer,
          strokeWidth: element.stroke_width,
          points: element.route,
        }),
      )
    } else if (
      element.type === "pcb_silkscreen_line" &&
      element.pcb_component_id === params.pcbComponent.pcb_component_id
    ) {
      children.push(
        createSilkscreenTrack({
          id: element.pcb_silkscreen_line_id,
          layer: element.layer,
          strokeWidth: element.stroke_width,
          points: [
            { x: element.x1, y: element.y1 },
            { x: element.x2, y: element.y2 },
          ],
        }),
      )
    } else if (
      element.type === "pcb_silkscreen_text" &&
      element.pcb_component_id === params.pcbComponent.pcb_component_id
    ) {
      children.push(createPcbText(element))
    }
  }
  const center = toEasyEdaPoint(params.pcbComponent.center)
  const library = new EasyEdaLibrary({
    fields: [
      String(center.x),
      String(center.y),
      "",
      String(toEasyEdaRotation(params.pcbComponent.rotation)),
      "",
      toEasyEdaShapeId(params.pcbComponent.pcb_component_id),
      "1",
    ],
    children,
  })
  const reference = sourceComponent?.name ?? "U?"
  library.customAttributes.set("package", sourceComponent?.ftype ?? "tscircuit")
  library.customAttributes.set("name", reference)
  library.customAttributes.set(
    "value",
    sourceComponent?.manufacturer_part_number ?? sourceComponent?.ftype ?? "",
  )
  const jlcpcbPartNumber = sourceComponent?.supplier_part_numbers?.jlcpcb?.[0]
  if (jlcpcbPartNumber)
    library.customAttributes.set("JLCPCB Part", jlcpcbPartNumber)
  return library
}

function getBoardOutline(board: PcbBoard): Point[] {
  if (board.outline && board.outline.length >= 3) {
    return [...board.outline, board.outline[0]!]
  }
  const width = board.width ?? 0
  const height = board.height ?? 0
  const left = board.center.x - width / 2
  const right = board.center.x + width / 2
  const top = board.center.y + height / 2
  const bottom = board.center.y - height / 2
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
    { x: left, y: top },
  ]
}

function createBoardOutline(board: PcbBoard): EasyEdaTrack {
  const points = getBoardOutline(board).map(toEasyEdaPoint)
  return new EasyEdaTrack({
    fields: [
      "1",
      "10",
      "",
      points.map((point) => `${point.x} ${point.y}`).join(" "),
      toEasyEdaShapeId(`${board.pcb_board_id}-outline`),
    ],
  })
}

function createTraceShapes(trace: PcbTrace): EasyEdaShape[] {
  const shapes: EasyEdaShape[] = []
  let wirePoints: Point[] = []
  let wireLayer: CircuitLayer | undefined
  let wireWidth = 0.15
  let segmentIndex = 0
  const flushWire = () => {
    if (wirePoints.length < 2 || !wireLayer) {
      wirePoints = []
      wireLayer = undefined
      return
    }
    const easyEdaPoints = wirePoints.map(toEasyEdaPoint)
    shapes.push(
      new EasyEdaTrack({
        fields: [
          String(toEasyEdaLength(wireWidth)),
          String(getCopperLayerId(wireLayer)),
          trace.source_trace_id ?? trace.pcb_trace_id,
          easyEdaPoints.map((point) => `${point.x} ${point.y}`).join(" "),
          toEasyEdaShapeId(`${trace.pcb_trace_id}-${segmentIndex}`),
        ],
      }),
    )
    segmentIndex += 1
    wirePoints = []
    wireLayer = undefined
  }
  for (const routePoint of trace.route) {
    if (routePoint.route_type === "wire") {
      const nextLayer = getLayerName(routePoint.layer)
      if (wireLayer && getLayerName(wireLayer) !== nextLayer) flushWire()
      wireLayer = routePoint.layer
      wireWidth = routePoint.width
      wirePoints.push(routePoint)
    } else if (routePoint.route_type === "via") {
      flushWire()
      const point = toEasyEdaPoint(routePoint)
      const via = new EasyEdaVia({
        fields: [
          String(point.x),
          String(point.y),
          String(toEasyEdaLength(routePoint.outer_diameter ?? 0.6)),
          trace.source_trace_id ?? trace.pcb_trace_id,
          String(toEasyEdaLength((routePoint.hole_diameter ?? 0.3) / 2)),
          toEasyEdaShapeId(`${trace.pcb_trace_id}-via-${segmentIndex}`),
        ],
      })
      shapes.push(via)
      segmentIndex += 1
    } else {
      flushWire()
      const points = [routePoint.start, routePoint.end].map(toEasyEdaPoint)
      shapes.push(
        new EasyEdaTrack({
          fields: [
            String(toEasyEdaLength(routePoint.width)),
            "11",
            trace.source_trace_id ?? trace.pcb_trace_id,
            points.map((point) => `${point.x} ${point.y}`).join(" "),
            toEasyEdaShapeId(`${trace.pcb_trace_id}-through-${segmentIndex}`),
          ],
        }),
      )
      segmentIndex += 1
    }
  }
  flushWire()
  return shapes
}

function createPcbMaps(circuitJson: CircuitJson): PcbConversionMaps {
  const sourceComponents = circuitJson.filter(
    (element): element is SourceComponentElement =>
      element.type === "source_component",
  )
  const sourcePorts = circuitJson.filter(
    (element): element is SourcePort => element.type === "source_port",
  )
  const pcbPorts = circuitJson.filter(
    (element): element is PcbPort => element.type === "pcb_port",
  )
  const netByPcbPortId = new Map<string, string>()
  for (const trace of circuitJson.filter(
    (element): element is PcbTrace => element.type === "pcb_trace",
  )) {
    const net = trace.source_trace_id ?? trace.pcb_trace_id
    for (const pcbPortId of (trace as PcbTraceWithConnectsTo).connectsTo ??
      []) {
      netByPcbPortId.set(pcbPortId, net)
    }
    for (const routePoint of trace.route) {
      if (routePoint.route_type !== "wire") continue
      if (routePoint.start_pcb_port_id) {
        netByPcbPortId.set(routePoint.start_pcb_port_id, net)
      }
      if (routePoint.end_pcb_port_id) {
        netByPcbPortId.set(routePoint.end_pcb_port_id, net)
      }
    }
  }
  return {
    sourceComponentById: new Map(
      sourceComponents.map((component) => [
        component.source_component_id,
        component,
      ]),
    ),
    sourcePortById: new Map(
      sourcePorts.map((sourcePort) => [sourcePort.source_port_id, sourcePort]),
    ),
    pcbPortById: new Map(
      pcbPorts.map((pcbPort) => [pcbPort.pcb_port_id, pcbPort]),
    ),
    netByPcbPortId,
  }
}

function createStandaloneHoles(circuitJson: CircuitJson): EasyEdaHole[] {
  return circuitJson
    .filter(
      (element): element is PcbHole =>
        element.type === "pcb_hole" && !element.pcb_component_id,
    )
    .map((hole) => {
      const point = toEasyEdaPoint(hole)
      const diameter =
        hole.hole_shape === "circle"
          ? hole.hole_diameter
          : "hole_width" in hole
            ? hole.hole_width
            : 0
      return new EasyEdaHole({
        fields: [
          String(point.x),
          String(point.y),
          String(toEasyEdaLength(diameter)),
          toEasyEdaShapeId(hole.pcb_hole_id),
        ],
      })
    })
}

function rotatePointAround(
  point: Point,
  center: Point,
  ccwRotationDegrees: number,
): Point {
  const radians = (ccwRotationDegrees * Math.PI) / 180
  const dx = point.x - center.x
  const dy = point.y - center.y
  return {
    x: center.x + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: center.y + dx * Math.sin(radians) + dy * Math.cos(radians),
  }
}

function getRectangularCutoutPoints(
  cutout: Extract<PcbCutout, { shape: "rect" }>,
): Point[] {
  const halfWidth = cutout.width / 2
  const halfHeight = cutout.height / 2
  const corners = [
    { x: cutout.center.x - halfWidth, y: cutout.center.y - halfHeight },
    { x: cutout.center.x + halfWidth, y: cutout.center.y - halfHeight },
    { x: cutout.center.x + halfWidth, y: cutout.center.y + halfHeight },
    { x: cutout.center.x - halfWidth, y: cutout.center.y + halfHeight },
  ]
  const rotation = cutout.rotation ?? 0
  if (!rotation) return corners
  return corners.map((corner) =>
    rotatePointAround(corner, cutout.center, rotation),
  )
}

function createCutoutSolidRegion(
  points: Point[],
  cutoutId: string,
): EasyEdaSolidRegion {
  const easyEdaPoints = points.map(toEasyEdaPoint)
  const first = easyEdaPoints[0]
  const last = easyEdaPoints.at(-1)
  if (first && last && (first.x !== last.x || first.y !== last.y)) {
    easyEdaPoints.push(first)
  }
  return new EasyEdaSolidRegion({
    fields: [
      "10",
      "",
      easyEdaPoints.map((point) => `${point.x} ${point.y}`).join(" "),
      "cutout",
      toEasyEdaShapeId(cutoutId),
    ],
  })
}

function createCutoutShapes(params: {
  circuitJson: CircuitJson
  diagnostics: CircuitJsonToEasyEdaDiagnostic[]
}): EasyEdaShape[] {
  const shapes: EasyEdaShape[] = []
  for (const cutout of params.circuitJson.filter(
    (element): element is PcbCutout => element.type === "pcb_cutout",
  )) {
    if (cutout.shape === "circle") {
      const point = toEasyEdaPoint(cutout.center)
      shapes.push(
        new EasyEdaHole({
          fields: [
            String(point.x),
            String(point.y),
            String(toEasyEdaLength(cutout.radius * 2)),
            toEasyEdaShapeId(cutout.pcb_cutout_id),
          ],
        }),
      )
      continue
    }
    if (cutout.shape === "rect") {
      shapes.push(
        createCutoutSolidRegion(
          getRectangularCutoutPoints(cutout),
          cutout.pcb_cutout_id,
        ),
      )
      continue
    }
    if (cutout.shape === "polygon") {
      shapes.push(createCutoutSolidRegion(cutout.points, cutout.pcb_cutout_id))
      continue
    }
    params.diagnostics.push({
      code: "unsupported-element",
      severity: "warning",
      message:
        "Path pcb_cutout slots are not mapped to an EasyEDA HOLE or SOLIDREGION cutout.",
      circuitElementType: "pcb_cutout",
      circuitElementId: cutout.pcb_cutout_id,
    })
  }
  return shapes
}

export function convertPcbCircuitJson(params: {
  circuitJson: CircuitJson
  title: string
  diagnostics: CircuitJsonToEasyEdaDiagnostic[]
}) {
  const maps = createPcbMaps(params.circuitJson)
  const shapes: EasyEdaShape[] = []
  const board = params.circuitJson.find(
    (element): element is PcbBoard => element.type === "pcb_board",
  )
  if (board) {
    shapes.push(createBoardOutline(board))
  } else {
    params.diagnostics.push({
      code: "invalid-geometry",
      severity: "warning",
      message: "Circuit JSON did not contain a PCB board outline.",
      circuitElementType: "pcb_board",
    })
  }
  for (const pcbComponent of params.circuitJson.filter(
    (element): element is PcbComponent => element.type === "pcb_component",
  )) {
    shapes.push(
      createComponentLibrary({
        pcbComponent,
        circuitJson: params.circuitJson,
        maps,
      }),
    )
  }
  for (const trace of params.circuitJson.filter(
    (element): element is PcbTrace => element.type === "pcb_trace",
  )) {
    shapes.push(...createTraceShapes(trace))
  }
  shapes.push(...createStandaloneHoles(params.circuitJson))
  shapes.push(
    ...createCutoutShapes({
      circuitJson: params.circuitJson,
      diagnostics: params.diagnostics,
    }),
  )
  return createEasyEdaPcbDocument({ title: params.title, shapes })
}
