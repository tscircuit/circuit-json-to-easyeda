# circuit-json-to-easyeda

Convert typed [Circuit JSON](https://github.com/tscircuit/circuit-json) into
EasyEDA Standard schematic and PCB documents.

The converter builds and returns `easyedats` document and shape instances. It
does not introduce a second EasyEDA schema. Callers can inspect or mutate the
typed document before serializing it, or use the returned source directly.

```ts
import { convertCircuitJsonToEasyEda } from "circuit-json-to-easyeda"

const result = convertCircuitJsonToEasyEda({
  circuitJson,
  kind: "schematic",
  title: "USB-C LED Flashlight",
})

console.log(result.easyEdaDocument.kind) // "schematic"
console.log(result.easyEdaSource)
console.log(result.diagnostics)
```

## Initial coverage

- schematic components, source metadata, pins, and routed wires
- PCB board outlines, components, SMT pads, plated holes, mounting holes, and
  board cutouts (`pcb_cutout` circle/rect/polygon)
- PCB copper traces and vias
- top and bottom silkscreen paths, lines, and text
- source reference designators, manufacturer part numbers, and JLCPCB part
  numbers preserved as EasyEDA component attributes
- conversion diagnostics for Circuit JSON errors and invalid geometry

Circuit JSON remains the regenerable design model. The EasyEDA source is an
interchange artifact produced through `easyedats`.
