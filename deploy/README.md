# 腾讯云部署

普通话平台： https://mandarin.aiducation.asia/maanshan/

备案期间：`https://aiducation.asia/maanshan/` 保留原 Vercel 项目；
`https://mandarin.aiducation.asia/` 使用独立临时 Vercel 项目，并自动进入
`/maanshan/`。模型继续使用广州 COS；六段动画同时随 Vercel 发布并保留 COS 副本，
浏览器在两条线路之间自动切换（见下文），广州轻量服务器保留完整部署。
临时入口的发布、存储和切回说明见 `vercel-temporary.md`。两个 Vercel 项目分别更新，
下面的 `update.py` 仅更新广州服务器，不会发布 Vercel 或改变 DNS。

独立 Vercel 包只包含 gateway、广州 relay 与纯编码协商工具
`api/_lib/response-encoding.cjs`；打包器逐项校验此白名单，不复制服务器业务代码。
教师 JSON 在客户端接受 gzip 时由广州压缩并原样转发，Excel/Word 文件不重复压缩。

应用采用原生静态网页、Nginx、常驻 Node API、PostgreSQL。公司官网及原有
Vercel 页面仍保留。`server/` 将原 Vercel handlers 打包运行，兼容原部署方式。

## 更新

本机安装 Python、paramiko 和 Git。专用 SSH 私钥、主机指纹位于用户的 `.ssh`
目录，均不进入仓库。提交要发布的改动后，在项目目录执行：

```sh
python deploy/update.py
```

脚本仅上传变更文件，校验 SHA-256，在新目录安装 Linux 依赖并构建，切换
`/srv/maanshan/current` 后检查 API 与 HTTPS 页面；失败自动恢复上个版本。
旧版本保留在 `/srv/maanshan/releases/`。配置不会随发布包上传或覆盖。

构建阶段由广州服务器生成文本资源的高压缩率gzip文件，激活前校验。Nginx启用
HTTP/2及gzip_static后直接发送压缩文件，避免为每次下载重复压缩，详见
`performance-README.md`。

相同版本再次更新时，会核对发布清单、实际文件摘要、派生gzip、运行进程与本机
HTTPS页面；全部一致且服务正常便直接结束，不复制资源或重启。需要强制重建时使用
`python deploy/update.py --force`。切换版本、健康检查和失败回滚通过文件锁串行执行，
防止两个更新进程相互覆盖。

## 服务器目录与维护

- `/srv/maanshan/current/public/`：唯一网页文档根目录。
- `/srv/maanshan/current/server/`：Node 服务，仅监听 `127.0.0.1:3100`。
- `/home/ubuntu/maanshan-shared/app.env`：权限 600 的运行配置。
- `/home/ubuntu/maanshan-shared/tts-cache/`：云小和合成语音持久缓存。
- `/var/backups/maanshan/`：每日 PostgreSQL 自定义格式备份，不提供 HTTP 访问。
- `/home/ubuntu/maanshan-backups/blob/`：临时入口学习记录的每日私密导出。
- `/home/ubuntu/maanshan-shared/bridge-backup.env`：仅供上述导出使用的配置，权限600。
- `/home/ubuntu/maanshan-backups/before-20260919/`：迁移前配置和数据库备份。
- `/etc/nginx/maanshan-media.conf`：六段动画和六个模型的精确 COS 路径重定向。

```sh
sudo systemctl status maanshan
sudo journalctl -u maanshan -n 50 --no-pager
sudo systemctl list-timers maanshan-backup.timer maanshan-bridge-backup.timer certbot.timer
sudo nginx -t
```

自动备份不自动删除历史文件，管理员需定期检查磁盘使用量。证书由 Certbot
定时续期。代码目录之外的语音缓存和数据库不会因发布而清空。

新增维护任务的脚本和安装步骤见 `health-standby.md`：每15分钟本机健康巡检，每日
将既有Blob导出幂等导入广州PostgreSQL作为备用副本，导入前后各备份一次；每日在
隔离PostgreSQL集群实际恢复最新备份、检查表和唯一索引，然后关闭该集群。没有公网
数据库端口，没有重复轮询Blob，也没有向外发送通知。后台任务使用低优先级并限制
CPU/内存。巡检只反映本机服务与备份，不代表外部付费API或香港学生网络可用性。
特权Python工具安装于root所有的 `/usr/local/lib/maanshan-maintenance`，更新维护工具
需要单独执行安装流程；普通应用发布不会自动替换这些文件。

## 下载私密灾备到本机

```sh
python deploy/backup-local.py
```

默认保存在 `D:/桌面/马鞍山/腾讯云迁移_20260919/私密服务器备份/时间戳/`。
命令建立仅当前 Windows 账号和 SYSTEM 可读写的目录，通过已固定主机指纹的 SSH
下载数据库、数据库角色、运行环境变量、Nginx、证书及续期配置、服务配置和已生成语音。
安装临时入口备份后，会一并下载它的私密配置及 Blob 学习记录快照；旧服务器未安装时
自动略过这些可选项。备份清单记录实际包含内容。
数据库先通过服务器 `pg_restore --list` 校验，所有下载文件核对 SHA-256，压缩包逐文件
读取验证。源代码使用单独的 `website-版本号.zip`；服务器备份不会改变在线服务。

**私密灾备包含密钥及可能的学生资料，不进入源码 ZIP，不可公开分享。**
这是手动下载工具；服务器每日数据库备份仍独立运行，电脑关机不会自动下载到本机。
裸机恢复时需要先安装对应版本的软件，从角色备份中恢复所需应用角色、创建数据库并恢复
数据，再恢复对应运行配置和同版本源码。证书、Nginx 和数据库角色文件需由管理员检查后
按目标主机恢复，不可直接覆盖不同用途服务器。当前已验证数据库恢复演练，未做整台裸机
重建演练。

## 配置与边界

`DB_DRIVER=postgres`，数据库仅本机可达。`INIT_KEY` 用于本机初始化，Nginx
禁止公网调用初始化接口。学校已导入787个学生和9个教师账号，统一从学校登录页进入；
教师数据通过服务器会话及角色权限保护。学生仅学习自己年级的古诗；教师及明确标记的
测试账号可跨年级学习。原存取码方案仅属于旧演示接口，不能作为正式学校登录方式。

`TENCENT_SECRET_ID`、`TENCENT_SECRET_KEY`、`TENCENT_APP_ID` 用于 SOE/TTS。
`GPT_API_BASE`、`GPT_API_KEY` 用于 DeepSeek。`TTS_CACHE_DIR` 启用服务器缓存；
不设置时保留原 Vercel Blob 模式。配置和密码不得写进发布包或前端文件。

广州服务器暂不能直连 Google 手写识别，因此配置
`HANDWRITING_RELAY_URL=https://aiducation.asia/api/handwriting/`，只转发笔迹和
识别上下文。这项功能仍依赖保留的 Vercel 接口；完全脱离 Vercel 需要后续替换
识别供应商。备案期间学校网页和固定接口网关位于 Vercel，学校业务通过受限通道交给
广州处理；学校账号、学习数据、研究事件及教师报告直接写入广州 PostgreSQL。
不再使用旧 private Blob 暂存同步链。细节见 `vercel-temporary.md`。

六段动画、四个现用山景/江岸/田地/春草模型及两个历史练习植物模型放在广州 COS，
使用标准存储；未开启 CDN、全球加速或新增订阅。模型使用内容摘要命名的对象路径，
模型重定向要求重新验证缓存，以便同名模型更新后能切换到新对象。六个模型合计约
18.5 MB。2026-09-20田地另有新优化版本：11.48MB降至4.00MB，三角形244,060降至
71,755；在广州低优先级生成，原模型和原COS对象均保留，当前页面改用新文件名。
新旧共13条资源映射。COS减少源站带宽占用，模型减面和纹理缩小另外降低手机负担。
`deploy/maanshan-media.conf` 保存当前已验证的精确资源映射；它是 Nginx 配置，
需要按配置更新流程安装到 `/etc/nginx/maanshan-media.conf`，并检查后 reload。
如果更换动画文件名，需要先上传并验证新对象，然后更新 Nginx 精确路径映射；
未映射的新文件仍由本机正常提供。

动画播放走双线路（2026-09-22 起）：同一 MP4 既随两个 Vercel 项目发布（30 天缓存），
也保留 COS 副本；`maanshan/media-videos.mjs` 由 `media_config.py --write` 生成，
`maanshan/animation-source.mjs` 先用会话内图片探测偏好的线路，出错或按下播放后
8 秒内没有可播放数据就切到另一条，实际播放成功的线路记在 sessionStorage。
原因：香港网络到广州 COS 经常丢包，大陆网络到 Vercel 又慢，单独一条都不可靠。
打包器要求每首现用诗的动画都同时具备本地文件和已验证的 COS 映射。
广州 Nginx 仍把动画 307 到 COS，因为广州出口约 5.8 Mbps 由全班共享。
浏览器层验证：`node server/animation-route.browser.test.cjs`（headless Edge，本地服务器模拟挂起、404 与正常线路）。资源包与实际请求、外网流量按腾讯云规则计量。

用户从旧域名切换到新域名时，浏览器本地进度不会自动跨域迁移；旧站保留，
不要将域名切换误称为已完成旧本地记录迁移。

## 已核实的备案访问限制

2026-09-19 初次部署时 HTTPS 曾通过主站、API 和浏览器检查；同日23:10香港时间
复核时，公网 HTTP 跳到腾讯云“未完成备案”页，带 mandarin 域名 SNI 的 HTTPS
握手也连续被重置。当前 DNS、443 防火墙和服务器内部 HTTPS/API 正常。
腾讯官方 https://cloud.tencent.com/document/product/243/18907 明确说明未备案域名的
HTTPS 也会被阻断。不能再把此前的 HTTPS 成功记录当作当前公网可用的证明。
这不是 Nginx 重定向或开放端口能消除的问题。正式使用中国内地服务器需完成相应备案；
备案期间按用户授权使用独立 Vercel 入口，原 Vercel 入口同时保留。

证书 HTTP01 续期也受到这一拦截影响，因此单独采用 DNS01 验证所有权。
DNS01 解决证书验证，不解除网站备案限制，不代表所有网络均可访问。

DNS01 hook 固定安装在 root 所有的
`/usr/local/lib/maanshan-certbot-dnspod.py`；仅能为
`_acme-challenge.mandarin.aiducation.asia` 添加本次验证 TXT 并核对后清理，
不会改动网站 A 记录或邮件 MX。状态位于 `/var/lib/maanshan-acme/`（权限 700）。
续期配置保留原 Certbot 账号和 Nginx 安装器，改用 manual DNS hooks。
部署该 hook 或调整 DNS 后，可运行：

```sh
sudo certbot renew --dry-run --cert-name mandarin.aiducation.asia --non-interactive
```
