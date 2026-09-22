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
公司首页、`/maanshan/` 旧演示及其他旧站保持原部署内容。
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
函数区域保持 `iad1`，学校数据库及业务处理仍在广州。部署元数据必须与打包配置一致；变更区域后须重新验证接口。香港、新加坡和东京候选链路虽有更低延迟，完整部署或并发检查仍出现连接失败，因此未切入正式学校域名。

提交经过验证的修改后，使用新的隔离目录：

```powershell
python deploy/package-vercel.py --destination C:/Users/Administrator/maanshan-work/school-release-new --project-id prj_BXHyIePcHYn42fprA8v1zB2rvSF1 --team-id team_6bMNzzu5QidBaJlDV3R4icEd
Set-Location C:/Users/Administrator/maanshan-work/school-release-new
vercel --prod --yes --scope jspn1102s-projects --local-config ./vercel.json
```

打包器把 13 个固定入口交给同一个 `school-gateway` 函数：`soe`、`tts`、`maanshan-chat`、`maanshan-report`、
`maanshan-save`、`maanshan-data`、`handwriting`、`school-auth`、`research-events`、
`teacher-analytics`、`challenge-result`、`teacher-tools`、`school-recordings`。每个入口固定上游路径，
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
