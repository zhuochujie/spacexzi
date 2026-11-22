# SpaceXZI 项目部署

部署入口：Foundry 原生 Solidity 脚本 `script/Deploy.s.sol:DeployScript`，直接使用 `forge script` 执行。

一次部署 9 个合约：SpaceXZIToken、主金库、节点分红金库、VIP 分红金库、回购分红金库、Mining、TokenExchange、NodeMembership、BuybackPool。回购买卖直接通过 BuybackPool，不使用充值网关或 Mining.deposit。

## 配置

在 `mining/core` 下复制 `.env.example` 为 `.env`，填写：

- `CHAIN_NETWORK`：网络名称，预设为 bsc、bscTestnet、anvil。网络元数据集中在 mining/core/config/networks.ts。`CHAIN_RPC_URL` 仅用于可选覆盖默认RPC。
- `PRIVATE_KEY`：部署账户私钥。
- `SIGNER_ADDRESS`：三个业务合约统一使用的后端签名者，对应 server 的 SIGNER_PRIVATE_KEY。
- `MARKET_FEE_RECEIVER_ADDRESS`、`NODE_TREASURY_ADDRESS`：市场费用接收账户和节点预售款接收账户。
- `USDT_TOKEN_ADDRESS`：已有的 18 位精度 USDT 合约。当前平台计算采用 18 位精度，脚本会校验。
- `BUYBACK_BUY_PRICE_WEI`、`BUYBACK_SELL_PRICE_WEI`：回购固定买价、卖价，买价必须大于卖价且均为正数，必须在部署前填写。
- `BUYBACK_FIXED_RECEIVER_ADDRESS`：买入 USDT 的 20% 接收地址。
- `INITIAL_BUYBACK_SPACE_WEI`：回购池初始库存，默认 2,000,000 枚 SPACE（2000000000000000000000000 wei），从发行总量中划拨，剩余代币进入主 Vault。
- 可选 `INITIAL_BUYBACK_USDT_WEI`：初始回购 USDT 储备，从部署钱包转入，默认 0。
- 可选 `OWNER_ADDRESS`：全部合约配置完成后统一转交此账户管理；未配置时保留部署账户为 owner。
- 可选 `USDT_FEE_RECEIVER_ADDRESS`：默认与市场费用接收账户相同。

市场价格、手续费、免费矿机金额、节点等级名称/价格/启用状态都可以通过 env 设置。金额均为最小单位；节点默认四档为 Starter/Core/Elite/Prime，价格为 100/500/1000/2000 USDT。脚本校验价格递增、链 ID、地址、代币合约和精度后才开始部署。

脚本会配置 SPACE 白名单，从 10 亿 SpaceXZI 中分配配置的初始回购库存，剩余转入主金库，并授权 Mining 调用金库资金，并授权回购池更新 TokenExchange 的免手续费额度。SPACE 转账的市场费用进入 MARKET_FEE_RECEIVER_ADDRESS，节点费用进入节点分红金库。回购买卖默认开启，可用 BUYBACK_PAUSED 配置暂停；节点购买可用 NODE_PURCHASE_PAUSED 配置暂停状态。

## 使用 Foundry 执行

USDT 地址变化时，在 `mining/core` 目录执行：

```bash
python3 scripts/set-usdt-address.py <USDT合约地址>
```

脚本同步 core、server 的 `USDT_TOKEN_ADDRESS` 和 web 的 `VITE_USDT_TOKEN_ADDRESS`，更新已有的 `.env` 与 `.env.example`，缺失文件不创建，其他配置及注释保留。加 `--dry-run` 可只预览文件列表。它只修改环境配置，不修改已部署合约绑定的 USDT；完整部署结果仍使用下文的导出脚本同步。

所有命令均在 `mining/core` 目录执行。先复制 `.env.example` 为 `.env` 并填写参数。Foundry 会加载项目 `.env`；脚本通过 `vm.envUint` / `vm.envAddress` / `vm.envOr` 读取配置。

脚本根据 CHAIN_NETWORK 从生成的 config/networks.json 读取链ID及默认RPC，调用 createSelectFork 选择网络；无需命令行重复指定RPC。

仅模拟，不发送交易：

```bash
forge script script/Deploy.s.sol:DeployScript
```

正式广播：

```bash
forge script script/Deploy.s.sol:DeployScript --broadcast --slow
```

需要覆盖RPC时，在env中填写CHAIN_RPC_URL；脚本仍会校验实际链ID与所选网络一致。

只部署节点合约（同样初始化四档节点）：

```bash
forge script script/DeployNodeMembership.s.sol:DeployNodeMembershipScript --broadcast --slow
```

中断后可使用 Foundry 的 `--resume` 恢复原交易计划。恢复模式不会重新执行 Solidity 脚本，因此需要显式提供同一部署钱包；例如使用已导入该钱包的 Foundry keystore：

```bash
forge script script/Deploy.s.sol:DeployScript --rpc-url <目标网络RPC> --broadcast --resume --account deployer
```

上例要求 keystore 中已经存在名为 deployer 的账户，并且与 PRIVATE_KEY 对应的部署地址一致。保持原链和广播记录，避免重新执行一次全新部署。

## 部署结果

Foundry 会在控制台打印地址，并将实际交易及收据保存至 `broadcast/Deploy.s.sol/<chainId>/run-latest.json`。不加 --broadcast 的模拟结果位于 dry-run 目录。

成功广播后运行下方 Python 工具。它读取成功部署收据，生成配置片段，并自动回填四个应用项目的 `.env.example`，不发送交易。输出目录：`deployments/<chainId>/run-<timestamp>/`。

- `deployment.json`：部署者、owner、签名者、金库、业务地址和市场起始区块。
- `server.env`：合并到 server/.env 的公开地址配置。
- `web.env`：合并到 web/.env 的 VITE_ 地址配置。
- `admin.env`：管理端回购池地址配置，概览由管理端直读合约。
- `indexer.env`：市场索引地址、网络名、BUYBACK_POOL_ADDRESS 和市场部署区块 START_BLOCK。

脚本自动更新 server/web/admin-web/market-indexer 的 `.env.example` 中的网络名、公开合约地址和索引起始区块，不修改core部署示例。保留数据库、Redis、API、私钥等其他配置及注释。已存在的 `.env` 也会同步更新，不存在则不创建；core 的 `.env` 不修改。更新后重新构建前端并重启服务。

导出并同步配置（以下以 BSC 链 ID 56 为例，测试网为 97，本地链为 31337）：

```bash
python3 scripts/export-deployment.py broadcast/Deploy.s.sol/56/run-latest.json
```

脚本拒绝 dry-run、未完成或失败的记录；验证不通过不会更新示例。部署输出不包含私钥。若只需生成配置片段、不更新 `.env.example` 和 `.env`，在命令后加 `--no-update-examples`。

## 回购相关配置

部署应用前确认使用同一环境的合约地址。回购分红 Vault 必须授权 Mining 使用 USDT，部署脚本已完成授权；回购池必须同时加入 SPACE 白名单及 TokenExchange 可信来源。

## 矿机支付

Mining.purchaseMiner 仅支持 SpaceXZI 支付，参数为 minerId、price、payValue、expectedReward、nonce、deadline、signature。payValue 为钱包实际支付的 SpaceXZI，不得超过 price；账户余额和组合支付继续由后端预扣相应 SpaceXZI。已移除 paymentToken 及 USDT 购买配额，USDT 分红和提现不受影响。更新后需部署新版 Mining，并同步交易 ABI。

免费矿机新部署默认 `FREE_MINER_SPACE_AMOUNT_WEI=50000000000000000000`（总产出上限50枚）。该数量是Mining构造参数，不由后台收益价值配置决定。后台免费矿机价值默认10枚。

网络配置和应用启动步骤见下文。

## 节点推荐奖励统一至Mining

新版NodeMembership增加构造参数mining，购买及升级按后端签名的rewardAmount转至该Mining（后台NODE_REFERRAL_REWARD_BP配置，默认15%），后台确认nonce后计入个人USDT余额。原节点独立claimReward已删除。完整部署自动绑定；单独执行DeployNodeMembership.s.sol时需填写已有MINING_CONTRACT_ADDRESS，且USDT须相同。此功能需要新版节点合约，旧版不能仅靠更换ABI升级。全新部署使用空业务数据库；旧链上状态不会因清空数据库而重置。


## 应用目录与部署顺序

本仓库包含 mining/core（合约）、mining/server（用户 API、管理 API、Worker）、mining/market-indexer（链上索引）、mining/web（用户前端）和 mining/admin-web（管理前端）。

先准备 PostgreSQL、Redis 和目标链 RPC，配置环境文件；部署合约并导出地址；初始化业务数据库；启动索引器、用户 API、管理 API 和一个 Worker；最后构建并托管两个前端。

每个应用在自己的目录执行 `npm ci`，并将 `.env.example` 复制为 `.env`。部署信息导出前先创建需要同步的 `.env`。示例中的地址和网络可能来自本地部署，必须核对本次目标环境。各应用需填写的配置项及中文注释以各自 `.env.example` 为准。

## 网络与签名者

core、server、market-indexer 设置 `CHAIN_NETWORK`；两个前端设置 `VITE_CHAIN_NETWORK`。可选 bsc（56）、bscTestnet（97）、anvil（31337）。需要覆盖默认 RPC 时设置 `CHAIN_RPC_URL`，前端设置 `VITE_CHAIN_RPC_URL`。索引器可选 `CHAIN_WS_URL`。

链配置唯一来源为 `mining/core/config/networks.ts`。新增或修改网络后，安装 server 依赖并在 mining 目录执行：

```bash
node core/scripts/sync-chain-config.cjs
```

生成的应用链配置和 core/config/networks.json 不要手工修改。切换链时应使用独立业务数据库、Redis/队列和索引 schema，并同步所有合约地址。本地链先启动 Anvil、部署 18 位精度测试 USDT 并填入 core/.env。

server 的 `SIGNER_PRIVATE_KEY` 对应地址必须与合约部署时的 `SIGNER_ADDRESS` 一致。私钥、数据库密码、JWT 密钥和内部 API 密钥只放在服务端实际环境文件中；任何 `VITE_` 配置都会进入浏览器构建产物。

## 首次初始化业务数据库

以下步骤仅适用于空业务数据库，执行目录为 mining/server。

1. 填写 `.env` 中 PostgreSQL、Redis、JWT、签名私钥、合约地址和索引器地址。
2. 临时设置 `TYPEORM_SYNCHRONIZE=true`，构建并启动一次用户 API：

```bash
npm ci
npm run build
npm run start:user
```

用户 API 会创建实体表，并补齐默认配置、矿机、内置账户和分红规则。停止用户 API，将 `TYPEORM_SYNCHRONIZE` 改回 `false`，不要对已有生产数据使用自动同步。

3. 使用连接到目标业务数据库的 psql，在 mining/server 目录安装以下五个函数/存储过程：

```sql
\i sql/compute_commission_level.sql
\i sql/recompute_vip_levels.sql
\i sql/distribute_miner_rewards.sql
\i sql/accelerate_account_miner_reward.sql
\i sql/batch_accelerate_account_miners.sql
```

它们不会由实体自动创建；安装定义不会立即发放收益。`move_account_subtree.sql` 是可选手工维护工具，不属于初始化步骤。

`sql/clear_data.sql` 会清空全部 server 数据，包括管理员、配置和矿机档位，并重置自增 ID。仅需重置环境时手工使用，执行前停止所有 API 和 Worker；不清理链上数据、索引器或 Redis。

## 启动市场索引器

在 mining/market-indexer 目录配置 `.env`：数据库连接 `DATABASE_URL`、独立的 `DATABASE_SCHEMA`、网络、合约地址、`START_BLOCK`，以及与 server 完全相同的 `MARKET_INDEXER_INTERNAL_API_KEY`。

```bash
npm ci
npm run start
```

请通过项目 npm 脚本启动，以便在索引器初始化前加载 `.env`，无需 `.env.local`。开发模式使用 `npm run dev`；修改环境文件后重启。确认索引器能访问目标 RPC 并完成目标区块同步。

## 启动后端

在 mining/server 目录分别运行三个常驻进程：

```bash
npm run start:user
npm run start:admin
npm run start:worker
```

用户 API 默认使用 3000 端口，管理 API 默认 3001，实际以环境配置为准。三者使用同一业务数据库和 Redis。用户 API 负责默认数据初始化，不能只启动管理 API 或 Worker。

管理 API 首次启动时按 `ADMIN_USERNAME`、`ADMIN_PASSWORD` 创建管理员；已有账户不会因修改这两个变量自动覆盖。生产环境配置强密码并限制管理入口访问。

后台配置管理的“统一产币”操作会正式开启已领取的免费矿机和已购付费矿机，默认未启动。只可开启一次，重启服务不会重置。`NODE_REFERRAL_REWARD_BP` 默认 1500（15%），仅影响后续新生成的节点购买/升级签名。

## 构建和托管前端

分别在 mining/web、mining/admin-web 配置 `.env` 并执行：

```bash
npm ci
npm run build
```

将各自 dist 目录部署到静态站点服务。用户端 `VITE_API_BASE_URL` 指向用户 API，管理端对应变量指向管理 API，市场 API 指向索引器；具体变量以各项目示例为准。生产反向代理需要按前端请求路径将 `/api` 和 `/market-api` 转发到对应服务，并正确处理路径前缀。

Vite 开发代理仅在开发服务中生效：用户 API 127.0.0.1:3000、管理 API 127.0.0.1:3001、市场索引器 127.0.0.1:42069。生产静态文件不会自动使用开发代理。

前端环境变量在构建时写入，修改网络、合约地址或 API 地址后必须重新构建。

## 上线检查

- 核对链 ID、合约地址、签名者、Owner、金库授权、SPACE 白名单和回购库存。
- 确认数据库初始化及五个业务函数完成，索引器正常同步，API 与索引器内部密钥一致。
- 确认三个后端进程正常运行，并按计划手动开启矿机产币、上架付费矿机。
- 使用测试账户检查节点购买、推荐奖励入账、做市商申请、回购买卖、矿机购买和提现。
- 部署记录、私钥、实际 `.env`、数据库及 Redis 数据不提交 Git；数据库定期备份。


## 免费矿机账户的提现预留额

账户存在 free_miner 记录时，SpaceXZI 可提现/可转出金额为 max(总余额 − 10 枚, 0)；未领取免费矿机则不预留。待启动和已产完的免费矿机均生效，因此矿机记录不应因产完而删除。账户余额允许全部用于矿机购买或复投，退款只恢复总余额；后续任何 SpaceXZI 收入重新按同一预留额计算。USDT 不受影响。

提现还要求账户存在 account_miner 记录，不再查询历史购买签名判断资格；产完的付费矿机仍满足条件。用户端正常展示总余额，提现窗口展示接口计算的可提现余额。

已有数据库上线新版本前，需要停止 API 和 Worker、核对已有待处理签名并备份数据库。在 mining/server 目录连接业务数据库后执行：

```sql
\i sql/fixed_free_miner_reserve.sql
```

该脚本删除旧不可提现余额、资金来源拆分及相关流水字段，保留账户总余额、领取记录和交易签名。新空库使用当前实体初始化即可，不需要执行此脚本。本次规则仅由后端生成签名前校验，合约不变；API 继续返回动态计算的 nonWithdrawableBalance、withdrawableBalance 和基于账户持有矿机的 canWithdrawSpace。
