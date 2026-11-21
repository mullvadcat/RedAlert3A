# RedAlert3A 分层混合 3D 开发优化计划与执行台账

> 适用项目：`RedAlert3A`（墨陆：赤潮警戒 · WebGL2 RTS，共 49 个标准战斗/建筑/中立单位）  
> 核心思路：**硬表面走 Three.js 精雕 2.0，有机人体走 AI 图生 3D `.glb` + 骨骼动画**，兼顾 45° 高空俯视视觉冲击力、Web 首包加载速度与 200+ 单位满帧表现。  
> 维护规则：**每完成一个里程碑或批次，必须在同一提交内同步更新「四、里程碑完成记录台账」与「五、49 单位资产全量跟踪矩阵」。**

---

## 一、方案总览（分层混合 3D 架构）

### 1.1 双层资产分工

| 层级 | 覆盖范围 | 数量占比 | 技术路线 | 核心收益 |
| :--- | :--- | :---: | :--- | :--- |
| **Layer 1（硬表面主力 + 全局渲染底座）** | 陆军载具、空军战机、海军舰艇、基地建筑、防御塔、超级武器、中立建筑 | **40 / 49（81.6%）** | **Three.js 精雕 2.0**：专属程序化 PBR 贴图 + 倒角/旋转体/管线几何 + Rim Light + 接触阴影 + 履带滚动/后坐力/侧倾动画 | 机械与建筑天然契合参数化几何，升级后可达 80%~85% 商业 RTS 质感，零外置大图包体膨胀，250 单位稳帧运行 |
| **Layer 2（有机人体专项）** | 9 种步兵单位 | **9 / 49（18.4%）** | **AI 图生 3D（`.glb`）+ Mixamo 免费自动绑骨 + Blender 减面合包**，接入现有 `GLTFLoader` + `SkeletonUtils` + `AnimationMixer` 管线 | 彻底消除人体面部、风衣褶皱、战术装具的“积木感”；**保留现有程序化 3D 人物作为兜底回退（Graceful Fallback）** |

### 1.2 核心架构约束与工程红线

1. **严格分层隔离**：仅允许修改渲染、资源、文档层与必要的陈列室入口：
   - 允许修改：`src/render/*`、`assets/*`、`docs/*`，以及确有需要的陈列室交互逻辑（`src/main.js`）。
   - **严禁触碰纯模拟层**：`src/core/*`、`src/gameplay/*`、`src/world/map.js`、`src/locales/*`（保证战斗逻辑、寻路、数值、本地化与回放确定性零回归）。
2. **前端安全规范**：`src/**/*.js` 中严禁出现 `.innerHTML`、`.outerHTML`、`.insertAdjacentHTML`、`document.write`。
3. **版本控制纪律**：所有改动仅在本地 `main` 分支提交；未获明确指令前，**绝不执行 `git push`**。
4. **单页对照原型**：所有单位重建必须对照 [prototype_design_bible.md](file:///Users/mullvad.lu/.gemini/antigravity/brain/a7659164-ba7d-43f2-9c3d-0e764302cdbe/prototype_design_bible.md) 并在 `?show=gallery` 实机截图并排核验。

---

## 二、分阶段开发路线图（M0 ~ M6）

### M0：已完成基线（当前起点）
- **6 座核心基地建筑 1:1 精雕**：`conyard`、`war_factory`、`barracks`、`refinery`、`battle_lab`、`nuclear_reactor` 已在 [threeAssets.js](file:///Volumes/Macmini/project/3A/RedAlert3A/src/render/threeAssets.js) 重建完成（`8fd79ec`）。
- **9 种步兵程序化 3D 两轮精雕**：移除通用 Mixamo 灰人 `soldier.glb` 覆盖，完成骨架比例与低 `edgeWear` 军服材质调优（`f0a60c5`、`50518ca`）。
- **方案 B（HD-2D）试点与回退 + 渲染修复**：验证了静态 4 向精灵图无法满足 3D 动作要求并干净回退（`ef89e95`），同时保留并验证了 3 项真实修复：
  1. `gi` 沙袋部署判定修正为 `e.deployState === 'DEPLOYED' || Boolean(e.deployed)`（[threePipeline.js](file:///Volumes/Macmini/project/3A/RedAlert3A/src/render/threePipeline.js)）。
  2. 步兵血条高度 `infBarH` 抬高，避免遮挡头盔（`sledge=3.05`、`tesla_trooper=2.85`、其余 `2.55`）。
  3. 陈列室红蓝涂装切换同步更新 `ent.teamId`（[main.js](file:///Volumes/Macmini/project/3A/RedAlert3A/src/main.js)）。

### M1：Three.js 精雕 2.0 渲染底座升级
> 目标文件：`RedAlert3A/src/render/threeAssets.js`、`RedAlert3A/src/render/threePipeline.js`
1. **4 套专属程序化 PBR 贴图**（含 `diff` / `nor` / `rough`）：
   - `createRivetedArmorTextures()`：铆钉战损装甲（接缝凹槽、划痕掉漆、金属度分明，专供坦克与重装建筑）。
   - `createClothCanvasTextures()`：迷彩帆布与织物（经纬粗糙纹理与低高光反射，专供步兵过渡期军服与沙袋/帐篷）。
   - `createTankTrackTextures()`：可纵向滚动的坦克履带钢板纹路（配合 UV 偏移随移动速度实时滚动）。
   - `createIndustrialGrateTextures()`：工业防滑格栅与散热百叶（专供甲板、矿区坡道、电站冷却台）。
2. **共享高级几何构造器**：
   - 倒角装甲板构造器（基于 `THREE.ExtrudeGeometry` + bevel，消除纯 `BoxGeometry` 90° 硬角）。
   - 旋转体炮塔/罩体构造器（基于 `THREE.LatheGeometry`，用于流线炮塔、弧形穹顶、发动机喷口）。
   - 柔性管线构造器（基于 `THREE.TubeGeometry`，用于油管、电缆、液压软管与磁暴线圈绕组）。
3. **光影与打击感/动态增强**：
   - **边缘轮廓光（Rim Light Shader Hook）**：增强暗背景与战争迷雾边缘下的单位轮廓辨识度。
   - **动态接触阴影贴片（Contact Shadow）**：地面单位/建筑底部柔和压暗投影，消除悬浮感。
   - **物理与状态反馈动画**：履带 UV 随速度滚动；坦克开火炮管后坐力 + 车体微仰复位；武装采矿车前滚筒采矿旋转；战机转向实时侧倾（Bank Angle）；战术大兵 `DEPLOYED` 状态真正进入蹲姿架枪。

### M2：Phase 2A — 陆军载具 1:1 精雕（8 型）
> 对照原型图：`abyssal_units.jpg`、`crimson_units.jpg`、`roster_hero_air_support_1794749281119.jpg`
- 覆盖单位：`harvester`（武装采矿车）、`grizzly`（灰熊主战坦克）、`rhino`（犀牛主战坦克）、`ifv`（多功能步兵车）、`v3`（V3 火箭发射车）、`prism`（光棱坦克）、`apocalypse`（天启坦克）、`mcv`（机动基地车）。
- 重点对齐炮塔可转部件（`turretPivot` / `barrelPivot`）、双联装/四联装履带比例、光棱折射镜与 V3 发射架仰角机构。

### M3：Phase 2B — 空军与海军装备 1:1 精雕（11 型）
> 对照原型图：`roster_hero_air_support_1794749281119.jpg`、`roster_naval_defenses_1794749283272.jpg`、`roster_naval_defenses_1794749300619.jpg`
- **空军（4 型）**：`nighthawk`（夜鹰运输直升机）、`stormhawk`（风暴鹰攻击机）、`crimson_mig`（赤刃重型攻击机）、`kirov`（基洛夫空艇）。
- **海军（7 型）**：`hover_transport`（两栖气垫运输艇）、`dolphin`（海豚声呐艇）、`sea_scorpion`（赤蝎防空炮艇）、`aegis`（神盾防空巡洋舰）、`typhoon`（台风攻击潜艇）、`carrier`（暗潮航空母舰）、`dreadnought`（无畏级战列舰）。
- 重点保障旋翼、矢量尾喷、气垫围裙、航母甲板飞机槽位、防空导弹垂直发射井（VLS）与水线压浪细节。

### M4：Phase 3 — 剩余建筑 / 防御 / 超武 / 中立建筑 1:1 精雕（15 座）
> 对照原型图：`roster_base_buildings_1794749283473.jpg`、`roster_naval_defenses_*.jpg`、`superweapons_defenses.jpg`
- **基地建筑补完（4 座）**：`power_plant`、`naval_yard`、`airforce_radar`、`service_depot`。
- **防御设施（4 座）**：`pillbox`、`aa_turret`、`prism_tower`、`tesla_coil`。
- **超级武器（4 座）**：`chrono_sphere`、`iron_curtain`、`weather_control`、`nuclear_silo`。
- **中立建筑（3 座）**：`oil_derrick`、`tech_airport`、`hospital`。

### M5：Phase 4A — 写实步兵 `.glb` 骨骼管线就绪 & 首个试点（1 型）
1. **无遮挡 A-Pose 图集准备**：基于已有 `compare_infantry/proto_*.png`，拆分/补齐 9 个人物的纯站立无遮挡 A-Pose 制作规范（**特别规范**：`gi` 仅生成站立/手持重机枪本体，沙袋继续由 Three.js 在 `DEPLOYED` 时动态生成）。
2. **引擎骨骼加载管线升级**：
   - 在 `threeAssets.js` / `threePipeline.js` 新增 `assets/models/infantry/<id>.glb` 清单加载支持。
   - **阵营色遮罩着色/贴图染色**：支持 `.glb` 上指定材质槽位或主色区随红蓝涂装切换实时变色。
   - **自动尺寸与脚底归一化**：统一对齐游戏世界步兵身高标尺，脚底 `y = 0` 贴地无悬空/陷入。
   - **动作状态机绑定**：驱动 `Idle`（待机）、`Run`（奔跑）、`Fire`（射击）、`Deploy`（架枪/蹲姿，含 `gi` 专属动作）动画混合切换。
3. **首个试点落地**：挑选 `sledge`（重锤）或 `gi`（战术大兵），通过免费 AI 图生 3D（混元 3D / Tripo / Meshy）+ Mixamo 自动绑骨导出标准 `.glb`，完成端到端实机与战场 48 单位骨骼池测试。

### M6：Phase 4B — 全量 9 种步兵 `.glb` 替换 + 全 49 单位终验封板
- 完成其余 8 种步兵 `.glb` 导入、Blender 统一减面（目标 `3k~5k` 三角面 + `512px` 贴图 + Draco 压缩）与动作裁剪。
- 保留程序化 3D 人物构造逻辑作为加载失败/离线模式回退兜底。
- 生成全 49 单位对比总表，执行全量渲染、包体大小、M1/M6 性能帧率终验并封板。

---

## 三、每次完成的标准验收门禁与台账更新规范

### 3.1 每次必跑的 5 项验收门禁

1. **语法静态检查**：对所有变更 JS 文件执行 `node --check`。
2. **生产构建验证**：执行 `npm --prefix RedAlert3A run build`，确认 0 报错且产物完整。
3. **确定性与性能基准回归**：运行 `test:m1` 与 `test:m6`，确保每逻辑帧耗时 `<= 2.0 ms`。
4. **49 单位几何完整性审计**：运行 `verify_phases.mjs`，确认 `49/49` 单位几何体合法（无 NaN、无缺失节点、包围盒合理）。
5. **实机渲染对照审计**：在 `1440×900` Chromium 无头/真实浏览器打开 `?show=gallery`，检查红/蓝涂装切换、动画触发、控制台/WebGL/404 `0` 报错，并与概念原型图并排对比留证。

### 3.2 台账维护规范

- 每个里程碑（或拆分子批次）在全部 5 项门禁通过**之后**，必须立即在本文件完成以下更新：
  1. 在「四、里程碑完成记录台账」填入真实执行日期、关联本地 Commit、实测数据（如耗时/单位数）与对比截图路径。
  2. 在「五、49 单位资产全量跟踪矩阵」将对应单位状态推进为当前最新阶段。
  3. 将更新后的本台账文档与代码变更合并提交到本地 `main`（不自动 push）。

---

## 四、里程碑完成记录台账（Execution Ledger）

| 台账编号 | 日期 | 里程碑 | 完成内容 | 关联 Commit | 验收结果 | 对比 / 截图证据 | 状态 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `L-01` | 2026-11-21 | M0 · 核心基地建筑 | 重建 `conyard`, `war_factory`, `barracks`, `refinery`, `battle_lab`, `nuclear_reactor` 共 6 座核心建筑 1:1 贴合原型；移除违和旧 `.glb` 占位 | `8fd79ec` | build / test:m1 / test:m6 / 49 几何体全过 | `final_step_168.png`, `191.png`, `199.png` | 已完成 |
| `L-02` | 2026-11-21 | M0 · 步兵程序化 R1 | 移除通用 Mixamo 灰人覆盖，1:1 重建全部 9 种步兵程序化关节与武器挂载点 | `f0a60c5` | build / test:m1 / test:m6 / 49 几何体全过 | `compare_infantry/board_all9.png` | 已完成 |
| `L-03` | 2026-11-21 | M0 · 步兵程序化 R2 | 9 种步兵毫米级比例/护盾角度/配饰精修；新增低 `edgeWear` 军服材质消除薄片灰白反光 | `50518ca` | build / test:m1 / test:m6 / 49 几何体全过 | [infantry_comparison.md](file:///Users/mullvad.lu/.gemini/antigravity/brain/a7659164-ba7d-43f2-9c3d-0e764302cdbe/infantry_comparison.md) | 已完成 |
| `L-04` | 2026-11-21 | M0 · 验证回退与修复 | 方案 B（HD-2D）3 单位试点后因静态无 3D 动作回退；保留 GI 沙袋部署判定、血条防遮挡高度、陈列室 `teamId` 红蓝同步 3 项修复 | `ef89e95` | `node --check` / build(60模块) / m1 / m6(`0.337 ms/tick`) / 49 几何 / 0 报错全过 | `final_step_422.png`, [hd2d_demo_comparison.md](file:///Users/mullvad.lu/.gemini/antigravity/brain/a7659164-ba7d-43f2-9c3d-0e764302cdbe/hd2d_demo_comparison.md) | 已完成 / 已封档 |
| `L-05` | — | M1 · 渲染底座 2.0 | 4 套专属 PBR 贴图 + Extrude/Lathe/Tube 构造器 + Rim Light + 接触阴影 + 履带滚动/后坐力/侧倾/GI 蹲姿 | 待执行 | — | — | 待启动 |
| `L-06` | — | M2 · Phase 2A 陆军 | 8 型陆军载具 1:1 精雕与陈列室对比验收 | 待执行 | — | — | 待启动 |
| `L-07` | — | M3 · Phase 2B 空/海 | 4 型空军 + 7 型海军共 11 型装备 1:1 精雕与验收 | 待执行 | — | — | 待启动 |
| `L-08` | — | M4 · Phase 3 建筑群 | 剩余 4 基地建筑 + 4 防御 + 4 超武 + 3 中立建筑（共 15 座）1:1 精雕与验收 | 待执行 | — | — | 待启动 |
| `L-09` | — | M5 · 步兵骨骼试点 | 9 人物无遮挡 A-Pose 规范 + 骨骼 `.glb` 染色/归一化/动作状态机 + 1 型试点入库验收 | 待执行 | — | — | 待启动 |
| `L-10` | — | M6 · 全量步兵 & 封板 | 其余 8 种步兵 `.glb` 替换 + 减面压缩 + 全 49 单位终验对比归档 | 待执行 | — | — | 待启动 |

---

## 五、49 单位资产全量跟踪矩阵（Asset Tracker）

### 5.1 步兵单位（9 / 49 · 目标层：Layer 2 骨骼 `.glb`）

| 序号 | Entity ID | 官方名称 | 所属类别 | 目标方案 | 当前状态 | 关联阶段 |
| :---: | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `gi` | 战术大兵 | infantry | Layer 2（站姿本体 `.glb` + 动态 3D 沙袋） | 程序化 3D 基线完成（部署沙袋已修） | M1 + M5/M6 |
| 2 | `conscript` | 动员兵 | infantry | Layer 2（骨骼 `.glb`） | 程序化 3D 基线完成 | M1 + M5/M6 |
| 3 | `flak_trooper` | 防空步兵 | infantry | Layer 2（骨骼 `.glb`） | 程序化 3D 基线完成 | M1 + M5/M6 |
| 4 | `engineer` | 战地工程师 | infantry | Layer 2（骨骼 `.glb`） | 程序化 3D 基线完成 | M1 + M5/M6 |
| 5 | `rocketeer` | 火箭飞行兵 | infantry | Layer 2（骨骼 `.glb`） | 程序化 3D 基线完成 | M1 + M5/M6 |
| 6 | `tesla_trooper` | 磁暴步兵 | infantry | Layer 2（骨骼 `.glb`） | 程序化 3D 基线完成 | M1 + M5/M6 |
| 7 | `chrono` | 超时空军团兵 | infantry | Layer 2（骨骼 `.glb`） | 程序化 3D 基线完成 | M1 + M5/M6 |
| 8 | `shadow` | 同盟特种兵“幽影” | infantry | Layer 2（骨骼 `.glb`） | 程序化 3D 基线完成 | M1 + M5/M6 |
| 9 | `sledge` | 赤铁爆破王“重锤” | infantry | Layer 2（骨骼 `.glb`） | 程序化 3D 基线完成 | M1 + M5/M6 |

### 5.2 陆军载具（8 / 49 · 目标层：Layer 1 精雕 2.0）

| 序号 | Entity ID | 官方名称 | 所属类别 | 目标方案 | 当前状态 | 关联阶段 |
| :---: | :--- | :--- | :--- | :--- | :--- | :--- |
| 10 | `harvester` | 武装采矿车 | vehicle | Layer 1（精雕 2.0 + 采矿滚筒旋转） | 待重建 | M2 |
| 11 | `grizzly` | 灰熊主战坦克 | vehicle | Layer 1（精雕 2.0 + 履带滚动/炮管后坐） | 待重建 | M2 |
| 12 | `rhino` | 犀牛主战坦克 | vehicle | Layer 1（精雕 2.0 + 履带滚动/炮管后坐） | 待重建 | M2 |
| 13 | `ifv` | 多功能步兵车 | vehicle | Layer 1（精雕 2.0 + 轮式底盘细节） | 待重建 | M2 |
| 14 | `v3` | V3 火箭发射车 | vehicle | Layer 1（精雕 2.0 + 弹体仰角机构） | 待重建 | M2 |
| 15 | `prism` | 光棱坦克 | vehicle | Layer 1（精雕 2.0 + 棱镜发光阵列） | 待重建 | M2 |
| 16 | `apocalypse` | 天启坦克 | vehicle | Layer 1（精雕 2.0 + 双炮管/四履带） | 待重建 | M2 |
| 17 | `mcv` | 机动基地车 | vehicle | Layer 1（精雕 2.0 + 重型折叠吊臂） | 待重建 | M2 |

### 5.3 空军单位（4 / 49 · 目标层：Layer 1 精雕 2.0）

| 序号 | Entity ID | 官方名称 | 所属类别 | 目标方案 | 当前状态 | 关联阶段 |
| :---: | :--- | :--- | :--- | :--- | :--- | :--- |
| 18 | `nighthawk` | 夜鹰运输直升机 | air | Layer 1（精雕 2.0 + 旋翼/侧倾） | 待重建 | M3 |
| 19 | `stormhawk` | 风暴鹰攻击机 | air | Layer 1（精雕 2.0 + 矢量翼/侧倾） | 待重建 | M3 |
| 20 | `crimson_mig` | 赤刃重型攻击机 | air | Layer 1（精雕 2.0 + 前掠翼/尾焰） | 待重建 | M3 |
| 21 | `kirov` | 基洛夫空艇 | air | Layer 1（精雕 2.0 + 飞艇艇身/吊舱） | 待重建 | M3 |

### 5.4 海军单位（7 / 49 · 目标层：Layer 1 精雕 2.0）

| 序号 | Entity ID | 官方名称 | 所属类别 | 目标方案 | 当前状态 | 关联阶段 |
| :---: | :--- | :--- | :--- | :--- | :--- | :--- |
| 22 | `hover_transport` | 两栖气垫运输艇 | naval | Layer 1（精雕 2.0 + 气垫围裙） | 待重建 | M3 |
| 23 | `dolphin` | 海豚声呐艇 | naval | Layer 1（精雕 2.0 + 声呐发射器） | 待重建 | M3 |
| 24 | `sea_scorpion` | 赤蝎防空炮艇 | naval | Layer 1（精雕 2.0 + 多管防空炮塔） | 待重建 | M3 |
| 25 | `aegis` | 神盾防空巡洋舰 | naval | Layer 1（精雕 2.0 + 相控阵/VLS 垂发） | 待重建 | M3 |
| 26 | `typhoon` | 台风攻击潜艇 | naval | Layer 1（精雕 2.0 + 指挥塔围壳） | 待重建 | M3 |
| 27 | `carrier` | 暗潮航空母舰 | naval | Layer 1（精雕 2.0 + 飞行甲板/舰载机） | 待重建 | M3 |
| 28 | `dreadnought` | 无畏级战列舰 | naval | Layer 1（精雕 2.0 + 双巨型导弹发射井） | 待重建 | M3 |

### 5.5 基地建筑（10 / 49 · 目标层：Layer 1 精雕 2.0）

| 序号 | Entity ID | 官方名称 | 所属类别 | 目标方案 | 当前状态 | 关联阶段 |
| :---: | :--- | :--- | :--- | :--- | :--- | :--- |
| 29 | `conyard` | 建造厂 | building | Layer 1（精雕 2.0） | 1:1 精雕基线完成（`8fd79ec`，待 M1 材质/光影增益） | M0 -> M1 |
| 30 | `power_plant` | 发电厂 / 磁能反应炉 | building | Layer 1（精雕 2.0） | 待重建 | M4 |
| 31 | `nuclear_reactor` | 核子反应堆 | building | Layer 1（精雕 2.0） | 1:1 精雕基线完成（`8fd79ec`，待 M1 材质/光影增益） | M0 -> M1 |
| 32 | `refinery` | 矿石精炼厂 | building | Layer 1（精雕 2.0） | 1:1 精雕基线完成（`8fd79ec`，待 M1 材质/光影增益） | M0 -> M1 |
| 33 | `barracks` | 兵营 | building | Layer 1（精雕 2.0） | 1:1 精雕基线完成（`8fd79ec`，待 M1 材质/光影增益） | M0 -> M1 |
| 34 | `war_factory` | 战车工厂 | building | Layer 1（精雕 2.0） | 1:1 精雕基线完成（`8fd79ec`，待 M1 材质/光影增益） | M0 -> M1 |
| 35 | `naval_yard` | 造船厂 | building | Layer 1（精雕 2.0） | 待重建 | M4 |
| 36 | `airforce_radar` | 空指部 / 雷达站 | building | Layer 1（精雕 2.0） | 待重建 | M4 |
| 37 | `service_depot` | 维修车间 | building | Layer 1（精雕 2.0） | 待重建 | M4 |
| 38 | `battle_lab` | 作战实验室 | building | Layer 1（精雕 2.0） | 1:1 精雕基线完成（`8fd79ec`，待 M1 材质/光影增益） | M0 -> M1 |

### 5.6 防御设施 / 超级武器 / 中立建筑（11 / 49 · 目标层：Layer 1 精雕 2.0）

| 序号 | Entity ID | 官方名称 | 所属类别 | 目标方案 | 当前状态 | 关联阶段 |
| :---: | :--- | :--- | :--- | :--- | :--- | :--- |
| 39 | `pillbox` | 机枪碉堡 / 哨戒炮 | defense | Layer 1（精雕 2.0） | 待重建 | M4 |
| 40 | `aa_turret` | 爱国者导弹 / 高射炮 | defense | Layer 1（精雕 2.0） | 待重建 | M4 |
| 41 | `prism_tower` | 光棱塔 | defense | Layer 1（精雕 2.0） | 待重建 | M4 |
| 42 | `tesla_coil` | 磁暴线圈 | defense | Layer 1（精雕 2.0 + 柔性铜线圈） | 待重建 | M4 |
| 43 | `chrono_sphere` | 超时空传送仪 | superweapon | Layer 1（精雕 2.0） | 待重建 | M4 |
| 44 | `iron_curtain` | 铁幕装置 | superweapon | Layer 1（精雕 2.0） | 待重建 | M4 |
| 45 | `weather_control` | 天气控制机 | superweapon | Layer 1（精雕 2.0） | 待重建 | M4 |
| 46 | `nuclear_silo` | 核弹发射井 | superweapon | Layer 1（精雕 2.0 + 井盖开合部件） | 待重建 | M4 |
| 47 | `oil_derrick` | 科技钻油井 | neutral | Layer 1（精雕 2.0 + 抽油摇臂动作） | 待重建 | M4 |
| 48 | `tech_airport` | 科技机场 | neutral | Layer 1（精雕 2.0） | 待重建 | M4 |
| 49 | `hospital` | 战地医疗站 | neutral | Layer 1（精雕 2.0） | 待重建 | M4 |

---

## 六、风险与回退预案

1. **包体体积控制**：
   - Layer 1 全走程序化 PBR 与参数化几何，几乎零磁盘资产增长。
   - Layer 2 的 9 个步兵 `.glb` 统一经 Blender 减面（单模型 `3k~5k` 面、`512×512` 贴图 + Draco 压缩），整套步兵增量体积控制数 MB 级别，保证网页首屏秒开。
2. **骨骼动画性能预算（48 单位上限）**：
   - 现有 `threePipeline.js` 已约束每帧仅对距离镜头最近的 `48` 个骨骼实体驱动 `AnimationMixer`。
   - 超出该距离窗口的步兵自动降级为静止待机或简易平移/回退程序化实例，保证 200+ 单位团战流畅。
3. **图生 3D 红蓝阵营涂装不统一**：
   - 接入 `.glb` 时优先在着色器或材质克隆阶段对护甲/肩甲/风衣主色区做阵营色叠加/色相映射（保留皮肤、金属枪械、皮靴原始质感）。
   - 若某些模型缺少干净区域划分，则在 Blender 快速划出独立 `team_trim` 材质槽位即可秒级适配多阵营。
4. **`gi`（战术大兵）沙袋分离制作规范**：
   - 送入图生 3D 的 `gi` 原图必须**剔除底部沙袋掩体、仅保留无遮挡双脚站立 A-Pose 人物本体**；沙袋仍由 Three.js 程序化材质在 `deployState === 'DEPLOYED'` 时动态生成，并配合 `Deploy` 蹲姿动画片断完成架枪切换。
5. **渐进式回退能力**：
   - 若某个 `.glb` 在实机表现出现骨骼穿模、破面或加载异常，资产工厂自动无缝回退至对应单位的 M0/M1 程序化 3D 骨架，不影响游戏正常开局与构建验证。
