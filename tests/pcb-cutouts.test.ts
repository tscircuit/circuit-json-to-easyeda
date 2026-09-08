import { expect, test } from "bun:test"
import type { CircuitJson } from "circuit-json"
import { EasyEdaHole, EasyEdaSolidRegion, parseEasyEdaSource } from "easyedats"
import { convertCircuitJsonToEasyEda } from "lib"

const board = {
  type: "pcb_board" as const,
  pcb_board_id: "pcb_board_1",
  center: { x: 0, y: 0 },
  width: 40,
  height: 24,
  thickness: 1.6,
  num_layers: 2,
  material: "fr4" as const,
}

test("circular pcb_cutout becomes an EasyEDA HOLE", () => {
  const result = convertCircuitJsonToEasyEda({
    circuitJson: [
      board,
      {
        type: "pcb_cutout",
        pcb_cutout_id: "pcb_cutout_circle",
        shape: "circle",
        center: { x: 2, y: 1 },
        radius: 1.5,
      },
    ] as CircuitJson,
    kind: "pcb",
    title: "Circular cutout",
  })

  expect(result.diagnostics).toEqual([])
  const hole = result.easyEdaDocument.shapes.find(
    (shape) => shape instanceof EasyEdaHole,
  ) as EasyEdaHole
  expect(hole).toBeDefined()
  expect(hole.x).toBeCloseTo(400 + 2 / 0.254, 5)
  expect(hole.y).toBeCloseTo(300 - 1 / 0.254, 5)
  expect(hole.diameter).toBeCloseTo(3 / 0.254, 5)
  expect(parseEasyEdaSource(result.easyEdaSource).kind).toBe("pcb")
})

test("rect and polygon pcb_cutouts become SOLIDREGION cutouts on the board outline", () => {
  const result = convertCircuitJsonToEasyEda({
    circuitJson: [
      board,
      {
        type: "pcb_cutout",
        pcb_cutout_id: "pcb_cutout_rect",
        shape: "rect",
        center: { x: 0, y: 0 },
        width: 6,
        height: 1,
        rotation: 90,
      },
      {
        type: "pcb_cutout",
        pcb_cutout_id: "pcb_cutout_poly",
        shape: "polygon",
        points: [
          { x: 8, y: -1 },
          { x: 12, y: -1 },
          { x: 12, y: 2 },
        ],
      },
    ] as CircuitJson,
    kind: "pcb",
    title: "Polygon cutouts",
  })

  expect(result.diagnostics).toEqual([])
  const cutouts = result.easyEdaDocument.shapes.filter(
    (shape) => shape instanceof EasyEdaSolidRegion,
  ) as EasyEdaSolidRegion[]
  expect(cutouts).toHaveLength(2)
  expect(cutouts.every((cutout) => cutout.fillStyle === "cutout")).toBe(true)
  expect(cutouts.every((cutout) => cutout.layerId === 10)).toBe(true)

  const rotated = cutouts.find((cutout) => cutout.id?.includes("rect"))
  expect(rotated).toBeDefined()
  if (!rotated) return
  const xs = rotated.points.map((point) => point.x)
  const ys = rotated.points.map((point) => point.y)
  expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1 / 0.254, 4)
  expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(6 / 0.254, 4)
})

test("path pcb_cutout emits an unsupported-element diagnostic", () => {
  const result = convertCircuitJsonToEasyEda({
    circuitJson: [
      board,
      {
        type: "pcb_cutout",
        pcb_cutout_id: "pcb_cutout_path",
        shape: "path",
        route: [
          { x: -4, y: 0 },
          { x: 4, y: 0 },
        ],
        slot_width: 1,
      },
    ] as CircuitJson,
    kind: "pcb",
    title: "Path cutout",
  })

  expect(result.diagnostics).toEqual([
    {
      code: "unsupported-element",
      severity: "warning",
      message:
        "Path pcb_cutout slots are not mapped to an EasyEDA HOLE or SOLIDREGION cutout.",
      circuitElementType: "pcb_cutout",
      circuitElementId: "pcb_cutout_path",
    },
  ])
  expect(
    result.easyEdaDocument.shapes.filter(
      (shape) =>
        shape instanceof EasyEdaSolidRegion || shape instanceof EasyEdaHole,
    ),
  ).toHaveLength(0)
})
