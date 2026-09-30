# 协作须知

- 马鞍山普通话平台：`https://mandarin.aiducation.asia/school/` 是学校正式平台。
  新版本先只发布到 `https://aiducation.asia/school/`，用户确认后才用同一个 commit
  发布正式平台。步骤与限制见 `deploy/README.md`「发布流程」。
- 部署前先 `git fetch origin main`，并用 `vercel ls` 查看两个项目最近的部署，
  避免覆盖别人刚发布的版本。
