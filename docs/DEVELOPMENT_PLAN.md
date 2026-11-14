# RedAlert3A（《墨陆：赤潮警戒》）工程开发执行计划 (AI Agent Playbook v2.2)

- **适用对象**：自动化编程代理（AI Coding Agents，如 Hygrogn / Antigravity / Codex / Claude Code 等）与人类主程协同执行
- **基线版本**：对齐仓库 v2.2 定稿文档集（[`PRD.md`](PRD.md)、[`SDD.md`](SDD.md)、[`docs/README.md`](README.md)）
- **仓库状态**：纯设计定稿态（零源码起点）；按 **M1 → M6** 共 **27 个原子任务（`T1.1` ~ `T6.3`）** 渐进交付

> **核心定位**：本文档是将 PRD 与 SDD 转化为“AI 可直接按顺序拆解编码、契约对齐、自检闭环”的**零歧义工程施工说明书**。任何开发会话启动时，必须先遵守第 1 节执行总则与第 2 节跨模块契约，再按第 3 节任务序号推进。

---

## 1. AI Agent 研发执行总则（Agent Execution Protocol）

### 1.1 文档真理源与冲突裁决顺序
当开发过程中出现文档理解或参数疑问时，严格按以下优先级裁决：
1. **运行时数值唯一真理源**：所有单位、建筑、护甲矩阵、电力、超武参数一经写入 `src/core/config.js`，即成为代码运行时的唯一真理源。
2. **统一命名与 ID 字典**：所有代码键名、文件名、`i18n` Key 必须与 [`docs/README.md`](README.md) 第 2 节一致（例如：`conyard`、`refinery`、`crimson_mig`、`aa_turret`、`hospital`，**严禁自造别名或混用“红刀”**）。
3. **玩法机制与操控边界**：以 [`PRD.md`](PRD.md) 为准。
4. **渲染管线、内存池与性能门禁**：以 [`SDD.md`](SDD.md) 为准。

### 1.2 四条绝对架构红线（Hard Architectural Invariants）
Agent 在生成或重构任何模块前，必须校验是否触犯以下红线：
1. **模拟层零 DOM / 零 WebGL 耦合**：
   - `src/core/`（除 `save.js` 封装 IndexedDB 外）、`src/world/map.js` 与 `src/gameplay/` **严禁直接 `import` `three`、读取 `window` / `document` / `localStorage` / WebGL 上下文**。
   - 保证 `scripts/balance-sim.mjs` 可在纯 Node.js（ESM）环境中直接 `import` 并以 `1000×` 倍速运行整套模拟循环。
2. **严格 `30 Hz` 确定性逻辑步长**：
   - 一切单位移动、寻路、扣款建造、武器冷却、投射物飞行、老兵经验、矿柱再生、AI 决策与超武倒计时仅在 `stepSimulation(state, dt = 1/30)` 中更新；
   - `requestAnimationFrame` 渲染帧只读快照并按 `alpha ∈ [0, 1)` 做 `lerp(prevX, x, alpha)` 插值，禁止在渲染回调内修改任何玩法状态或消耗 PRNG。
3. **零硬编码 UI 文案与双语实时热切换**：
   - 所有界面、按钮简称、Tooltip、无线电台词、HUD 状态提示必须通过 `i18n.t(key, params)` 获取，同步补全 `src/locales/zh-CN.js` 与 `src/locales/en-US.js`，禁止在 `ui/` 或 `story/` 内残留未翻译硬编码中文/英文。
   - Sidebar 右栏宽 `200px`，中/英文简称（如 `光棱` / `Prism`、`天启` / `Apoc`）切换时不得撑破按钮或溢出遮挡。
4. **单 Draw Call 合批与 `< 140 Draw Calls` 门禁**：
   - 同类多部件单位不得拆分为“底盘 Mesh + 炮塔 Mesh + 炮管 Mesh”，必须打包为带 `aPartId` 属性的单几何体，由 `models.js` 顶点着色器读取 `aUnitState = vec4(turretYaw, recoil, hpRatio, teamAndFlags)` 一步驱动。
   - 所有血条、选中光环、老兵角标、铁幕护盾条与载员点阵合并入 `billboards.js` 的 **1 个 `InstancedMesh`**，严禁用 DOM `<div>` 绘制战场血条。

### 1.3 标准开发单步闭环（Agent Loop）
每次仅领取 **1 个原子任务（如 `T1.3`）**，严格按 4 步执行：
1. **前置核对**：阅读本任务涉及的“输入依赖”、“输出文件”、“核心逻辑与边界”；确认涉及的常量已存在于 `src/core/config.js`。
2. **最小干净实现**：严格遵循 ESM 模块边界编写代码；使用固定容量对象池/TypedArray（避免 `30 Hz` Tick 内高频 `new Array` / 对象碎片触发 GC）。
3. **本地验证**：运行本任务列出的命令行/无头单测或浏览器验证命令，**不得跳过报错或伪造通过状态**。
4. **阶段提交**：每个 Task 或每个 Milestone 完成验收后立即小粒度 Commit，确保仓库任意提交均可 `npm run build`。

---

## 2. 核心跨模块数据结构与接口契约（Contracts）

### 2.1 `GameState`（模拟核心唯一状态根）

```js
// src/core/engine.js 创建与维护，Node 无头与浏览器共用同一结构
export function createGameState(options) {
  return {
    tickCount: 0,                  // 单调递增逻辑 Tick（30 Tick = 1s）
    prngState: options.seed >>> 0, // Mulberry32 / xorshift32 状态，唯一随机源
    mode: options.mode,            // 'skirmish' | 'campaign' | 'gallery' | 'bench'
    missionId: options.missionId ?? null, // 'A01'..'A06' | 'C01'..'C06' | 'EX13'
    map: null,                     // MapData（256x256 terrain/elevation/oreType/oreAmount/bridges）
    players: [/* PlayerState (playerId: 0..3) */],
    fogGrids: {                    // key = teamId (0..3), value = Uint8Array(256 * 256)
      // Bit 0 (1): EXPLORED, Bit 1 (2): VISIBLE, Bit 2 (4): DETECTED
    },
    entities: [],                  // 实体表（或 SOA 索引池 + activeIds 紧凑列表）
    nextEntityId: 1,
    projectiles: [],               // 在途弹道与 pendingDamage 预约态
    areaEffects: [],               // { id, type: 'satellite'|'radiation'|'storm', x, z, radius, teamId, expiryTick }
    orePillars: [],                // { x, z, oreType: 'red'|'violet', nextRegenTick }
    flowCache: null,               // 16 槽 LRU 流场缓存 + 每 Tick <= 2 队列
    winnerTeamId: null,
    events: []                     // 本 Tick 产出供渲染/音频/导演消费的事件队列（每帧消费后清空）
  };
}
```

### 2.2 `PlayerState` 与五通道并发队列契约

```js
// playerId (0..3), teamId (0..3), factionId ('abyssal' | 'crimson' | 'neutral')
{
  playerId: 0,
  teamId: 0,
  factionId: 'abyssal',
  isHuman: true,
  aiDifficulty: null,          // null | 'easy' | 'normal' | 'hard'
  credits: 10000,
  powerProduced: 0,
  powerConsumed: 0,
  powerFactor: 1.0,            // green >= 1.0 -> 1.0; yellow [0.6, 1.0) -> 0.5; red < 0.6 -> 0.35
  // 5 通道队列与 Sidebar Q/W/E/R/T 严格 1:1 映射
  queues: {
    main: null,                // { typeId, totalCost, paidCost, progressTicks, totalTicks, status: 'BUILDING'|'READY'|'PAUSED' }
    defense: null,             // 同上（仅建筑/防御塔/超武，单队列）
    infantry: [],              // 队列数组（每项含 count <= 99, currentItemProgress）
    vehicle: [],
    air_naval: []              // Sidebar T 页签 [空军|海军] 共用此队列
  },
  doctrines: {                 // F1~F4 指挥官秘策冷却（Ticks）
    recon_satellite: 0,
    paratroopers: 0,
    nano_repair: 0,
    emp_strike: 0
  },
  superweapons: {              // 已建成超武就绪倒计时
    chrono_sphere: null,
    iron_curtain: null,
    weather_control: null,
    nuclear_silo: null
  },
  stats: { produced: 0, lost: 0, killedValue: 0, spentValue: 0 }
}
```

### 2.3 `Entity` 与 `Projectile` 关键字段契约

```js
// Entity 通用字段（单位与建筑共用核心识别字段，建筑通过 isBuilding: true 与 footprintW/H 区分）
{
  id: 1,
  typeId: 'grizzly',           // 对齐 docs/README.md 唯一 ID
  category: 'vehicle',         // 'infantry'|'vehicle'|'air'|'naval'|'building'|'neutral'
  domain: 'GROUND',            // 'GROUND' | 'SEA' | 'SUBMERGED' | 'AIR'
  isBuilding: false,
  playerId: 0,                 // 归属玩家（配色与扣款来源）
  teamId: 0,                   // 队伍（视野共享与友敌判断）
  factionId: 'abyssal',        // 'abyssal' | 'crimson' | 'neutral'（EX-13 按拥有建筑并集解锁科技）
  producerType: 'war_factory', // 'conyard'|'barracks'|'war_factory'|'airforce_radar'|'naval_yard'
  // 空间与插值快照
  x: 120, z: 120, y: 0,
  prevX: 120, prevZ: 120, prevY: 0,
  yaw: 0, turretYaw: 0, recoil: 0,
  // 战斗与生存状态
  hp: 370, maxHp: 370,
  baseMaxHp: 370, baseDamage: 68, baseSpeed: 6.4, baseCooldownTicks: 48, baseSight: 16,
  armor: 'Heavy',              // 'None'|'HeavyInfantry'|'Light'|'Heavy'|'SuperHeavy'|'Air'
  isStructure: false,          // 建筑置 true，命中时读取 HighExplosive/Prism 的 Structure 覆盖倍率
  pendingDamage: 0,            // 仅由合法索敌预约累加，幂等释放
  // 特种状态（时空抹除 / 铁幕 / EMP / 老兵）
  eraseProgress: 0,            // 仅由时空军团兵/IFV(chrono) 独立累加，不直接扣减 real hp
  frozenByCount: 0,            // >0 时移出常规相位（免疫常规伤害与治疗）
  ironCurtainTicks: 0,         // >0 时绝对无敌且免疫时空冻结与抹除
  empTicks: 0,                 // >0 时机械单位/非无电防御塔瘫痪
  deployState: 'MOBILE',       // MCV/大兵部署态
  // 老兵系统（0/1/2，按基础面板直接覆盖，不累乘）
  veterancy: 0,
  killValue: 0,
  lastCombatTick: -999,
  // FSM（矿车 7 态 / 航母舰载机 5 态 / 停机坪战机）
  fsmState: 'IDLE',
  cargoCount: 0,               // 矿车已采格数 (0..2)
  cargoValue: 0,               // 矿车已采实际晶矿金额（允许赤 $350 + 紫 $700 = $1,050 混装累加）
  homeId: null,                // 所属精炼厂 / 空指部停机坪 / 航母 ID
  ammo: 4,                     // 风暴鹰/赤刃弹药槽
  cargoIds: []                 // 气垫船/IFV/夜鹰载员实体 ID
}

// Projectile / 预约契约（解决 pendingDamage 误释放 Bug）
{
  id: 101,
  attackerId: 12,
  targetId: 45,
  damageType: 'Missile',
  baseDamage: 130,
  reservedDamage: 169,         // 预约瞬间算好的预期期望伤害
  released: false,             // 幂等门闩：仅当命中/拦截/失效且 !released 时置 true 并扣减 pendingDamage
  interceptable: true,         // true: V3 火箭可被爱国者/神盾/高炮拦截
  x: 10, z: 10, y: 2, vx: 0, vy: 0, vz: 0,
  ttlTicks: 180
}
```

### 2.4 模块依赖拓扑与导入方向（禁止反向或环状引用）

```text
core/config.js, core/events.js, core/i18n.js
        ▲
        │
world/map.js  ──►  gameplay/nav.js  ──►  gameplay/entities.js
                                              ▲
                                              │
gameplay/production.js ◄──► gameplay/combat.js ◄──► gameplay/naval.js & airforce.js
                                  ▲
                                  │
                     gameplay/superweapon.js  ──►  gameplay/ai.js
                                  ▲
                                  │
            story/director.js + core/save.js
                                  ▲
                                  │
    render/* + world/models.js + world/destruction.js + ui/* + core/mixer.js
```

---

## 3. M1 – M6 分阶段原子任务清单（Atomic Task Breakdown）

### 阶段一（M1）：次世代渲染底座 + 单图陆军最小可玩闭环

> **M1 验收红线**：在标准海陆测试图上跑通“MCV `D` 展开 → 电厂 → 精炼厂与采矿车自动往返 → 战车工厂造灰熊/犀牛 → 框选/A移动接敌击毁敌基地”，`1080p High` 下全帧总 Draw Calls `< 140`，控制台 `0` 报错。

- **`T1.1` 工程脚手架与构建工具链**
  - **输出文件**：`package.json`、`vite.config.js`、`index.html`、`LICENSE`（MIT）
  - **实施要点**：
    - 配置 `"dev": "vite"`, `"build": "vite build"`, `"preview": "vite preview"`, `"sim:balance": "node scripts/balance-sim.mjs"`。
    - `index.html` 内置渐进式加载 HUD 骨架（不阻塞首屏）；严格分离模拟脚本避免打包把 Node 工具链打进浏览器产物。
  - **自检门禁**：`npm install && npm run build` 退出码 `0`。

- **`T1.2` 事件总线、PRNG、双语 i18n 与单一数值源 (`config.js`)**
  - **输出文件**：`src/core/events.js`、`src/core/config.js`、`src/core/i18n.js`、`src/locales/zh-CN.js`、`src/locales/en-US.js`、`src/locales/index.js`
  - **实施要点**：
    - `config.js` 完整定义：
      - 全 `28` 兵种、`18` 建筑/防御/超武、`3` 中立建筑基础表（完全使用 `docs/README.md` 内部 ID）；
      - `ARMOR_MATRIX` (`7×6`) 与 `ARMOR_OVERRIDES`（支持 `Bullet` vs `rocketeer = 0.6`、`Missile` vs `aegis = 1.6`、`HighExplosive/Prism` vs `isStructure = 1.35 / 1.30`）；
      - `VETERANCY_CONFIG`（Rank 0/1/2 直接相对基础值覆盖表）；
      - `QUALITY_PRESETS`（`ultra` / `high` / `balanced`）；
      - `KEYMAP_DEFAULTS`（严格禁用 `W/A/S/D` 移镜，采用 `↑/↓/←/→` 移镜 + `A/S/D/K/X/Q/W/E/R/T/F1~F4/L/H/Space/Esc`）。
    - `i18n.js` 实现回退链 `activeLocale -> 'zh-CN' -> 'en-US' -> key`，支持 URL `?lang=zh|en` 与运行时 `setLocale()` 事件广播。
  - **自检门禁**：编写 Node 验证脚本 `node -e` 校验 `zh-CN` 与 `en-US` key 集合 100% 相等、全部单位均带合法 `producerType` 与护甲值。

- **`T1.3` `30 Hz` 确定性主循环与参数化地图编译器**
  - **输出文件**：`src/core/engine.js`、`src/world/map.js`
  - **实施要点**：
    - `engine.js` 实现固定时间步长累加器（最大防螺旋步数 `<= 5`），向 `stepSimulation(state)` 传入固定 `1/30` 秒，并保留 `prevX/prevZ` 供渲染层插值；内置 `?nofog=1&fastbuild=1&bench=1&show=gallery&mission=` URL 参数解析。
    - `map.js` 解析声明式蓝图，在 `< 15ms` 内编译 `256×256` 网格（每格 `2m`，地形枚举 `LAND / SHALLOW / SEA / CLIFF / BRIDGE / BROKEN_BRIDGE`、`oreType: 0|1|2`、`oreAmount`、`buildingId`）；实现每 `300` 逻辑 Tick 再生矿柱扫描逻辑（**每座矿柱每次合计只挑 `3` 格内由近及远首个未满/空矿格补充 `1` 格晶矿**）。
  - **自检门禁**：Node 测试构建 1 张标准测试图耗时 `< 15ms`；矿柱运行 `300` Tick 后周边恰好仅新增 `1` 格晶矿。

- **`T1.4` CPU 视野位掩码与 GPU 双通道战争迷雾**
  - **输出文件**：`src/gameplay/fogCpu.js`（或整合于 `entities.js`/`engine.js` 纯逻辑模块）、`src/render/fog.js`
  - **实施要点**：
    - CPU 侧为每支队伍维护 `Uint8Array(65536)`：`EXPLORED=1, VISIBLE=2, DETECTED=4`。
    - 每 Tick 重算开始时执行 `grid[i] &= 1`；单位/建筑视野圈内置 `grid[i] |= 3`；反隐/声呐/F1 卫星额外置 `grid[i] |= 4`。
    - 暴露纯粹查询接口 `isCellVisible(state, teamId, gx, gz)` 与 `isEntityTargetable(state, teamId, target)`（隐形/深潜需 `(mask & 6) === 6`）。
    - `render/fog.js` 以 `5 Hz` 上传 `DataTexture` 至 GPU，渲染未探索全黑、已探索半暗灰雾、当前可见全亮及边缘双通道过渡（`?nofog=1` 仅作视觉或显影开关）。
  - **自检门禁**：Node 单元测试证实“单位移入新格后，移走离开，原地 `grid[i]` 从 `3` 回落为 `1`（绝不掉回 `0`）”。

- **`T1.5` 次世代 WebGL2 渲染管线、紧包络 4K 软阴影与 Gerstner 海浪**
  - **输出文件**：`src/render/pipeline.js`、`src/render/pbr.js`、`src/render/shadow.js`、`src/render/water.js`
  - **实施要点**：
    - `pbr.js` 启动时通过 WebGL2 MRT/FBO 在显存烘焙 `2048×2048` 工业金属/迷彩/地形纹理集（同步封装 `assets/textures/<id>.ktx2` 异步覆盖钩子）。
    - `shadow.js` 实现单级相机紧包络正交阴影（`High/Ultra: 4096×4096`，`Balanced: 2048×2048`），对光源投影矩阵执行 **Texel-Snapping 纹素对齐** 防止镜头平移闪烁，区分“静态建筑阴影缓存 + 动态单位层”，配合半分辨率 GTAO。
    - `water.js` 合成 `4` 组 Gerstner 波并输出 `getWaterHeight(x, z, time)` 供船体纵摇采样，波高乘以 `smoothstep(0.0, 2.0, waterDepth)` 实现浅滩平滑消融与海岸白沫。
    - `pipeline.js` 实现 `52°` 俯视相机（`38°~68°`、`FOV=42°`、缩放 `14m~80m`、方向键与 `14px` 边缘滚屏、中键拖拽、`Alt+中键` 旋转、双击回正）、9 步 HDR 后处理与 AgX 色调映射。
  - **自检门禁**：浏览器打开测试图验证浅滩海浪不穿模陆地建筑、移动镜头阴影边缘无锯齿抖动。

- **`T1.6` 单 Draw Call 顶点部件驱动模型工厂、GPU 血条与弹坑池**
  - **输出文件**：`src/world/models.js`、`src/render/billboards.js`、`src/render/decals.js`
  - **实施要点**：
    - `models.js` 为 M1 核心建筑（`conyard`、`power_plant`、`refinery`、`war_factory`）与载具（`mcv`、`harvester`、`grizzly`、`rhino`）程序化生成精细多部件几何体，写入顶点属性 `aPartId`（`0`: 底盘/主体、`1`: 炮塔/转台、`2`: 炮管/采矿铲）；每种类型仅维护 **1 个 `InstancedMesh`**（每实例 `vec4 aUnitState`），配合高度自适应菲涅尔轮廓光（远景增强 `#2d7eff` / `#e83b3b`）与 `< 50% HP` 焦黑遮罩。
    - `billboards.js` 使用单个 `InstancedMesh` 一次性绘制选中圆环、分格血条、老兵标（`↑ / ★`）与矿车满载格（`0/1/2`）。
    - `decals.js` 实现 `1024` 槽环形缓冲投影贴花（履带压痕、炮弹焦坑）。
  - **自检门禁**：同屏渲染 `100` 辆坦克 + `20` 座建筑，验证渲染统计 `renderer.info.render.calls < 140`。

- **`T1.7` 宏观分片流场 + Boids 避让 (`nav.js`)**
  - **输出文件**：`src/gameplay/nav.js`
  - **实施要点**：
    - 维护 `128×128` 宏观 BFS/Dijkstra 积分场与方向向量场，分离 `LAND / SEA / AMPHIBIOUS / AIR` 四层通路代价表。
    - 新请求进入优先级队列，**每个 `30 Hz` 逻辑 Tick 严格最多计算 `<= 2` 张流场**；`16` 槽 LRU 缓存 `(targetGridX, targetGridZ, layer, mapRevision)`；断桥/建造/拆毁使对应 `mapRevision++` 触发按需重算。
    - `256×256` 局部精密占格检测 + Spatial Hash（零 GC 网格索引）提供单位防重叠 Boids 推力。
  - **自检门禁**：Node 压力测试同时派发 `20` 组不同终点寻路，单 Tick 耗时稳定 `< 0.6ms`。

- **`T1.8` M1 陆军可玩闭环集成（实体 / 生产 / 战斗 / M1 HUD）**
  - **输出文件**：`src/gameplay/entities.js`、`src/gameplay/production.js`、`src/gameplay/combat.js`、`src/ui/sidebar.js`（M1 核心页签）、`src/ui/minimap.js`、`src/core/input.js`
  - **实施要点**：
    - `entities.js`：实现 `mcv` 按 `D` 展开为 `4×4` `conyard`（校验足印平整、无障碍后激活 `18` 格建造圈）；实现 `harvester` **7 状态 FSM**（`H_IDLE -> H_SEEK_ORE -> H_MOVE_TO_ORE -> H_HARVESTING(4.0s) -> H_RETURN -> H_DOCKING -> H_UNLOADING(1.5s)`，混装 2 格按实际赤/紫晶价格累加；所属 `refinery` 被毁时切寻备选厂否则停 `H_IDLE`，新建厂时唤醒恢复）；实现 `veterancy` `0/1/2` 直接覆盖公式。
    - `production.js`：实现建造位置校验（建造厂 `18` 格 / 己方建筑 `8` 格）、电力三态计算、逐 Tick 平滑扣款（`credits === 0` 自动 `PAUSED`）、多厂加速公式与 `N === 0` 暂停及取消全额退款守卫。
    - `combat.js`：实现 `7×6` 护甲结算、CPU 视野索敌、`pendingDamage` 预约与单次幂等释放、胜负条件检测（敌方所有建筑 + MCV 归零判定胜利）。
    - `input.js`：严格实现 **4 级输入优先级栈**（弹窗拦截 > 游标放置/瞄准锁定且屏蔽 `A/S/D` > 选中态 `A/S/D` > 全局方向键/`1~9` 编队/`Q/W/E/R/T`/`L`）。
  - **M1 总结性验收**：浏览器手动及 `?bench=1` 验证整个 M1 DoD 闭环通过，Draw Calls `< 140`，控制台无错误。

---

### 阶段二（M2）：经典右栏 5 页签、基建防御、解析坍塌与无线电语音

- **`T2.1` 完整 `200px` 深钢右栏 5 页签与互动小地图**
  - **输出文件**：完善 `src/ui/sidebar.js`、`src/ui/minimap.js`
  - **实施要点**：
    - 右侧固定 `200px` Sidebar：顶部琥珀色机械跳字资金、垂直电力槽、超武倒计时占位、`180×180` 互动雷达（无雷达时显示雪花/受限信号，建成 `airforce_radar` 激活全图红蓝点与核弹警报圈；左键跳镜，右键下达行军）。
    - `[维修]`、`[变卖]`、`[秘策]`、`[语言/设置]` 功能按钮条。
    - `Q/W/E/R/T` 5 页签 Canvas 2D 图标网格（顺时针扇形进度、左键+1 / Shift+5 上限 `99`、右键暂停/取消并退款），`T` 页签内置 `[空军 | 海军]` 子过滤切换（共用 `queues.air_naval`）。
  - **自检门禁**：按 `L` 键即时切换 `zh-CN` ↔ `en-US`，所有按钮简称、Tooltip 与队列数字均正确重绘且无 CSS 溢出。

- **`T2.2` 造船厂海域放置、建筑维修/变卖与四大阵地防御塔**
  - **输出文件**：更新 `src/gameplay/production.js`、`src/gameplay/combat.js`、`src/world/models.js`
  - **实施要点**：
    - **造船厂海域校验**：`4×4` 全部格满足 `terrain === SEA` 且出海连通开放海域，中心距己方 `conyard <= 18` 格或距任一己方已建陆地建筑 `<= 12` 格。
    - **维修（`K`）与变卖（`X`）**：建筑每秒回复 `35 HP`，按原造价 `30%` 均摊每秒扣费；变卖播放倒放拆解并返还 `50%` 残值 + 生成 `1~2` 名基础步兵。
    - **防御塔逻辑**：`pillbox`（0 耗电不受停电影响）、`aa_turret`（专职防空与拦截 V3）、`prism_tower`（黄/红电或停电停机；支持最多周围协同塔向主塔汇聚激光最高放大至 `300%`）、`tesla_coil`（默认低电停机，**周围有 `>= 2` 名己方 `tesla_trooper` 贴身充能时无视停电强制开火**）。
  - **自检门禁**：Node 测试验证低电 (`<1.0`) 状态下 `pillbox` 仍开火、`prism_tower` 停火、配 `2` 名磁暴步兵的 `tesla_coil` 可继续开火。

- **`T2.3` 确定性解析抛物线碎片坍塌池 (`destruction.js`)**
  - **输出文件**：`src/world/destruction.js`
  - **实施要点**：
    - 不引入物理引擎；建筑被摧毁时从固定容量碎片池借出 `6~10` 个预拆碎片子部件，赋予基于 `prngState` 的确定性初速度 `(vx, vy, vz)` 与旋转角速度；
    - 触地（`y <= terrainHeight`）执行弹性阻尼反弹 `vy *= -0.35`，静止后释放黑烟与焦土贴花。
  - **自检门禁**：同一随机种子下建筑两次摧毁产生完全一致的碎片落点坐标。

- **`T2.4` 军用对讲机滤波音频管线与无线电立绘框**
  - **输出文件**：`src/core/mixer.js`、`src/story/dialogue.js`
  - **实施要点**：
    - `mixer.js` 严格遵循 `ctx.state === 'suspended'` 自动播放拦截预案：在主菜单首次用户点击时触发 `ctx.resume()`；
    - 串联 WebAudio `BiquadFilter(bandpass, 450Hz~2600Hz)` + `WaveShaper` + PTT 咔哒声（Squelch Click）+ 底噪，实现文本/字幕语种（`activeLocale`）与 EVA/语音语种（`voiceLocale`）双轨独立热切换，并支持 `assets/audio/voices/<locale>/<voiceId>.ogg` 热插拔覆盖。
  - **自检门禁**：无外部 `.ogg` 文件时内置合成无线电 EVA 播报零报错播放，中/英语音切换立即生效。

---

### 阶段三（M3）：全 28 种陆海空兵种与高可读性立体战场

- **`T3.1` 全 9 种步兵特种机制实现**
  - **输出文件**：更新 `src/gameplay/entities.js`、`src/gameplay/combat.js`、`src/world/models.js`
  - **实施要点**：
    - `gi`：按 `D` 切换沙袋阵地态（射程 `10m -> 15m`、伤害 `16 -> 26`、免碾压与高爆减伤）；`conscript` 占中立驻军/前锋；`flak_trooper` 陆空双防。
    - `engineer`：占领敌方建筑（保留剩余 HP 与转归我方）、占领 `oil_derrick`（立即 `+$500` + 每 `4s / 120 Tick` `+$40`）、`tech_airport`（解锁 `F2` 空降及空军维护回血）、`hospital`（`10m` 步兵持续回血）、修复 `BROKEN_BRIDGE` 与友军建筑瞬间满血。
    - `rocketeer`：`AIR` 域无视地形与水域；`Bullet` 护甲特例 `60%`。
    - `chrono`：全图可见点瞬移，硬直 `clamp(D * 0.08, 1.0, 4.0)` s；冻结目标设为 `frozenByCount++`（**移出常规相位：免疫常规攻击与治疗；`ironCurtainTicks > 0` 免疫冻结**）；`eraseProgress += 250 / 30`（多兵叠加），满 `maxHp` 直接抹除不留残骸与经验；全部锁定军团兵离开或阵亡（`frozenByCount === 0`）才解冻并重置 `eraseProgress = 0`，不修改真实 `hp`。
    - `shadow` & `sledge`（双阵营英雄，单人上限 `1` 名限制）：幽影可两栖游泳 + 贴身 C4 秒爆建筑/战舰；重锤重狙防碾压 + 反甲筒。
  - **自检门禁**：Node 单元测试重点校验：超时空兵冻结 500 HP 坦克期间坦克受普通炮击不掉血、两个超时空兵倍速抹除、一个撤走后另一个继续叠加，全部撤走恢复冻前满 500 HP。

- **`T3.2` 全 8 种陆军载具特种机制实现**
  - **输出文件**：更新 `src/gameplay/combat.js`、`src/gameplay/entities.js`、`src/world/models.js`
  - **实施要点**：
    - `ifv`：最多装载 `1` 名步兵，按乘客类型切换武器形态（空车防空导弹、载 `engineer` 为远程维修车、载 `gi` 为重机枪车、载 `chrono` 为移动光束抹除车），按 `D` 卸载。
    - `v3`：发射高抛弹道战术火箭（`interceptable = true`），飞行中若被防空击毁则触发唯一 `pendingDamage` 幂等释放（即使 V3 车已先被毁，火箭飞至中途之前绝不提前释放预约）。
    - `prism`：主激光命中后向周围裂变最多 `5` 条折射光束；同一目标同一 Tick 受 `> 3` 条次级光束时按 `0.7^{k-3}` 指数递减，全局活跃折射光束上限 `128`。
    - `apocalypse`：双门 `120mm` 对地主炮 + 对空防空导弹 + 碾压常规步兵（不碾压 `HeavyInfantry` 磁暴/幽影/重锤/展开大兵）+ 脱战缓速回血。
  - **自检门禁**：Node 测试验证 10 辆光棱同时齐射同一天启时折射伤害呈现正确边际衰减；V3 发射后立即删除发射车，在途火箭仍正常命中目标并只释放一次 `pendingDamage`。

- **`T3.3` 全 4 种空军与双出厂来源调度 (`airforce.js`)**
  - **输出文件**：`src/gameplay/airforce.js`、`src/world/models.js`
  - **实施要点**：
    - **严格按 `producerType` 区分两套系统**：
      - `stormhawk` & `crimson_mig`：`producerType = 'airforce_radar'`，占用空指部 `4` 停机坪之一；受攻击指令后起飞沿俯冲航线投弹（风暴鹰 4 枚穿甲制导总 `300`；赤刃 2 发高爆燃油航弹 `5m` 溅射总 `320`），弹尽自动返航降落停机坪补弹；所属空指部被毁时切寻空闲友方空指部，无可用坪则盘旋低速消耗至坠毁。
      - `nighthawk` & `kirov`：`producerType = 'war_factory'`，**从主战车工厂顶盖垂直升空出厂，不占用空指部停机坪**；多厂加速与 `N = 0` 暂停仅统计 `war_factory` 数量；`nighthawk` 默认雷达/普通视野隐身（需 `(mask & 6) === 6` 反隐显影或开火短暂显露），可空运最多 `5` 名步兵；`kirov` 出厂广播全图警告音效，无限重磅航弹 `360 / 2.2s`。
  - **自检门禁**：Node 测试验证 `airforce_radar` 被毁时，停机坪队列暂停而 `kirov`/`nighthawk` 在有 `war_factory` 时不受影响照常制造并升空。

- **`T3.4` 全 7 种海军舰船与反潜抢滩 (`naval.js`)**
  - **输出文件**：`src/gameplay/naval.js`、`src/world/models.js`
  - **实施要点**：
    - `hover_transport`：切换 `AMPHIBIOUS` 流场，支持沿海滩直接抢滩上下陆地（最多装载 `12` 格单位），按 `D` 全部卸载；`naval_yard` 范围内受损海军舰只自动缓速免费/低速维修。
    - `dolphin` & `sea_scorpion`：海豚高频声呐对潜 `150%` 并定期扫描显影（向所属队 `fogGrid` 写入 `DETECTED` 位 `4`）；赤蝎四联高炮补齐赤铁海军防空并附带近距反潜声呐。
    - `aegis`：垂直防空导弹 `2×65 / 0.5s`，对空特攻 `160%`（单轮 `208` 伤害，实现 `4.5s` 内击落 `2000 HP` 基洛夫）。
    - `typhoon`：默认处于 `SUBMERGED` 深潜隐形（仅受海豚/赤蝎反潜探测或 `F1` 卫星显影后对敌可见），开火瞬间短暂上浮。
    - `carrier`：内置 `4` 架舰载无人机 **5 状态机**（`D_DOCKED -> D_LAUNCHING(0.4s间隔) -> D_ATTACK_RUN -> D_RETURNING -> D_REARMING(2.5s)`），航母被击沉后尚在空中的无人机耗尽燃料坠毁（并幂等释放其未投弹的 `pendingDamage`）。
    - `dreadnought`：`40m` 超视距双联高爆巡航导弹（`2×180 / 5.5s`，对建筑触发 `135%` 覆盖倍率）。
  - **自检门禁**：Node 测试神盾单挑 `2000 HP` 基洛夫在 `<= 10` 轮（`<= 5.0s`）内完成击落；航母击沉瞬间未投弹无人机预约伤害正确清零不留负值或死锁。

- **`T3.5` X-Ray 透视剪影与全 3D 模型检阅展厅 (`?show=gallery`)**
  - **输出文件**：更新 `src/render/pipeline.js`、`src/world/models.js`
  - **实施要点**：
    - 主建筑 Pass 后追加 `gl.GREATER` 深度测试 Pass，为被高大建筑遮挡的己方与可见敌方单位绘制半透明阵营色剪影轮廓。
    - 实现 `?show=gallery` 独立模式：自由旋转检阅全部 `28` 兵种 + `21` 建筑，交互开关“红/蓝涂装”、“`< 50% HP` 战损状态”、“展开/开火动作”、“解析碎片坍塌”。
  - **自检门禁**：在 `?show=gallery` 中依次遍历全部 `49` 种实体几何，全部 0 缺模、0 WebGL Shader 编译警告，总 Draw Calls `< 140`。

---

### 阶段四（M4）：双超级武器 6s 反制窗口、三层效用 AI 与 1000× 无头平衡压测

- **`T4.1` 四大超级武器与指挥官秘策 (`superweapon.js`)**
  - **输出文件**：`src/gameplay/superweapon.js`、`src/render/pipeline.js`（超武光效与地面预警光圈）
  - **实施要点**：
    - **`chrono_sphere`（冷却 `210s`）**：选中 `3×3` 格内己方 **`GROUND` / `SEA` 机动载具**（不含建筑与任何 `AIR` 单位；步兵触及直接抹除），瞬移至目标点（水面舰船仅可落至 `SEA` 格，陆军仅可落至可行走陆地）。
    - **`iron_curtain`（冷却 `210s`）**：赋予 `3×3` 格内己方 **`GROUND` / `SEA` 机动载具及 `kirov` 空艇**（不含常规战机/`nighthawk` 与建筑；步兵触碰即死）持续 `15s`（`450 Tick`）绝对无敌护盾（`uIronCurtainOverlay` 着色器脉冲）。
    - **`weather_control`（冷却 `300s`）** & **`nuclear_silo`（冷却 `300s`）**：激活瞬间立刻广播全图语音警报并在目标点渲染 **`6s`（`180 Tick`）地面预警圈**，给予防守方使用铁幕硬抗、超时空急救转移或 `X` 变卖建筑的反制窗口；随后闪电风暴持续 `12s`（`18m` 半径随机劈下 `18` 道强雷）或核弹中心落点直击并留下 `30s`（`900 Tick`）持续伤害辐射区（写入 `state.areaEffects`）。
    - **指挥官秘策 `F1~F4`**：`F1` 侦察卫星（`20m` 半径 `15s` 写入 `VISIBLE | DETECTED` 至 `areaEffects`）、`F2` 伞兵空降（需雷达或占领科技机场）、`F3` 纳米维修波（`12m` 回血 `35%`）、`F4` EMP 轰炸（`12m` 机械载具与耗电防御塔瘫痪 `8s`）。
  - **自检门禁**：Node 测试验证“核弹发射后第 `179` Tick 开铁幕覆盖目标天启集群，第 `180` Tick 核爆落地后天启 HP 无损”。

- **`T4.2` 首发 8 张遭遇战地图蓝图与大厅菜单 (`menus.js`)**
  - **输出文件**：`src/world/skirmishMaps.js`、`src/ui/menus.js`
  - **实施要点**：
    - 编码 [PRD §7.5](PRD.md#L317-L330) 定义的全部 8 张 `256×256` 地图蓝图（2人陆港、跨海双桥、4人赤潮环形山、群岛海战、2v2 海峡大桥等）。
    - `menus.js` 实现 3D 实时战区背景主菜单、阵营/颜色/起始资金（`$5k / $10k / $30k`）/AI 席位（最多 `3` 个 AI，支持 `2v2` 组队）大厅与战后数据统计图表。
  - **自检门禁**：8 张地图蓝图均可在 `< 15ms` 内编译并通过矿车与海军通路连通性校验。

- **`T4.3` 受战争迷雾约束的三层效用 AI (`ai.js`)**
  - **输出文件**：`src/gameplay/ai.js`
  - **实施要点**：
    - **公平视野规则**：`ai.js` 仅允许读取自身 `state.fogGrids[aiPlayer.teamId]` 内的敌方单位信息，严禁全图作弊读取未探索单位坐标（仅可在既定探索矿点或遭袭位置反推索敌）。
    - **三层架构**：
      - *内政层*：电厂保绿电阈值（供电比 `< 1.1` 优先补电）、双矿车与分矿扩建、近岸自动放置 `naval_yard`（严格遵守 `SEA` 与 `<=18 / <=12` 格校验）。
      - *防御层*：受袭基地自动回防、`aa_turret`/神盾/赤蝎动态配比反制敌方空军。
      - *进攻与超武层*：多波次混编集结（标准/冷酷 AI 执行气垫船跨海奇袭、超武瞄准高价值建造厂/电厂簇，并在被核弹警告圈锁定时尝试开铁幕/超时空反制）。
  - **自检门禁**：`easy / normal / hard` 三档 AI 各跑 10 分钟无卡死队列、无死循环造电厂、无造船厂非法放置报错。

- **`T4.4` Node.js `1000×` 无头自动平衡压测器 (`scripts/balance-sim.mjs`)**
  - **输出文件**：`scripts/balance-sim.mjs`
  - **实施要点**：
    - 命令行支持多场景批跑：
      1. 微观等造价对抗基准（如 `7× rhino ($6,300) vs 9× grizzly ($6,300)`、`apocalypse vs prism`、`kirov vs aegis`），自动计算并打印**各兵种平均战损回本率（Cost Efficiency Ratio）**；
      2. 完整 `200` 场镜像随机种子海陆空 `AI vs AI` 全地图对局，输出双阵营整体胜率、平均结束时间（Tick）与超级武器使用率；
    - 目标以 `1000×` 以上速度在纯 CPU 跑完，若双阵营胜率偏离 `48% ~ 52%` 则在此阶段调优 `src/core/config.js` 并同步更新文档表格。
  - **自检门禁**：执行 `npm run sim:balance` 全流程无异常退出，生成可复现统计报告且胜率稳定收敛于 `48% ~ 52%`。

---

### 阶段五（M5）：12+1 关双线剧情战役、导演引擎与检查点存档

- **`T5.1` 声明式导演引擎 (`director.js`) 与 32 轨自适应混音**
  - **输出文件**：`src/story/director.js`、完善 `src/core/mixer.js`
  - **实施要点**：
    - 支持异步剧本时间线动作：`cameraPanTo(x, z, zoom, ms)`、`spawnWave(blueprint)`、`dialogue(speakerId, localeKey)`、`objective(key, status)`、`triggerCheckpoint(label)`；
    - 支持 `onAreaEntered / onCapture / onUnitDestroyed / onTimer / onBuildingBuilt` 声明式触发器；
    - `mixer.js` 根据最近 `5s` 战损烈度与超武警告态在“潜伏 → 行军 → 重金属战斗高潮”间交叉淡入。
  - **自检门禁**：模拟触发 `onCapture` 过场事件时 3 秒无缝运镜并自动保存检查点，结束后平顺交还相机控制权。

- **`T5.2` `IndexedDB` 解锁状态机与局内检查点完整序列化 (`save.js`)**
  - **输出文件**：`src/core/save.js`
  - **实施要点**：
    - 持久化战役外部解锁状态：`prologueCleared`（`A01` 通关同时解锁 `A02` 与 `C01`）、`abyssalCleared`、`crimsonCleared`（两者皆真时解锁 `EX13`）、每关三档最高勋章 `clearedDifficulty`、用户语种/音画偏好与自定义键位。
    - 局内检查点事务原子写入，**必须包含全部关键状态**：
      `tickCount`、`prngState`、`fogGrids`（仅持久化 `grid[i] & 1` 探索位）、`areaEffects`（F1 侦察卫星显影圈/辐射区/闪电倒计时的中心、半径、队伍与 `expiryTick`）、`entities` 完整状态（含 `eraseProgress`、`ironCurtainTicks`、`veterancy`、`cargoValue`）、`queues`、`projectiles`（含 `reservedDamage` 与 `released` 态）、`director` 触发器完成集合。
    - 读档时先恢复探索位与实体，再由实体 + 未过期 `areaEffects` 当场重算 `VISIBLE | DETECTED`；且明确**局内读取检查点不回退已持久化的外部战役解锁星图**。
  - **自检门禁**：单元测试序列化→反序列化→继续步进 1000 Tick 与未存盘连续跑 1000 Tick 的最终实体坐标、HP 与 `prngState` **100% 比特一致**。

- **`T5.3` 暗潮同盟战役《蔚蓝折光》(`A01 ~ A06`)**
  - **输出文件**：`src/story/campaigns/A01.js` ~ `A06.js`
  - **实施要点**：严格落实 `PRD §7.2` 每关特色机制——`A01` 序章抢滩与分歧抉择弹窗、`A02` 造船厂制海与神盾反基洛夫、`A03` 火箭飞行兵与夜鹰抢攻悬崖 V3、`A04` 光棱与超时空兵守紫晶谷、`A05` 超时空传送光棱斩首双核弹井、`A06` 天气控制机封印马里亚纳深渊浮岛。
  - **自检门禁**：逐关使用 `?mission=A01..A06` 启动并验证触发器、过场、胜负结算与下一关解锁逻辑。

- **`T5.4` 赤铁重工战役《赤铁洪流》(`C01 ~ C06`) 与隐藏终章 `EX-13`**
  - **输出文件**：`src/story/campaigns/C01.js` ~ `C06.js`、`src/story/campaigns/EX13.js`
  - **实施要点**：严格落实 `PRD §7.3 & §7.4`——`C01` 动员兵/犀牛破冰抢桥、`C02` 台风潜艇猎杀航母、`C03` 停电危机磁暴兵充能与基洛夫首飞、`C04` 铁幕天启强推光棱阵、`C05` 无畏战列舰跨海抢拆天气机、`C06` 核弹镇压地核暴动；以及双线通关后解锁、支持玩家同时保有同盟+赤铁双科技树与全部 4 大超武对抗 **“零号赤潮 (Abyss-0)”** 三座母巢的 `EX13`。
  - **自检门禁**：校验 `A06 + C06` 通关后才允许启动 `EX13`（除 `?mission=EX13` 开发者直跳参数外），双建造厂并发造兵与 4 超武同屏就绪无图标或快捷键冲突。

---

### 阶段六（M6）：三档画质调优、250+ 单位压测门禁与正式发行

- **`T6.1` `Ultra / High / Balanced` 自适应与 `webglcontextlost` 恢复**
  - **输出文件**：完善 `src/render/pipeline.js`、`src/render/shadow.js`、`src/render/pbr.js`
  - **实施要点**：
    - `Ultra`（`4096` 阴影+全量粒子/GTAO/AgX Bloom/多段碎片）、`High`（`1080p 60 FPS` 默认竞技档）、`Balanced`（自动降为 `2048×2048` 阴影、简化波数与 PBR Mip 常驻）。
    - 监听 `canvas` 的 `webglcontextlost` 事件立即暂停 `engine.js` 模拟循环并安全释放引用，触发 `webglcontextrestored` 后重建 `2K` 烘焙贴图、阴影 FBO 与实例化缓冲并无缝续玩。
  - **自检门禁**：使用 Chrome DevTools `WEBGL_lose_context` 扩展手动触发上下文丢失与恢复，恢复后场景完整无黑屏且状态连续。

- **`T6.2` `?bench=1` 全兵种 `250+` 单位 60 秒自动压测验收**
  - **输出文件**：`src/core/bench.js`（集成于 `engine.js` 启动参数）
  - **实施要点**：自动部署双方全海陆空 `250+` 活跃单位、同时开启水面反射、双通道战争迷雾、多建筑坍塌与弹坑生成，连续运行 `60` 秒并输出面板与控制台报告：`Avg FPS`、`P99 Frame Time`、`Sim Tick Avg (<= 2.0ms)`、`Draw Calls (< 140)`、`JS Heap Delta`。
  - **自检门禁**：`1080p High` 实机验收达到 `>= 60 FPS`、总 Draw Calls `< 140` 且无明显内存阶梯上涨。

- **`T6.3` 双语覆盖率审计与静态发行包验收**
  - **输出文件**：`scripts/check-i18n.mjs`、最终 `dist/` 构建验证
  - **实施要点**：检查全部 `zh-CN` / `en-US` 词条 100% 对等、无空白值、所有配置 `typeId` 均有对应本地化名称与描述；执行 `npm run build && npm run preview` 做离线静态部署全流程冒烟。
  - **自检门禁**：`node scripts/check-i18n.mjs`、`npm run sim:balance`、`npm run build` 三大脚本全绿通过。

---

## 4. AI Agent 自动化验收命令速查表

| 检查目标 | 阶段 | 命令 / 调试入口 | 期望通过标准 |
| :--- | :---: | :--- | :--- |
| **工程构建与零语法错误** | M1–M6 | `npm run build` | 退出码 `0`，无未解析模块或资产路径错误 |
| **无头模拟 & 平衡压测** | M4 / M6 | `npm run sim:balance` | `200` 场镜像对抗胜率在 `48% ~ 52%`，`0` 异常中断 |
| **中英词库一致性检查** | M1 / M6 | `node scripts/check-i18n.mjs` | `zh-CN` 与 `en-US` 键集 100% 匹配，无缺失兵种词条 |
| **3D 全模型与战损检阅** | M3 | `?show=gallery` | 全部 `28` 兵种 + `21` 建筑渲染完整，无 Shader 报错 |
| **战役关直跳与解锁验证** | M5 | `?mission=A01` .. `EX13`（无连字符） | 过场运镜、触发器、检查点读档与胜负结算完整闭环 |
| **全迷雾透视与快速造兵** | M1–M4 | `?nofog=1&fastbuild=1` | 用于快测 `T` 页签、4 超武预警反制窗口与防溢出逻辑 |
| **60s 大混战性能门禁** | M1 / M6 | `?bench=1` | `1080p High` 稳定 `60 FPS`，**总 Draw Calls `< 140`** |
