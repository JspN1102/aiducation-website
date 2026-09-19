# 备案期间的独立 Vercel 入口

`aiducation.asia/maanshan/` 继续保留原 Vercel 项目；临时项目
`aiducation-mandarin-temporary` 只承载 `mandarin.aiducation.asia`。
网站和接口实际在 Vercel 运行，不转发到受备案限制的广州网页服务。
广州部署、PostgreSQL、定时备份及证书配置继续保留，准备备案完成后切回。

## 独立发布

项目 ID：`prj_BXHyIePcHYn42fprA8v1zB2rvSF1`。
团队 ID：`team_6bMNzzu5QidBaJlDV3R4icEd`。函数区域为 `hkg1`。

提交经验证的修改后，使用新的隔离目录：

```powershell
python deploy/package-vercel.py --destination C:/Users/Administrator/maanshan-work/临时发布新目录 --project-id prj_BXHyIePcHYn42fprA8v1zB2rvSF1 --team-id team_6bMNzzu5QidBaJlDV3R4icEd
vercel --cwd C:/Users/Administrator/maanshan-work/临时发布新目录 --prod --yes --scope jspn1102s-projects
```

不得从原项目目录直接发布临时站。打包器仅复制普通话平台及需要的 API，生成自己的
Vercel 配置与项目关联；根路径跳到 `/maanshan/`。不会上传 `.env`、服务端部署工具、
学校数据库、原官网或其他站点。`.vercel/project.json` 只标识新项目，不包含密钥。

发布环境变量使用该独立项目的 production 配置：`TENCENT_APP_ID`、
`TENCENT_SECRET_ID`、`TENCENT_SECRET_KEY`、`GPT_API_BASE`、`GPT_API_KEY`、
`BLOB_READ_WRITE_TOKEN`、`DATA_READ_TOKEN`、`STUDENT_STORE=blob`。
不复制广州的 `DB_HOST`、`TTS_CACHE_DIR` 或 `HANDWRITING_RELAY_URL`。
Vercel 的手写识别直接请求原识别供应商；教师页仍要求私密存取码。

## COS 与持久数据

`media-manifest.json` 记录六个视频和六个模型。打包前核对原文件摘要和大小，再生成
精确307跳转；这些大文件不重复上传到 Vercel。对象使用原 COS，模型以内容摘要命名。
图片保持同源，避免涂色游戏的 canvas 被跨域污染。当前语音索引中的录音全部保留，
旧版未引用MP3与已经删除入口的朗读视频、3D诗诗只从临时发布包排除，本机原件保留。

COS只允许三个明确来源：原官网、mandarin、临时项目的固定vercel.app入口；
跨域响应携带 `Vary: Origin`。不开放匿名写入或列桶权限，也不向浏览器提供访问密钥。

动态TTS使用既有private Blob语音缓存。学习记录使用独立private Blob前缀
`mandarin-bridge-v1`，每个学生、诗篇、环节保留最新记录；并发条件写入，旧请求不会
覆盖较新的学习记录。教师读取同一存储，不把“仅保存在设备”误报为已上传。
这不是新建学校账号体系：现有浏览器身份和跨设备限制仍然存在。

数据导出与迁回工具见 `student-store-transfer.md`。不能在学生仍向Blob写入时只导出一次
便宣布迁移完成；切回前后需要核对DNS缓存、晚到记录及两个来源，保持Blob副本。
原Vercel站与临时站是不同浏览器Origin，其本地进度不会自动互通。

临时学习记录另由广州服务器每天北京时间03:15后随机0–15分钟导出一次。
`maanshan-bridge-backup.timer` 调用 `backup-bridge.sh`，使用独立的
`/home/ubuntu/maanshan-shared/bridge-backup.env`；不切换广州在线应用的PostgreSQL配置。
导出保存在 `/home/ubuntu/maanshan-backups/blob/时间戳/records.json`，目录700、文件600。
每次建立新快照，不删除Blob源或旧快照；失败会让systemd服务返回非零状态。
管理员应检查定时器结果和磁盘空间。`python deploy/backup-local.py` 将这些快照和
恢复所需的独立配置下载到本机私密灾备目录。

## 切回广州

切换只改 `mandarin` 的DNS记录，不改根域、www或邮件MX。切回前必须完成适用备案并
确认广州公网HTTPS可用，备份临时数据，以dry-run检查导入计划、正式导入并验证教师
统计。保留私密Blob源，处理旧DNS缓存产生的晚到写入后再停用临时入口。

当前回退目标为 `mandarin A 134.175.149.14`，TTL600；原始记录 ID `2412222153`。
切换过程中域名始终不变，原mandarin浏览器本地记录可以继续使用。备案状态未核实前
不得自动定时切回。临时Vercel项目与旧广州版本都保留，不删除历史备份。
