# RedAlert3A 设计文档权威索引与命名字典 (`docs/`)

本目录承载《墨陆：赤潮警戒》v2.2 全套设计规格、AI 工程开发计划与概念图鉴（[`PRD.md`](PRD.md)、[`SDD.md`](SDD.md)、[`DEVELOPMENT_PLAN.md`](DEVELOPMENT_PLAN.md)、[`assets/`](assets/)）。

---

## 1. 文档权威裁决与真理源声明

当多份文档或后续代码实现出现理解分歧时，严格按以下优先级裁决（Conflict Resolution）：

1. **玩法设计、键位规则、战役剧本与内容体量**：以 [`PRD.md`](PRD.md)（v2.2）为准；游戏落地后，所有兵种/建筑/护甲数值的**运行时唯一真理源（Single Source of Truth）** 为规划中的 `src/core/config.js`，文档表格应与其保持同步。
2. **渲染方案、性能预算、模拟架构与工程决策**：以 [`SDD.md`](SDD.md)（v2.2）为准；SDD 对技术方案的优化决策（如以紧包络单级 PCSS 替代 4 级联 CSM、Draw Call `< 140` 门禁、解析抛物线碎片替代第三方物理引擎）优先于早期需求措辞，并已同步回写 [`PRD.md`](PRD.md) v2.2。
3. **性能/平衡目标数字的阶段定位**：在 `scripts/balance-sim.mjs` 与 `?bench=1` 实机压测落地前，文档中提到的胜率区间（`48%–52%`）、TTK 锚点与帧耗时预算均属于**设计基线目标（Target Baseline）**，将在 M4/M6 落地后通过实测调优收敛。

---

## 2. 统一专有名词与规划内部 ID 对照表（Canonical Nomenclature）

为防止设计文档、i18n 词库（`zh-CN` / `en-US`）与后续 `src/core/config.js` 出现别名分裂（例如历史上曾误写作“红刀”，现已统一规范为 **赤刃 / `crimson_mig`**），全项目统一使用下表命名（内部 ID 为 `config.js` 规划键名）：

### 2.1 阵营与核心角色
| 中文标准名 | English Name | 规划内部 ID | 备注 |
| :--- | :--- | :--- | :--- |
| 暗潮同盟 | Abyssal Pact | `abyssal` | 蔚蓝科技阵营（`#2d7eff`） |
| 赤铁重工 | Crimson Foundry | `crimson` | 赤红重装阵营（`#e83b3b`） |
| 零号赤潮 | Abyss-0 | `abyss0` | EX-13 隐藏终极威胁 |

### 2.2 步兵（9 种：7 基础/高科 + 2 阵营英雄）
| 中文标准名 | English Name | 规划内部 ID | 阵营归属 |
| :--- | :--- | :--- | :---: |
| 战术大兵 | GI | `gi` | 暗潮同盟 |
| 动员兵 | Conscript | `conscript` | 赤铁重工 |
| 防空步兵 | Flak Trooper | `flak_trooper` | 通用 |
| 战地工程师 | Engineer | `engineer` | 通用 |
| 火箭飞行兵 | Rocketeer | `rocketeer` | 暗潮同盟 |
| 磁暴步兵 | Tesla Trooper | `tesla_trooper` | 赤铁重工 |
| 超时空军团兵 | Chrono | `chrono` | 暗潮同盟 |
| 同盟特种兵“幽影” | Shadow | `shadow` | 暗潮同盟（限 1） |
| 赤铁爆破王“重锤” | Sledge | `sledge` | 赤铁重工（限 1） |

### 2.3 陆军载具（8 种）
| 中文标准名 | English Name | 规划内部 ID | 阵营归属 |
| :--- | :--- | :--- | :---: |
| 武装采矿车 | Ore Miner (Harvester) | `harvester` | 通用 |
| 灰熊主战坦克 | Grizzly Tank | `grizzly` | 暗潮同盟 |
| 犀牛主战坦克 | Rhino Tank | `rhino` | 赤铁重工 |
| 多功能步兵车 | IFV | `ifv` | 暗潮同盟 |
| V3 火箭发射车 | V3 Rocket Launcher | `v3` | 赤铁重工 |
| 光棱坦克 | Prism Tank | `prism` | 暗潮同盟 |
| 天启坦克 | Apocalypse Tank | `apocalypse` | 赤铁重工 |
| 机动基地车 | MCV | `mcv` | 通用 |

### 2.4 空军与海军（4 空军 + 7 海军）
| 中文标准名 | English Name | 规划内部 ID | 类别 / 阵营 |
| :--- | :--- | :--- | :---: |
| 夜鹰运输直升机 | Nighthawk | `nighthawk` | 空军 / 通用 |
| 风暴鹰攻击机 | Stormhawk | `stormhawk` | 空军 / 暗潮同盟 |
| 赤刃重型攻击机 | Crimson MiG | `crimson_mig` | 空军 / 赤铁重工（禁用“红刀”别名） |
| 基洛夫空艇 | Kirov Airship | `kirov` | 空军 / 赤铁重工 |
| 两栖气垫运输艇 | Amphibious Transport | `hover_transport` | 海军 / 通用 |
| 海豚声呐艇 | Dolphin | `dolphin` | 海军 / 暗潮同盟 |
| 赤蝎防空炮艇 | Sea Scorpion | `sea_scorpion` | 海军 / 赤铁重工 |
| 神盾防空巡洋舰 | Aegis Cruiser | `aegis` | 海军 / 暗潮同盟 |
| 台风攻击潜艇 | Typhoon Sub | `typhoon` | 海军 / 赤铁重工 |
| 暗潮航空母舰 | Abyssal Carrier | `carrier` | 海军 / 暗潮同盟 |
| 无畏级战列舰 | Dreadnought | `dreadnought` | 海军 / 赤铁重工 |

### 2.5 核心建筑、防御塔、超级武器与中立建筑（10 基地建筑 + 8 防御/超武 + 3 中立占领建筑）
| 中文标准名 | English Name | 规划内部 ID | 类别 |
| :--- | :--- | :--- | :---: |
| 建造厂 | Construction Yard | `conyard` | 基地建筑 |
| 发电厂 / 磁能反应炉 | Power Plant | `power_plant` | 电力建筑 |
| 核子反应堆 | Nuclear Reactor | `nuclear_reactor` | 赤铁电力建筑 |
| 矿石精炼厂 | Ore Refinery | `refinery` | 经济建筑 |
| 兵营 | Barracks | `barracks` | 生产建筑 |
| 战车工厂 | War Factory | `war_factory` | 生产建筑 |
| 造船厂 | Naval Yard | `naval_yard` | 海军生产建筑 |
| 空指部 / 雷达站 | Airforce & Radar | `airforce_radar` | 雷达与停机坪 |
| 维修车间 | Service Depot | `service_depot` | 维护与 MCV 前置 |
| 作战实验室 | Battle Lab | `battle_lab` | 高科解锁建筑 |
| 机枪碉堡 / 哨戒炮 | Pillbox / Sentry Gun | `pillbox` | 基础防御塔 |
| 爱国者导弹 / 高射炮 | Patriot / Flak Cannon | `aa_turret` | 防空防御塔 |
| 光棱塔 | Prism Tower | `prism_tower` | 同盟高科防御 |
| 磁暴线圈 | Tesla Coil | `tesla_coil` | 赤铁高科防御 |
| 超时空传送仪 | Chrono Sphere | `chrono_sphere` | 同盟战术超武 |
| 铁幕装置 | Iron Curtain | `iron_curtain` | 赤铁战术超武 |
| 天气控制机 | Weather Control | `weather_control` | 同盟终极超武 |
| 核弹发射井 | Nuclear Silo | `nuclear_silo` | 赤铁终极超武 |
| 科技钻油井 | Tech Oil Derrick | `oil_derrick` | 中立可占领经济建筑 |
| 科技机场 | Tech Airport | `tech_airport` | 中立可占领空降建筑 |
| 战地医疗站 | Field Hospital | `hospital` | 中立可占领步兵回血建筑 |

> **关卡编号约定**：UI 与叙事文本显示为 **`A-01`~`A-06` / `C-01`~`C-06` / `EX-13`**；程序剧本文件名、IndexedDB 存档键与 URL 调试参数（`?mission=`）统一采用无连字符格式 **`A01`~`A06` / `C01`~`C06` / `EX13`**。

---

## 3. 文档演进历史（Changelog）

- **v2.3（M1–M6 代码落地与进度台账同步 · 2026-11-15）**：
  - 完成 M1–M6 全 28 项原子任务编码落地（提交 `7af7bd9` → `c3bd208`），`test:m1`–`test:m6`、`sim:balance`（`1058.7x` / `51.50% vs 48.50%`）、`check:i18n`（342 词条 / 49 实体）与 `build`（`54` 文件 `609.3 KB`）全绿通过；
  - 在 [`DEVELOPMENT_PLAN.md`](DEVELOPMENT_PLAN.md) 新增 **§5 研发进度与验收台账** 并同步根目录 [`README.md`](../README.md) 状态及启动脚本口径（待完成项目为真机浏览器 WebGL2 E2E 终验与可选外部 `.glb/.ktx2` 美术精修）。
- **v2.2（全文档对齐定稿）**：
  - 按评审清单完成 [`PRD.md`](PRD.md)、[`SDD.md`](SDD.md) 与根目录 [`README.md`](../README.md) 跨文档对齐并建立统一命名对照字典；
  - 统一图形验收口径：删除 CSM / `< 180` / “物理碎裂” 旧表述，对齐为 **紧包络单级 4K/2K 纹素对齐 PCSS + GTAO、Draw Calls `< 140`、确定性解析抛物线碎片坍塌**；
  - 消除 PRD 阻塞级设计缺陷：消除 `W/A/S/D` 镜头平移与单位指令快捷键冲突并明确输入优先级栈；修正老兵等级编号为 `0/1/2`；补充 Sidebar 5 页签与 5 生产队列（含 `T` 页签共用 `air_naval`）1:1 对照表；补充 `A-01` 分歧与 `EX-13` 存档解锁状态机；补充项目非目标边界（Out of Scope）与 M1 垂直切片完成定义（DoD）；统一“赤刃”名称与 `9` 步兵数量口径，并在 SDD 补充工程风险登记表；
  - 深化 `30 Hz` 确定性模拟契约：全仿真逻辑与渲染帧率解耦（`<= 2` 张流场/Tick、逐逻辑 Tick 扣款）；补齐 CPU 位掩码视野网格（`EXPLORED/VISIBLE/DETECTED`）、`pendingDamage` 投射物幂等预约释放、$N \ge 1$ 兼容生产建筑防零除守卫与造船厂 `SEA` 放置规则；统一神盾面板（`2×65 / 0.5s`）、基洛夫空甲、`SuperHeavy + Structure` 护甲覆盖倍率与 `playerId/teamId/factionId` 多人/双科技树归属；
  - 补全最终实现细节：`grid[i] |= 3` 首次探索置位、按单位 `producerType` 区分战车厂系（夜鹰/基洛夫）与空指部系（风暴鹰/赤刃）出厂与加速归属、超时空军团兵抹除/矿柱再生/老兵减伤公式，以及存档快照保留侦察卫星等活跃区域效果。
- **v2.1（双语与高平衡迭代）**：引入默认内置中/英（`zh-CN` / `en-US`）多语种与语音独立热切换；补充 **赤蝎防空炮艇** 与 **赤刃重型攻击机** 补齐赤铁海空短板；补齐建筑表格、老兵晋升与 8 张遭遇战地图池。
- **v2.0（突破 2MB 限制重构）**：放弃单 HTML `< 2 MB` 体积约束，全面转向 Vite 模块化 + 混合高精度 3D 资产管线与 12+1 关连续剧情战役。
- **v1.0（初始立项）**：建立独立仓库 `RedAlert3A` 并生成 4 套兵种与超武概念图鉴。
