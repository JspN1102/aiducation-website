# 备案期间的学校 Vercel 入口与广州主数据库

`aiducation.asia/maanshan/` 继续保留在原 Vercel 项目。学校独立项目
`aiducation-mandarin-temporary` 承载 `mandarin.aiducation.asia` 的页面和固定 API 入口。
学校 API 通过受限 SSH 转发到广州 `127.0.0.1:3100`；登录、学习记录、研究事件、
教师统计与报告、语音和手写识别均由广州应用处理。PostgreSQL 是学校正式数据源，
不再依赖 Vercel private Blob 提供学校登录或写入服务。

这份文档描述当前架构与操作条件。广州本地 `/api/health` 正常只证明进程存活，
不能代替公网 Vercel → 广州全部 API 的实际验证；公网出现 `ORIGIN_UNAVAILABLE`
或连接超时仍属服务故障，不得仅凭本地健康检查宣告恢复。

## 不改 DNS 的学校备用入口

`https://aiducation.asia/school/` 是同一广州数据库的学校备用入口；
公司首页为 2026-10-08 起的水墨宫廷版（company-v3-ink 分支 e1ad9b3，备份 `D:/maanshan-work/company-base/website-e1ad9b3.zip`；上一版 2d1b8ff 见 `company-base/backup-live-20261008/`）；`/maanshan/` 旧演示及其他旧站保持原部署内容。
`deploy/package-company-fallback.py` 从已校验的公司生产源码备份添加学校包，
校验所有原文件摘要，仅追加 `/school/`、13 个 `/school-api/` 固定转发及资源规则。
先生成与当前提交一致的学校包，再生成隔离公司包并从该目录发布；不要从主源码目录直接发布公司站。

广州环境显式设置 `SCHOOL_AUTH_ADDITIONAL_ORIGINS=["https://aiducation.asia"]`；
只接纳精确 HTTPS 来源，Cookie、CSRF、学校权限及 `/school/` 登录检查保持启用。
两个入口的 Cookie 与浏览器待上传队列独立；成功入库的账户和学习数据共用。
备用入口的 TTS 签名音频路径转换为同源 `/school-api/tts/`，远程 COS URL 不变。
任何入口故障都不能通过允许匿名学校模式来恢复。DNS、邮件及备案域名不由此打包器修改。

2026-09-21 的网络检查发现，部分连接到学校域名 Vercel 边缘地址会在 HTTP 之前重置；
指定可达 IP 的诊断成功不能算默认网络恢复。备用入口也是 Vercel 服务，
并非独立供应商容灾，不能承诺所有地区零故障。

教师 Word 生成在广州以 PostgreSQL 持久任务运行：POST 快速返回 202，
浏览器短请求查询状态，完成后下载。服务器最多同时运行两个模型任务；
进程重启后恢复排队及过期租约，页面关闭不取消已入库任务。
模型单次预算 180 秒、租约 210 秒；暂时失败可重试一次，质量修订最多两轮。
上线需实际验证从生成到 DOCX 下载，不能只检查 202 或本地测试。

## 独立发布与受限 relay

项目 ID：`prj_BXHyIePcHYn42fprA8v1zB2rvSF1`。
团队 ID：`team_6bMNzzu5QidBaJlDV3R4icEd`。
项目顶层 `regions` 保持 `iad1`；`school-gateway` 函数默认在 `hkg1`、只走香港中转，兄弟函数
`school-gateway-us` 固定在 `iad1`（见下文“香港优先拓扑”）。学校数据库及业务处理仍在广州。部署元数据必须与打包配置一致；变更区域后须重新验证接口。香港、新加坡和东京候选区域的函数直连广州虽有更低延迟，完整部署或并发检查仍出现连接失败，因此 `hkg1` 函数从不直连广州。

提交经过验证的修改后，使用新的隔离目录：

```powershell
python deploy/package-vercel.py --destination C:/Users/Administrator/maanshan-work/school-release-new --project-id prj_BXHyIePcHYn42fprA8v1zB2rvSF1 --team-id team_6bMNzzu5QidBaJlDV3R4icEd
Set-Location C:/Users/Administrator/maanshan-work/school-release-new
vercel --prod --yes --scope jspn1102s-projects --local-config ./vercel.json
```

`--primary-region` 默认 `hkg1`；回滚时用 `--primary-region iad1`（见下文“回滚”）。清单记录 `primaryRegion` 与 `apiFunctions: 2`。

打包器把 14 个固定入口交给同一个 `school-gateway` 函数：`soe`、`tts`、`maanshan-chat`、`maanshan-report`、
`maanshan-save`、`maanshan-data`、`handwriting`、`school-auth`、`research-events`、
`teacher-analytics`、`challenge-result`、`teacher-tools`、`school-recordings`、`speech-to-text`（和詩人對話的說話輸入）。每个入口固定上游路径，
只接受该白名单，调用者不能选择其他目标。路由重写的来源及目的都保留尾斜线，
与 `trailingSlash: true` 一致。Vercel 只包含页面、relay 和必要依赖，
不打包 `.env`、数据库、账号名单、广州业务模块、原官网或其他网站。

学校 production 的 relay 使用四个加密环境变量：`GUANGZHOU_RELAY_HOST`、
`GUANGZHOU_RELAY_USERNAME`、`GUANGZHOU_RELAY_HOST_SHA256`、
`GUANGZHOU_RELAY_PRIVATE_KEY`。独立私钥保留真实换行，禁止放入代码、发布清单或浏览器。
可选的 `GUANGZHOU_RELAY_PORT` 仅允许 `22` 或 `2222`，未配置时使用 `22`。
独立的 TCP 2222 监听器已安装且本机转发／权限拒绝测试通过；是否用于公网生产 relay，
必须以对应 Vercel 部署的全部接口验证结果为准，不能把本机连通当作公网连接已恢复。
不得把管理员部署私钥提供给 Vercel。供应商凭据及数据库配置保留在广州的私密环境文件中；
旧 Vercel 供应商／Blob 环境变量不是新 relay 的业务存储配置，不应未经备份随意清理。

2026-10-07 起 relay 优先经香港轻量服务器（`43.161.201.12:2222`，独立 sshd
`maanshan-relay-2222.service`，同一账号与公钥，主机指纹写在代码里）。香港无法主动连大陆，
所以由广州 `maanshan-hk-tunnel.service`（账号 `maanshan-hktunnel`，`ssh -N -R
127.0.0.1:3100:127.0.0.1:3100`，5 秒×3 心跳）主动连香港 22 端口的受限账号
`maanshan-tunnel`，香港本机 3100 即广州应用。relay 按请求轮流使用香港本机 3100、3101、3102
（同一 SSH 会话，各端口独立通道池）；直连广州仍只用 3100。三个端口应各由广州一条独立的反向隧道
（`-R 127.0.0.1:310x:127.0.0.1:3100`，各自独立进程）提供。启用前须在香港确认 `maanshan-tunnel`
允许监听 3101、3102，并确认香港 relay sshd 对 `maanshan-relay` 逐个放行三个端口（OpenSSH 不支持端口范围，
`127.0.0.1:3100-3102` 写法无效）：authorized_keys 写 `permitopen="127.0.0.1:3100",permitopen="127.0.0.1:3101",permitopen="127.0.0.1:3102"`，
或 sshd 配置写 `PermitOpen 127.0.0.1:3100 127.0.0.1:3101 127.0.0.1:3102`。
缺少的端口会被反复标记故障，产生 `school_relay_port` 日志，但其余端口照常工作。

端口规则：某端口拒绝通道（带 reason），或新通道在返回响应头前被关闭（监听已失效），
该端口暂停 10 秒，同一会话立即换下一个端口。别的请求暂停的端口仍会按暂停最早结束的顺序再试一次，
只有本请求自己在三个端口都被拒绝才算隧道全断（`HONG_KONG_TUNNEL_DOWN`）。SSH 会话本身断开或被放弃时，
它的通道随之关闭，这不说明隧道故障：不标记端口、不暂停香港，请求在新会话上重连一次。
会话空闲超过 20 秒后，下一个请求先用它上次的端口（保温请求维持的那条通道），之后照常轮换。
完整模式（`iad1` 函数）下，香港不可用时未发出的请求改走广州直连：隧道全断后香港固定暂停 15 秒；
SSH 连接或握手失败后暂停 30 秒起、每次翻倍、最长 5 分钟。每次暂停写一条 `school_relay_route`
日志（含 `reason`、`pauseSeconds`）。

重发规则：尚未分配通道（未向广州写入任何字节）时可换端口、改路或跳转。通道已打开后，
只有 GET／HEAD 及后台入口（`school-recordings`、`research-events`、`maanshan-save`）在尚未收到响应头时
可在另一端口重发一次（重发缓存的请求体），后台入口的重发要求广州能承受重复提交；
`soe`、`speech-to-text`、`maanshan-chat`、`tts` 及其他 POST 一旦打开通道即不重发，失败返回 502。
同一请求最多三次到达广州：hkg1 两个端口各一次，再以 `retry` 跳转到 iad1 直连一次（iad1 对 `retry` 跳转不再重发）。

可观测性：响应头 `X-Relay-Route`（`hk`／`gz`）和 `X-Relay-Port`（实际端口）；经跳转的响应另带
`X-Relay-Hop: iad1`，此时 Route／Port 是 iad1 实际所走路线。发往广州的请求带 `x-school-relay`
（如 `hk:3101`、`gz:3100`，经跳转为 `hop-gz:3100`），广州 API 日志记录该标签。总耗时超过 5 秒或状态码
≥500 时，函数日志写一行 `school_relay_slow`（入口、路线、端口、通道类别、状态、错误码、是否重发、
跳转原因、各段耗时、字节数、区域），不含 IP、账号、Cookie、查询串或请求体。

### 香港优先拓扑（hkg1 主函数 + iad1 兄弟函数）

- `api/school-gateway.js`（`hkg1`，导出 `gatewayHongKong`）：14 个入口的重写目标，cron 也只打到它。
  只走香港中转（握手超时 2.5 秒、开通道超时 2 秒），不直连广州。
- `api/school-gateway-us.js`（固定 `iad1`，导出 `gatewayUs`）：完整模式（香港优先，失败改直连）。
  它接收 hkg1 的签名跳转；不带跳转头的请求按原 gateway 处理。它没有 cron，跳转时可能遇到冷启动并新建 SSH 会话。
- 跳转原因：`connect`（香港 SSH 连接／握手失败）、`tunnel`（三个端口都拒绝）、`breaker`（熔断期内）、
  `off`（`GUANGZHOU_RELAY_HONG_KONG=off`）、`retry`（仅 GET／HEAD 及后台入口，换端口重发一次后仍在响应头前断开）。
  `connect` 或 `tunnel` 后 hkg1 对香港固定熔断 10 秒（不翻倍），期间请求直接跳转，不碰香港。
- 跳转地址：`https://<目标域名>/api/school-gateway-us/?__school_route=<入口>&<原查询串>`，原查询串中的
  `x-vercel-*`、`_vercel*`（保护绕过、分享 Cookie 等平台保留参数）和 `__school_route` 不转发。
  它沿用原方法、请求体和允许转发的请求头。跳转只用 55 秒总期限的剩余时间：连接失败返回 503，超时返回 504。
- 目标域名按序选择（`VERCEL_URL` 是部署专属域名，开启 Deployment Protection 时会被拦截）：
  1. 有 `VERCEL_AUTOMATION_BYPASS_SECRET`（在 Deployment Protection 中开启 Protection Bypass for Automation
     后由 Vercel 注入）时用 `VERCEL_URL`，并带 `x-vercel-protection-bypass` 头，即同一版本的 iad1 函数。该值不写入日志或响应。
  2. 否则 production（`VERCEL_ENV=production`）用公开域名 `mandarin.aiducation.asia`（不受 Deployment Protection 约束），
     发布切换的片刻可能落到另一版本的 iad1 函数。
  3. 否则（preview 且无 bypass）用 `VERCEL_URL`，该部署须未开启保护。都没有时返回 503 `ORIGIN_UNAVAILABLE`，
     并写一行 `school_relay_hop_failed`（reason `no_host`）。
- iad1 兄弟函数的每个应答都带 `x-school-sibling: 1`（签名被拒时为 `rejected`）。hkg1 收到不带此标记的应答
  （保护登录页、重定向、函数缺失的 404 等平台页面）或被拒的应答，不转发其状态、头和 Cookie，向学生返回 503
  `ORIGIN_UNAVAILABLE`，并写一行 `school_relay_hop_failed`（reason `platform` 或 `rejected`，含状态码）。
  发布后冒烟测试：`/api/school-gateway-us/?__school_route=school-auth`（经上面选定的域名，需要时带 bypass 头）
  的响应须带 `x-school-sibling: 1`，并检查日志中没有 `school_relay_hop_failed`。
- hkg1 的跳转使用每个实例一个 keep-alive 连接池（上限与函数并发上限相同，48）。复用的空闲连接若恰好已被
  边缘关闭（`ECONNRESET`／`EPIPE`，未收到响应头），用新连接重发一次。
- 签名头 `x-school-hop: v1.<秒级时间戳>.<reason>.<base64url(客户端IP)>.<base64url(HMAC)>`：
  - 密钥为 `sha256("maanshan-school-hop-v1\n" + GUANGZHOU_RELAY_PRIVATE_KEY)`，两个函数共用项目环境变量，无需新密钥。
  - HMAC-SHA256 覆盖 `v1|ts|reason|ip|入口|方法`。
  - iad1 用常量时间比较校验。时间差超过 120 秒，或入口、方法不符，即返回 403 `{"ok":false,"code":"BAD_HOP"}`，
    日志 `school_relay_hop_rejected` 只含入口与原因；两边时钟偏差过大时会出现此 403（hkg1 转为 503 交给学生）。
  - 校验通过后，签名中的 IP 作为 `x-real-ip`，不会再次跳转。任何 reason 的跳转在 iad1 都跳过香港，直连广州
    （香港离 hkg1 约 1-2 ms、离 iad1 约 212 ms，hkg1 放弃香港的原因在 iad1 只会更慢）。
  - 客户端自带的 `x-school-hop` 在 hkg1 一律丢弃并重新签名，不会转发给广州。
- `GUANGZHOU_RELAY_HONG_KONG=off`：hkg1 的每个请求都跳到 iad1，iad1 再直连广州。这相当于整体改回直连，
  但多一跳 hkg1→iad1。要去掉这一跳，见下面的回滚第 2 步。

### 回滚

1. 最快：在 Vercel 控制台对上一个 production 部署执行 Instant Rollback（或 `vercel rollback`），不需要重新打包。
   回滚后 production 域名固定在该部署，之后的新部署不会自动接管；修复后须在控制台 Undo Rollback，
   或 `vercel promote <部署URL>` 指定新的 production 部署。
2. 保留新代码但不用 hkg1：用 `--primary-region iad1` 重新打包并发布。`school-gateway` 回到 iad1 完整模式
   （香港优先，失败改直连），不再跳转；端口轮换与新的暂停规则仍然生效。
3. 只停香港：设置 `GUANGZHOU_RELAY_HONG_KONG=off` 并重新部署。在 hkg1 下仍多一跳；与第 2 步合用即完全直连。

服务器独立账号 `maanshan-relay` 仅能转发到 `127.0.0.1:3100`；
无 shell、SFTP、PTY、远程转发、数据库端口或任意内网目标权限。
relay 校验 SSH 主机密钥指纹，并转发 Cookie、Origin 和 CSRF 字段，
由广州应用执行账号及权限检查。不能把公网直连数据库作为故障降级方案。

共享函数使用 60 秒上限，relay 总请求期限短于函数上限。
响应不缓存，并保留 Word／Excel 下载头和二进制内容。聊天可使用 SSE 逐段返回，relay 不缓冲整段回复，断流不会作为完整回答保存。SSH 连接保留两分钟供连续学习复用；内部 HTTP 通道池最多 16 条，保留最多 4 条空闲通道，25 秒后回收，早于广州 HTTP 服务的 35 秒关闭时间。恢复执行时再次核对过期时间，Cookie 和 CSRF 字段每次重新转发。发布后应逐个验证 13 个入口，
再验证一次完整的教师登录、筛选、Excel 下载、报告生成与 Word 下载，
不能用某一个接口成功推断其他函数实例的网络连接正常。

函数实例在响应后几秒内即被挂起，挂起期间不发送 SSH keepalive。广州 relay sshd
（`/etc/ssh/maanshan-relay-2222.conf`，由服务器手工维护，仓库只备份不生成）
的 `ClientAliveCountMax` 已于 2026-09-22 由 2 调至 20（约 10 分钟容忍，
备份 `/etc/ssh/maanshan-relay-2222.conf.bak-20260922`），否则会话在约 90 秒后被服务器关闭，
实例恢复后第一个请求会在半秒内返回 503 且无日志。relay 在打开通道时把同步抛错、
错误回复、5 秒无响应或对端半关闭视为会话已死：丢弃该会话并重连一次，
且仅在尚未分配通道（尚未向广州写入任何字节）时重发，付费 POST 不会重放；
服务器明确拒绝（带 reason）不重连。录音开始时前端会发一次节流 30 秒的
预热 GET，使评测 POST 到达时会话与通道已就绪。

必须实际进入隔离目录并显式指定其 `vercel.json`。不要从原项目目录直接发布学校站；
只使用 `--cwd` 可能带入启动目录配置。`.vercel/project.json` 只保存项目关联，不含密钥。

## 账号、教师文件与持久数据

广州使用正式学校学生及教师账号。账号、密码哈希和会话由 PostgreSQL 及服务器认证逻辑管理；
教师角色可查看全部年级／班级，学生只能访问自己的学习数据。
教师后台按所选年级／班级导出可直接使用的 Excel；Word 报告由
`deepseek-v4-pro` 根据相同范围的数据生成并通过质量检查后提供下载。
演示数据与真实学生数据隔离，演示文件有明确标识，不作为研究样本。

广州保持 `SCHOOL_AUTH_STORE=postgres`、`DB_DRIVER=postgres`、
`SCHOOL_AUTH_ENABLED=1` 及批准范围内的 `RESEARCH_ENABLED=1`。
`STUDENT_STORE` 不得继续配置为 `blob`。教师报告保存在 PostgreSQL，
动态 TTS 由广州处理，持久语音缓存位于 `TTS_CACHE_DIR` 指定的服务器磁盘目录。
同一已生成语音可复用；静态预生成录音仍随各自资源索引加载。

学生最新逐句录音保存在 PostgreSQL 的 `school_recordings` 表中，浏览器 IndexedDB 保存待上传队列；评分不等待录音上传。回听接口校验账户、年级和教师练习重置批次，不使用公开 COS 链接。刷新后从服务端恢复最新录音，历史上只存在页面内存且已经丢失的音频无法补回。格式、容量与备份说明见 `recording-storage.md`。

原官网示范站与学校独立域名是不同浏览器 Origin，本地进度不会自动互通。
学校账户的服务端记录不依赖浏览器本地身份替代品。仍在浏览器队列中、尚未提交成功的
事件不能算作已入库数据；客户端事件与服务器核验结果应保持来源区别。

## COS 教学媒体

`media-manifest.json` 管理公开教学视频、模型和 WebP 图片，
包括诗句画卷、封面、头像及游戏素材。打包前核对文件摘要和大小，
精确映射的图片从 Vercel 发布包中排除，避免重复占用 Deployment Storage；
六段动画和九个 3D 模型例外：同一文件随发布包一起部署，并保留 COS 副本作为第二条线路，
动画在出错或停滞时切换，模型则两条线路对冲下载、先完成并校验通过的生效
（见 `README.md` 的「COS 教学媒体」）。
代价是每次部署多约 155 MB 动画和 27 MB 模型静态文件，学生看动画和模型时的
Vercel 流量计入该项目配额（Pro 每月 1 TB）。
图片和模型采用内容摘要路径；页面中的公共图片映射让浏览器直接访问 COS，
旧同源路径仍有精确的 307 跳转。未列入清单的资源不会被整目录转发。

COS CORS 仅允许明确的网站来源，响应携带 `Vary: Origin`。
涉及 canvas 的游戏图片使用匿名跨域加载，需同时验证响应 CORS 与实际绘图，
不能重新假设所有图片都同源。不向浏览器提供 COS 访问密钥，也不开放匿名写入或列桶权限。
旧版未引用音频、已移除的朗读视频及 3D 诗诗只从发布包排除，本机原件保留。

## 旧 Blob 遗留项与当前备份

2026-09-20 切换检查时，private Blob 因供应商额度状态暂停读取。
已列出的 38 个持久研究 outbox 对象均有 PostgreSQL 接收记录，共 251 条历史事件；
这是该检查时点的持久对象覆盖，不证明尚未发出的浏览器队列已同步。
检查时的学生最新快照在两侧均为 0，不能与研究事件数量混为一谈。

**仍有一份旧正式教师报告 Blob 对象无法读取，尚未迁入 PostgreSQL。**
其元数据大小为 158,055 字节、上传时间为 2026-09-20 09:37:24 UTC；
内容及完成状态无法核实。原对象保留，不能描述为“所有报告已经迁完”，
不能删除其 Blob 存储。恢复访问后，应独立校验并按报告命名空间迁移，
不得重启旧同步链作为补救。

`research-sync.timer`、`maanshan-bridge-backup.timer`、
`maanshan-standby-import.timer` 已禁用，对应旧服务不再运行。
旧 Blob 导出、旧配置及停用前状态保留，不把旧同步成功时间当作当前 PG 健康要求。
`/etc/maanshan/standby.enabled` 已移出启用位置；新的 root-owned 0600 标识
`/etc/maanshan/direct-postgres.enabled` 让健康检查监测正式 PG 链路。

继续运行 `maanshan-backup.timer` 的全库自定义格式 `pg_dump`，覆盖账户、研究与报告表；
继续运行 `maanshan-health-restore.timer`，在隔离的临时集群中完整恢复最新备份，
不对生产数据库做恢复试验。`maanshan-health-check.timer` 检查本地服务、资源、
PG 备份及隔离恢复结果，不再要求旧 Blob 备份或 standby 正常。

`python deploy/backup-local.py` 将数据库、角色、运行配置、语音缓存及现有旧 Blob
本地快照下载到受限的桌面灾备目录，并校验传输摘要。发布源码另存归档。
受限 relay 的服务器配置与主机密钥、本机独立 relay 私钥、部署私钥和已核验的
`known_hosts` 都须纳入私密恢复清单；不要将它们混入可公开源码 ZIP。
清理任何旧云内容前必须完成对应本地备份及可读性校验。当前遗留报告因不可读，
不满足可删除条件。详细本地监测操作见 `health-standby.md`。

## 备案完成后切回广州网页入口

1. 核实适用备案已经完成，广州公网 HTTPS、证书自动续期、Nginx 及全部业务接口可用。
2. 备份当前广州全库、运行配置及最新源码；核验教师登录、班级数据、研究写入、
   Excel／Word、TTS 磁盘缓存和 COS 图片／视频。旧 Blob 报告遗留项继续单独保留。
3. 只将 `mandarin` DNS 改为 `A 134.175.149.14`，TTL 可用 600；
   不修改根域、`www` 或邮件 MX。域名不变，学校浏览器 Origin 保持一致。
4. DNS 缓存期间 Vercel relay 和广州直接入口都访问同一 PostgreSQL，
   不需要重新导入旧 Blob，也不得开启两个独立可写数据源。
5. 验证切换后的实际请求、权限、教师统计及事件写入，再停用临时 Vercel 接入。
   保留已备份的可回退发布；若回退入口，仍指向同一广州数据源，
   不能误启用旧 Blob 架构版本。

备案状态未核实前不自动定时切回。网页入口切换不会解决旧 Blob 的内容读取限制，
也不授权删除该遗留报告或任何尚无完整本地备份的对象。
