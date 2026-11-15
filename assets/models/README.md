# RedAlert3A External 3D Model Overrides (`.glb`)

Place glTF 2.0 binary `.glb` files in this folder named by canonical entity ID (`<typeId>.glb`, e.g. `apocalypse.glb`, `kirov.glb`, `gi.glb`), and register them in `manifest.json`:

```json
{
  "models": {
    "apocalypse": { "file": "apocalypse.glb", "scale": 1.0, "groundY": true },
    "kirov": { "file": "kirov.glb", "scale": 1.2, "groundY": false }
  }
}
```

### Sub-part & Material Conventions
- **Part Articulation (`aPartId`)**: Node or mesh names containing `turret`, `head`, `dish`, `radar`, `crane`, or `rotor` rotate with unit turret yaw (`aPartId = 1`); names containing `barrel`, `gun`, `cannon`, `weapon`, or `missile` recoil cleanly on fire (`aPartId = 2`).
- **Material Tone (`aTone`)**: Material names containing `stripe` / `team` / `accent` take crisp faction accent paint; `glass` / `canopy` / `visor` / `prism` render as glossy glass/crystal; `glow` / `emissive` / `core` trigger HDR bloom.
- Any unit without an entry cleanly falls back to the built-in procedural high-detail model.
