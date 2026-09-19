# 腾讯云部署

普通话平台： https://mandarin.aiducation.asia/maanshan/

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

六段动画放在广州 COS，使用标准存储；未开启 CDN、全球加速或新增订阅。
如果更换动画文件名，需要先上传并验证新对象，然后更新 Nginx 精确路径映射；
未映射的新文件仍由本机正常提供。资源包与实际请求、外网流量按腾讯云规则计量。

用户从旧域名切换到新域名时，浏览器本地进度不会自动跨域迁移；旧站保留，
不要将域名切换误称为已完成旧本地记录迁移。
