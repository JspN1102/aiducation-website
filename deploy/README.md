# 腾讯云部署

普通话平台： https://mandarin.aiducation.asia/maanshan/

线上入口按用户确认的双站方式保留：`https://aiducation.asia/maanshan/` 继续由
Vercel 提供；`https://mandarin.aiducation.asia/` 由广州轻量服务器提供，并自动进入
`/maanshan/`。主域名解析保持 Vercel，只有 `mandarin` 子域名解析到广州服务器。

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

相同版本再次更新时，会核对发布清单、实际文件摘要、运行进程与本机 HTTPS 页面；
全部一致且服务正常便直接结束，不复制资源或重启。需要强制重建时使用
`python deploy/update.py --force`。切换版本、健康检查和失败回滚通过文件锁串行执行，
防止两个更新进程相互覆盖。

## 服务器目录与维护

- `/srv/maanshan/current/public/`：唯一网页文档根目录。
- `/srv/maanshan/current/server/`：Node 服务，仅监听 `127.0.0.1:3100`。
- `/home/ubuntu/maanshan-shared/app.env`：权限 600 的运行配置。
- `/home/ubuntu/maanshan-shared/tts-cache/`：云小和合成语音持久缓存。
- `/var/backups/maanshan/`：每日 PostgreSQL 自定义格式备份，不提供 HTTP 访问。
- `/home/ubuntu/maanshan-backups/before-20260919/`：迁移前配置和数据库备份。
- `/etc/nginx/maanshan-media.conf`：六段动画的精确 COS 路径重定向。

```sh
sudo systemctl status maanshan
sudo journalctl -u maanshan -n 50 --no-pager
sudo systemctl list-timers maanshan-backup.timer certbot.timer
sudo nginx -t
```

自动备份不自动删除历史文件，管理员需定期检查磁盘使用量。证书由 Certbot
定时续期。代码目录之外的语音缓存和数据库不会因发布而清空。

## 下载私密灾备到本机

```sh
python deploy/backup-local.py
```

默认保存在 `D:/桌面/马鞍山/腾讯云迁移_20260919/私密服务器备份/时间戳/`。
命令建立仅当前 Windows 账号和 SYSTEM 可读写的目录，通过已固定主机指纹的 SSH
下载数据库、数据库角色、运行环境变量、Nginx、证书及续期配置、服务配置和已生成语音。
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
禁止公网调用初始化接口。`DATA_READ_TOKEN` 保护教师数据，教师页面支持存取码；
浏览器仅保存到当前标签页的 sessionStorage。没有导入正式学生名册，也没有将
现有本机学生标识改造成学校统一账号或跨设备登录系统。

`TENCENT_SECRET_ID`、`TENCENT_SECRET_KEY`、`TENCENT_APP_ID` 用于 SOE/TTS。
`GPT_API_BASE`、`GPT_API_KEY` 用于 DeepSeek。`TTS_CACHE_DIR` 启用服务器缓存；
不设置时保留原 Vercel Blob 模式。配置和密码不得写进发布包或前端文件。

广州服务器暂不能直连 Google 手写识别，因此配置
`HANDWRITING_RELAY_URL=https://aiducation.asia/api/handwriting/`，只转发笔迹和
识别上下文。这项功能仍依赖保留的 Vercel 接口；完全脱离 Vercel 需要后续替换
识别供应商。其余新站 API 在腾讯服务器运行。

六段动画、四个现用山景/江岸/田地/春草模型及两个历史练习植物模型放在广州 COS，
使用标准存储；未开启 CDN、全球加速或新增订阅。模型使用内容摘要命名的对象路径，
模型重定向要求重新验证缓存，以便同名模型更新后能切换到新对象。六个模型合计约
18.5 MB，文件内容与本机原文件完全相同。COS 分担源站带宽，不会减少模型几何复杂度
或弱手机的解析、渲染开销。
`deploy/maanshan-media.conf` 保存当前已验证的精确资源映射；它是 Nginx 配置，
需要按配置更新流程安装到 `/etc/nginx/maanshan-media.conf`，并检查后 reload。
如果更换动画文件名，需要先上传并验证新对象，然后更新 Nginx 精确路径映射；
未映射的新文件仍由本机正常提供。资源包与实际请求、外网流量按腾讯云规则计量。

用户从旧域名切换到新域名时，浏览器本地进度不会自动跨域迁移；旧站保留，
不要将域名切换误称为已完成旧本地记录迁移。

## 已核实的备案访问限制

2026-09-19 初次部署时 HTTPS 曾通过主站、API 和浏览器检查；同日23:10香港时间
复核时，公网 HTTP 跳到腾讯云“未完成备案”页，带 mandarin 域名 SNI 的 HTTPS
握手也连续被重置。当前 DNS、443 防火墙和服务器内部 HTTPS/API 正常。
腾讯官方 https://cloud.tencent.com/document/product/243/18907 明确说明未备案域名的
HTTPS 也会被阻断。不能再把此前的 HTTPS 成功记录当作当前公网可用的证明。
这不是 Nginx 重定向或开放端口能消除的问题。正式使用中国内地服务器需完成相应备案；
或者在用户确认后选用香港等地域托管。保留原 Vercel 入口。

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
